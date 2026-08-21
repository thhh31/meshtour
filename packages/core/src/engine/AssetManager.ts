import {
  ClampToEdgeWrapping,
  CubeTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NearestFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  WebGLRenderer,
  type Object3D,
} from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { resolveAssetUrl } from "../config/loader";
import type { NodeConfig, TourConfig } from "../config/schema";
import { PANORAMA_DEPTH_FAR, PANORAMA_DEPTH_NEAR } from "../rendering/PanoramaVisibilityMap";

export interface AssetManagerOptions {
  /** Path to the Draco decoder files. */
  dracoDecoderPath?: string;
  /** Path to the Basis Universal transcoder files (required for .ktx2 panoramas). */
  ktx2TranscoderPath?: string;
}

const DEFAULT_DRACO_PATH = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
const DEFAULT_KTX2_PATH = "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/libs/basis/";

interface NodeTextures {
  preview?: Texture;
  full?: Texture;
  previewPromise?: Promise<Texture>;
  fullPromise?: Promise<Texture>;
  released?: boolean;
}

interface DepthTextureEntry {
  texture?: CubeTexture;
  promise?: Promise<CubeTexture>;
}

/**
 * Loads the proxy mesh (glTF + Draco) and panorama textures with a simple
 * priority scheme: current node preview first, then current full res, then
 * neighbor nodes in the background. Keeps at most current + neighbors decoded.
 */
export class AssetManager {
  private config: TourConfig;
  private renderer: WebGLRenderer;
  private options: AssetManagerOptions;
  private textureLoader = new TextureLoader();
  private ktx2Loader: KTX2Loader | null = null;
  private nodeTextures = new Map<string, NodeTextures>();
  private layerTextures = new Map<string, { texture?: Texture; promise?: Promise<Texture> }>();
  private auxiliaryTextures = new Map<string, { texture?: Texture; promise?: Promise<Texture> }>();
  private depthTextures = new Map<string, DepthTextureEntry>();
  private loadedObjects = new Set<Object3D>();
  private maxAnisotropy: number;
  private disposed = false;

  /** Called when a full-res texture finishes loading after the preview was already shown. */
  onTextureUpgraded: ((nodeId: string, previous: Texture, next: Texture) => void) | null = null;

