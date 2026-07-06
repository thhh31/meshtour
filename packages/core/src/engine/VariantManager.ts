import { Mesh, type Object3D, type Texture } from "three";
import type { ConfigurableConfig, ConfigurableVariantConfig, TourConfig } from "../config/schema";
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

function resolveInteractableId(object: Object3D, root: Object3D, prefix: string): string | null {
  let current: Object3D | null = object;
  while (current && current !== root) {
    if (current.name.startsWith(prefix)) return current.name.slice(prefix.length);
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
  private slotANode: string | null = null;
  private slotBNode: string | null = null;

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
      const id = resolveInteractableId(object, proxyRoot, config.interactables.namePrefix);
      if (!id) return;
      const target = byInteractable.get(id);
      if (!target) return;
      (object as Mesh).material = target.layer.material;
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

  async setVariant(configurableId: string, variantId: string): Promise<void> {
    const target = this.targets.get(configurableId);
    if (!target) throw new Error(`Unknown configurable "${configurableId}"`);
    this.variant(target, variantId);
    if (target.variantId === variantId) return;

    // Load all active projection slots first, then swap them together.
    const [textureA, textureB] = await Promise.all([
      this.slotANode ? this.layerFor(target, this.slotANode, variantId) : null,
      this.slotBNode ? this.layerFor(target, this.slotBNode, variantId) : null,
    ]);
    if (textureA) this.assets.preupload(textureA);
    if (textureB) this.assets.preupload(textureB);

    target.variantId = variantId;
    this.setSlot(target.layer.uniforms, "a", textureA);
    this.setSlot(target.layer.uniforms, "b", textureB);
  }

  getVariant(configurableId: string): string | null {
    return this.targets.get(configurableId)?.variantId ?? null;
  }
}
