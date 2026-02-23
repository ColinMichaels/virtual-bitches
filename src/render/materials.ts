import { PBRMaterial, Color3, Scene } from "@babylonjs/core";

/**
 * Premium resin dice material with translucency and clearcoat
 */
export function createResinDiceMaterial(scene: Scene): PBRMaterial {
  const m = new PBRMaterial("dice_resin", scene);

  // Core midnight navy base
  m.albedoColor = Color3.FromHexString("#0B1020");
  m.metallic = 0.0;
  m.roughness = 0.18;

  // Translucent resin
  m.alpha = 0.92;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.indexOfRefraction = 1.49; // Resin/acrylic

  // Refraction (light bending through material)
  m.subSurface.isRefractionEnabled = true;
  m.subSurface.refractionIntensity = 0.85;
  if (scene.environmentTexture) {
    m.subSurface.refractionTexture = scene.environmentTexture;
  }

  // Translucency (light passing through)
  m.subSurface.isTranslucencyEnabled = true;
  m.subSurface.translucencyIntensity = 0.35;

  // Clearcoat glossy finish
  m.clearCoat.isEnabled = true;
  m.clearCoat.intensity = 0.8;
  m.clearCoat.roughness = 0.06;

  // Subtle nebula glow (very faint)
  // Blend teal (#19D3C5) and magenta (#B43CFF) at ~3% strength
  const teal = Color3.FromHexString("#19D3C5");
  const magenta = Color3.FromHexString("#B43CFF");
  const nebulaGlow = Color3.Lerp(teal, magenta, 0.5).scale(0.03);
  m.emissiveColor = nebulaGlow;

  return m;
}

/**
 * Ivory satin paint material for pips and numerals
 */
export function createIvoryFillMaterial(scene: Scene): PBRMaterial {
  const m = new PBRMaterial("dice_ivory_fill", scene);

  m.albedoColor = Color3.FromHexString("#F2E7D0");
  m.metallic = 0.0;
  m.roughness = 0.45; // Satin paint finish

  return m;
}
