import { Mesh, type Object3D, type ShaderMaterial, type Texture } from "three";
import type { ConfigurableConfig, ConfigurableVariantConfig, TourConfig } from "../config/schema";
import {
  createDollhouseLayerMaterial,
  type DollhouseLayerSource,
  type DollhouseSource,
} from "../rendering/DollhouseMaterial";
import {
  type PanoramaLayerMaterial,
  type PanoramaLayerUniforms,
  type PanoramaProjection,
} from "../rendering/PanoramaMaterial";
import type { AssetManager } from "./AssetManager";

type ProjectionSlot = "a" | "b";

interface VariantTarget {
  config: ConfigurableConfig;
  layer: PanoramaLayerMaterial;
  variantId: string;
}

interface DollhouseContext {
  baseMaterial: ShaderMaterial;
  sources: readonly DollhouseSource[];
}

function resolveConfigurableTargetId(
  object: Object3D,
  root: Object3D,
  prefix: string,
): string | null {
  let current: Object3D | null = object;
  while (current && current !== root) {
    if (current.name.startsWith(prefix)) return current.name.slice(prefix.length);
    if (current.name.startsWith("proxy_")) return current.name.slice("proxy_".length);
    current = current.parent;
  }
  return null;
}

/**
 * Binds configurable definitions to proxy interactables and keeps their
 * transparent panorama layers synchronized with projection slots A and B.
 */
export class VariantManager {
  private assets: AssetManager;
  private targets = new Map<string, VariantTarget>();
  private meshTargets = new Map<Mesh, VariantTarget>();
  private dollhouseMaterials = new Map<VariantTarget, ShaderMaterial>();
  private dollhouseContext: DollhouseContext | null = null;
  private slotANode: string | null = null;
  private slotBNode: string | null = null;
  private updateGeneration = 0;

  constructor(
    config: TourConfig,
    assets: AssetManager,
    projection: PanoramaProjection,
    proxyRoot: Object3D,
  ) {
    this.assets = assets;

    const byInteractable = new Map<string, VariantTarget>();
    for (const configurable of config.configurables) {
      const target: VariantTarget = {
        config: configurable,
        layer: projection.createLayerMaterial(),
        variantId: configurable.default,
      };
      this.targets.set(configurable.id, target);
      byInteractable.set(configurable.interactable, target);
    }

    const found = new Set<string>();
    proxyRoot.traverse((object) => {
      if (!(object as Mesh).isMesh) return;
      const id = resolveConfigurableTargetId(object, proxyRoot, config.interactables.namePrefix);
      if (!id) return;
      const target = byInteractable.get(id);
      if (!target) return;
      const mesh = object as Mesh;
      mesh.material = target.layer.material;
      this.meshTargets.set(mesh, target);
      found.add(target.config.id);
    });

    for (const target of this.targets.values()) {
      if (!found.has(target.config.id)) {
        throw new Error(
          `Configurable "${target.config.id}" targets missing interactable "${target.config.interactable}"`,
        );
      }
    }
  }

  private variant(target: VariantTarget, variantId = target.variantId): ConfigurableVariantConfig {
    const variant = target.config.variants.find((entry) => entry.id === variantId);
    if (!variant) {
      throw new Error(`Unknown variant "${variantId}" for configurable "${target.config.id}"`);
    }
    return variant;
  }

  private async layerFor(
    target: VariantTarget,
    nodeId: string,
    variantId = target.variantId,
  ): Promise<Texture | null> {
    const url = this.variant(target, variantId).layers[nodeId];
    return url ? this.assets.ensureLayer(url) : null;
  }

  private setSlot(uniforms: PanoramaLayerUniforms, slot: ProjectionSlot, texture: Texture | null) {
    if (slot === "a") {
      uniforms.uLayerA.value = texture;
      uniforms.uHasLayerA.value = texture ? 1 : 0;
    } else {
      uniforms.uLayerB.value = texture;
      uniforms.uHasLayerB.value = texture ? 1 : 0;
    }
  }

  private async dollhouseLayersFor(
    target: VariantTarget,
    variantId = target.variantId,
  ): Promise<DollhouseLayerSource[]> {
    const sources = this.dollhouseContext?.sources ?? [];
    const textures = await Promise.all(
      sources.map((source) => this.layerFor(target, source.nodeId, variantId)),
    );
    textures.forEach((texture) => {
      if (texture) this.assets.preupload(texture);
    });
    return sources.map((source, index) => ({
      nodeId: source.nodeId,
      texture: textures[index] ?? null,
    }));
  }

  private setDollhouseLayers(material: ShaderMaterial, layers: readonly DollhouseLayerSource[]) {
    const layersByNode = new Map(layers.map((layer) => [layer.nodeId, layer.texture]));
    this.dollhouseContext?.sources.forEach((source, index) => {
      const texture = layersByNode.get(source.nodeId) ?? null;
      material.uniforms[`uLayer${index}`]!.value = texture;
      material.uniforms[`uHasLayer${index}`]!.value = texture ? 1 : 0;
    });
  }