  constructor(renderer: WebGLRenderer, config: TourConfig, options: AssetManagerOptions = {}) {
    this.renderer = renderer;
    this.config = config;
    this.options = options;
    this.maxAnisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  private async loadMeshAsset(asset: { url: string; draco: boolean }): Promise<Object3D> {
    if (this.disposed) throw new Error("AssetManager is disposed");
    const loader = new GLTFLoader();
    loader.setKTX2Loader(this.getKtx2Loader());
    let draco: DRACOLoader | null = null;
    if (asset.draco) {
      draco = new DRACOLoader();
      draco.setDecoderPath(this.options.dracoDecoderPath ?? DEFAULT_DRACO_PATH);
      draco.preload();
      loader.setDRACOLoader(draco);
    }
    try {
      const gltf = await loader.loadAsync(resolveAssetUrl(this.config, asset.url));
      if (this.disposed) {
        this.disposeObject(gltf.scene);
        throw new Error(`Mesh load for released URL "${asset.url}" was discarded`);
      }
      this.loadedObjects.add(gltf.scene);
      return gltf.scene;
    } finally {
      draco?.dispose();
    }
  }

  async loadProxyMesh(): Promise<Object3D> {
    const asset = this.config.assets.mesh;
    if (!asset) {
      throw new Error(
        "Tour config has no assets.mesh and no proxyMesh object was provided to the engine",
      );
    }
    return this.loadMeshAsset(asset);
  }

  async loadVisibilityMesh(): Promise<Object3D | null> {
    const asset = this.config.assets.visibilityMesh;
    return asset ? this.loadMeshAsset(asset) : null;
  }

  async loadBridgeMesh(): Promise<Object3D | null> {
    const asset = this.config.assets.bridge;
    return asset ? this.loadMeshAsset(asset) : null;
  }

  private node(nodeId: string): NodeConfig {
    const node = this.config.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Unknown node "${nodeId}"`);
    return node;
  }

  panoramaUrl(nodeId: string, quality: "preview" | "full"): string {
    const node = this.node(nodeId);
    const { previewSuffix, fullSuffix } = this.config.rendering;
    // A single configured suffix is the sole quality; two distinct suffixes
    // enable progressive preview -> full delivery.
    const suffix =
      quality === "preview" ? (previewSuffix ?? fullSuffix) : (fullSuffix ?? previewSuffix);
    return resolveAssetUrl(this.config, suffix ? node.panorama.url + suffix : node.panorama.url);
  }

  private hasDistinctQualities(): boolean {
    const { previewSuffix, fullSuffix } = this.config.rendering;
    return Boolean(previewSuffix && fullSuffix && previewSuffix !== fullSuffix);
  }

  private async loadTexture(url: string): Promise<Texture> {
    let texture: Texture;
    if (/\.ktx2($|\?)/i.test(url)) {
      texture = await this.getKtx2Loader().loadAsync(url);
      texture.minFilter = texture.mipmaps.length > 1 ? LinearMipmapLinearFilter : LinearFilter;
    } else {
      texture = await this.textureLoader.loadAsync(url);
      texture.minFilter = LinearMipmapLinearFilter;
      texture.generateMipmaps = true;
    }
    texture.colorSpace = SRGBColorSpace;
    // Repeat horizontally so the shader's seam-safe sampling (negative u) wraps.
    texture.wrapS = RepeatWrapping;
    texture.wrapT = ClampToEdgeWrapping;
    texture.magFilter = LinearFilter;
    texture.anisotropy = this.maxAnisotropy;
    return texture;
  }

  private getKtx2Loader(): KTX2Loader {
    if (!this.ktx2Loader) {
      this.ktx2Loader = new KTX2Loader()
        .setTranscoderPath(this.options.ktx2TranscoderPath ?? DEFAULT_KTX2_PATH)
        .detectSupport(this.renderer);
    }
    return this.ktx2Loader;
  }

  /**
   * Load validated, GPU-ready offline radial depth. Missing metadata means the
   * caller should use runtime visibility capture.
   */
  ensureDepth(nodeId: string): Promise<CubeTexture | null> {
    const metadata = this.node(nodeId).depth;
    if (!metadata) return Promise.resolve(null);
    const resolved = resolveAssetUrl(this.config, metadata.url);
    if (
      Math.abs(metadata.near - PANORAMA_DEPTH_NEAR) > 1e-9 ||
      Math.abs(metadata.far - PANORAMA_DEPTH_FAR) > 1e-9
    ) {
      return Promise.reject(
        new Error(
          `Radial depth for node "${nodeId}" at "${resolved}" uses near/far ` +
            `${metadata.near}/${metadata.far}; expected ${PANORAMA_DEPTH_NEAR}/${PANORAMA_DEPTH_FAR}`,
        ),
      );
    }
    if (!/\.ktx2($|\?)/i.test(resolved)) {
      return Promise.reject(
        new Error(`Radial depth for node "${nodeId}" at "${resolved}" must be a KTX2 cubemap`),
      );
    }

    let entry = this.depthTextures.get(nodeId);
    if (!entry) {
      entry = {};
      this.depthTextures.set(nodeId, entry);
    }
    if (entry.texture) return Promise.resolve(entry.texture);
    if (!entry.promise) {
      const currentEntry = entry;
      entry.promise = this.getKtx2Loader()
        .loadAsync(resolved)
        .then(
          (loaded) => {
            const texture = loaded as unknown as CubeTexture;
            if (!texture.isCubeTexture) {
              loaded.dispose();
              throw new Error(
                `Radial depth for node "${nodeId}" at "${resolved}" is not a cubemap texture`,
              );
            }
            const faces = texture.image as unknown as Array<{ width?: number; height?: number }>;
            if (
              !Array.isArray(faces) ||
              faces.length !== 6 ||
              faces.some((face) => face.width !== metadata.size || face.height !== metadata.size)
            ) {
              texture.dispose();
              throw new Error(
                `Radial depth for node "${nodeId}" at "${resolved}" does not match declared ` +
                  `${metadata.size}x${metadata.size} cubemap faces`,
              );
            }
            if (this.disposed || this.depthTextures.get(nodeId) !== currentEntry) {
              texture.dispose();
              throw new Error(`Radial depth load for released node "${nodeId}" was discarded`);
            }
            texture.colorSpace = NoColorSpace;
            texture.minFilter = NearestFilter;
            texture.magFilter = NearestFilter;
            texture.generateMipmaps = false;
            texture.name = `meshtour-offline-visibility-${nodeId}`;
            currentEntry.texture = texture;
            return texture;
          },
          (error) => {
            this.depthTextures.delete(nodeId);
            throw error;
          },
        );
    }
    return entry.promise;
  }

  /** Load and cache a transparent panorama-aligned configurable-object layer. */
  ensureLayer(url: string): Promise<Texture> {
    const resolved = resolveAssetUrl(this.config, url);
    let entry = this.layerTextures.get(resolved);
    if (!entry) {
      entry = {};
      this.layerTextures.set(resolved, entry);
    }
    if (entry.texture) return Promise.resolve(entry.texture);
    if (!entry.promise) {
      entry.promise = this.loadTexture(resolved).then(
        (texture) => {
          if (this.layerTextures.get(resolved) !== entry) {
            texture.dispose();
            throw new Error(`Configurable layer load for released URL "${resolved}" was discarded`);
          }
          entry!.texture = texture;
          return texture;
        },
        (error) => {
          this.layerTextures.delete(resolved);
          throw error;
        },
      );
    }
    return entry.promise;
  }

  /** Load and cache a non-panorama image such as a baked orthographic overview. */
  ensureAuxiliaryTexture(url: string): Promise<Texture> {
    const resolved = resolveAssetUrl(this.config, url);
    let entry = this.auxiliaryTextures.get(resolved);
    if (!entry) {
      entry = {};
      this.auxiliaryTextures.set(resolved, entry);
    }
    if (entry.texture) return Promise.resolve(entry.texture);
    if (!entry.promise) {
      entry.promise = this.loadTexture(resolved).then(
        (texture) => {
          if (this.auxiliaryTextures.get(resolved) !== entry) {
            texture.dispose();
            throw new Error(`Auxiliary texture load for released URL "${resolved}" was discarded`);
          }
          entry!.texture = texture;
          return texture;
        },
        (error) => {
          this.auxiliaryTextures.delete(resolved);
          throw error;
        },
      );
    }
    return entry.promise;
  }

  private entry(nodeId: string): NodeTextures {
    let entry = this.nodeTextures.get(nodeId);
    if (!entry) {
      entry = {};
      this.nodeTextures.set(nodeId, entry);
    }
    return entry;
  }

  private keepLoadedTexture(nodeId: string, entry: NodeTextures, texture: Texture): Texture {
    if (entry.released || this.nodeTextures.get(nodeId) !== entry) {
      texture.dispose();
      throw new Error(`Panorama load for released node "${nodeId}" was discarded`);
    }
    return texture;
  }

  /** Fastest available texture for the node: loads the preview (or sole) resolution. */
  ensurePreview(nodeId: string): Promise<Texture> {
    const entry = this.entry(nodeId);
    if (entry.preview) return Promise.resolve(entry.preview);
    if (!entry.previewPromise) {
      entry.previewPromise = this.loadTexture(this.panoramaUrl(nodeId, "preview")).then(
        (texture) => {
          this.keepLoadedTexture(nodeId, entry, texture);
          if (entry.full) {
            texture.dispose();
            return entry.full;
          }
          entry.preview = texture;
          return texture;
        },
        (error) => {
          entry.previewPromise = undefined;
          throw error;
        },
      );
    }
    return entry.previewPromise;
  }

  /** Full-resolution texture; identical to the preview when no suffixes are configured. */
  ensureFull(nodeId: string): Promise<Texture> {
    if (!this.hasDistinctQualities()) return this.ensurePreview(nodeId);
    const entry = this.entry(nodeId);
    if (entry.full) return Promise.resolve(entry.full);
    if (!entry.fullPromise) {
      entry.fullPromise = this.loadTexture(this.panoramaUrl(nodeId, "full")).then(
        (texture) => {
          this.keepLoadedTexture(nodeId, entry, texture);
          const previous = entry.preview;
          entry.full = texture;
          if (previous && this.onTextureUpgraded) {
            this.onTextureUpgraded(nodeId, previous, texture);
          }
          return texture;
        },
        (error) => {
          entry.fullPromise = undefined;
          throw error;
        },
      );
    }
    return entry.fullPromise;
  }

  /**
   * Best texture for display right now: resolves as soon as the preview is
   * ready and kicks off the full-res load in the background.
   */
  async ensureBest(nodeId: string): Promise<Texture> {
    const full = this.nodeTextures.get(nodeId)?.full;
    if (full) return full;
    const preview = await this.ensurePreview(nodeId);
    if (this.hasDistinctQualities()) {
      void this.ensureFull(nodeId).catch(() => {
        /* keep showing the preview if full res fails */
      });
    }
    return this.bestAvailable(nodeId) ?? preview;
  }

  /** Drop a preview after the projection has atomically adopted its full texture. */
  discardPreview(nodeId: string, texture: Texture): void {
    const entry = this.nodeTextures.get(nodeId);
    if (!entry || entry.preview !== texture) return;
    entry.preview = undefined;
    entry.previewPromise = undefined;
    texture.dispose();
  }

  bestAvailable(nodeId: string): Texture | null {
    const entry = this.nodeTextures.get(nodeId);
    return entry?.full ?? entry?.preview ?? null;
  }

  /** Force the texture onto the GPU now, so a transition never stalls mid-flight. */
  preupload(texture: Texture): void {
    this.renderer.initTexture(texture);
  }

  /** Upload all texture dependencies of a GLB before a transition begins. */
  preuploadObject(root: Object3D): void {
    root.traverse((object) => {
      const material = (object as Object3D & { material?: unknown }).material;
      const materials = Array.isArray(material) ? material : material ? [material] : [];
      for (const entry of materials) {
        if (!entry || typeof entry !== "object") continue;
        for (const value of Object.values(entry)) {
          if ((value as Texture | undefined)?.isTexture) this.preupload(value as Texture);
        }
      }
    });
  }

  /** Background-prefetch panoramas reachable through shared and node-specific links. */
  prefetchNeighbors(nodeId: string): void {
    for (const link of [...this.config.links, ...this.node(nodeId).links]) {
      void this.ensurePreview(link.to).catch(() => {});
      if (this.hasDistinctQualities()) void this.ensureFull(link.to).catch(() => {});
    }
  }

  /** Release decoded textures of every node not in `keep` (texture memory cap). */
  releaseExcept(keep: ReadonlySet<string>): void {
    for (const [nodeId, entry] of this.nodeTextures) {
      if (keep.has(nodeId)) continue;
      entry.released = true;
      entry.preview?.dispose();
      entry.full?.dispose();
      this.nodeTextures.delete(nodeId);
    }
    for (const [nodeId, entry] of this.depthTextures) {
      if (keep.has(nodeId)) continue;
      entry.texture?.dispose();
      this.depthTextures.delete(nodeId);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseExcept(new Set());
    for (const entry of this.layerTextures.values()) entry.texture?.dispose();
    this.layerTextures.clear();
    for (const entry of this.auxiliaryTextures.values()) entry.texture?.dispose();
    this.auxiliaryTextures.clear();
    for (const root of this.loadedObjects) this.disposeObject(root);
    this.loadedObjects.clear();
    this.ktx2Loader?.dispose();
    this.ktx2Loader = null;
  }

  private disposeObject(root: Object3D): void {
    const textures = new Set<Texture>();
    const materials = new Set<{ dispose(): void }>();
    const geometries = new Set<{ dispose(): void }>();
    root.traverse((object) => {
      const renderable = object as Object3D & {
        geometry?: { dispose(): void };
        material?: unknown;
      };
      if (renderable.geometry) geometries.add(renderable.geometry);
      const objectMaterials = Array.isArray(renderable.material)
        ? renderable.material
        : renderable.material
          ? [renderable.material]
          : [];
      for (const material of objectMaterials) {
        if (!material || typeof material !== "object") continue;
        if ("dispose" in material) materials.add(material as { dispose(): void });
        for (const value of Object.values(material)) {
          if ((value as Texture | undefined)?.isTexture) textures.add(value as Texture);
        }
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    root.removeFromParent();
  }
}