  /** Build dollhouse projection materials for configurable proxy meshes. */
  async prepareDollhouseMaterials(
    baseMaterial: ShaderMaterial,
    sources: readonly DollhouseSource[],
  ): Promise<void> {
    this.disposeDollhouseMaterials();
    const context: DollhouseContext = { baseMaterial, sources };
    this.dollhouseContext = context;
    const prepared = await Promise.all(
      [...this.targets.values()].map(async (target) => {
        // A selection may commit while its first set of textures is loading.
        // Retry until the prepared layers describe the committed selection.
        while (this.dollhouseContext === context) {
          const variantId = target.variantId;
          const layers = await this.dollhouseLayersFor(target, variantId);
          if (variantId === target.variantId) return { target, layers };
        }
        return null;
      }),
    );
    if (this.dollhouseContext !== context) return;
    for (const entry of prepared) {
      if (!entry) continue;
      this.dollhouseMaterials.set(
        entry.target,
        createDollhouseLayerMaterial(baseMaterial, sources, entry.layers),
      );
    }
  }

  getDollhouseMaterial(mesh: Mesh): ShaderMaterial | null {
    const target = this.meshTargets.get(mesh);
    return target ? (this.dollhouseMaterials.get(target) ?? null) : null;
  }

  getPanoramaMaterial(mesh: Mesh): ShaderMaterial | null {
    return this.meshTargets.get(mesh)?.layer.material ?? null;
  }

  /** Load every selected layer before a panorama begins using this slot. */
  async prepareSlot(slot: ProjectionSlot, nodeId: string): Promise<void> {
    const entries = [...this.targets.values()];
    const textures = await Promise.all(entries.map((target) => this.layerFor(target, nodeId)));
    textures.forEach((texture) => {
      if (texture) this.assets.preupload(texture);
    });
    entries.forEach((target, index) => {
      this.setSlot(target.layer.uniforms, slot, textures[index] ?? null);
    });
    if (slot === "a") {
      this.slotANode = nodeId;
      this.slotBNode = null;
    } else {
      this.slotBNode = nodeId;
    }
  }

  /** Keep configurable layers in lockstep when panorama B is promoted to A. */
  promoteBToA(): void {
    if (!this.slotBNode) return;
    for (const target of this.targets.values()) {
      const uniforms = target.layer.uniforms;
      uniforms.uLayerA.value = uniforms.uLayerB.value;
      uniforms.uHasLayerA.value = uniforms.uHasLayerB.value;
      uniforms.uLayerB.value = null;
      uniforms.uHasLayerB.value = 0;
    }
    this.slotANode = this.slotBNode;
    this.slotBNode = null;
  }

  /** Preload and commit a partial selection as one visual transaction. */
  async setVariants(selections: Record<string, string>): Promise<boolean> {
    const generation = ++this.updateGeneration;
    const changes = Object.entries(selections)
      .map(([configurableId, variantId]) => {
        const target = this.targets.get(configurableId);
        if (!target) throw new Error(`Unknown configurable "${configurableId}"`);
        this.variant(target, variantId);
        return { target, variantId };
      })
      .filter(({ target, variantId }) => target.variantId !== variantId);
    if (changes.length === 0) return true;

    const prepared = await Promise.all(
      changes.map(async ({ target, variantId }) => {
        const [textureA, textureB, dollhouseLayers] = await Promise.all([
          this.slotANode ? this.layerFor(target, this.slotANode, variantId) : null,
          this.slotBNode ? this.layerFor(target, this.slotBNode, variantId) : null,
          this.dollhouseContext ? this.dollhouseLayersFor(target, variantId) : [],
        ]);
        if (textureA) this.assets.preupload(textureA);
        if (textureB) this.assets.preupload(textureB);
        return { target, variantId, textureA, textureB, dollhouseLayers };
      }),
    );

    // A newer user choice owns the commit. Loaded textures remain cached.
    if (generation !== this.updateGeneration) return false;
    for (const { target, variantId, textureA, textureB, dollhouseLayers } of prepared) {
      target.variantId = variantId;
      this.setSlot(target.layer.uniforms, "a", textureA);
      this.setSlot(target.layer.uniforms, "b", textureB);
      const dollhouseMaterial = this.dollhouseMaterials.get(target);
      if (dollhouseMaterial) this.setDollhouseLayers(dollhouseMaterial, dollhouseLayers);
    }
    return true;
  }

  async setVariant(configurableId: string, variantId: string): Promise<boolean> {
    return this.setVariants({ [configurableId]: variantId });
  }

  getVariant(configurableId: string): string | null {
    return this.targets.get(configurableId)?.variantId ?? null;
  }

  getVariants(): Record<string, string> {
    return Object.fromEntries(
      [...this.targets.entries()].map(([configurableId, target]) => [
        configurableId,
        target.variantId,
      ]),
    );
  }

  private disposeDollhouseMaterials(): void {
    for (const material of this.dollhouseMaterials.values()) material.dispose();
    this.dollhouseMaterials.clear();
  }

  dispose(): void {
    this.dollhouseContext = null;
    this.disposeDollhouseMaterials();
  }
}
