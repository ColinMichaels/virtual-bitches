/**
 * Dice rendering system for BISCUITS
 * Complete rebuild using dice-box approach and assets
 *
 * @see https://github.com/3d-dice/dice-box
 * @see https://github.com/3d-dice/dice-themes
 * @license MIT (dice-box), CC0 (dice-themes)
 */

import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Animation,
  CubicEase,
  EasingFunction,
  ShadowGenerator,
  HighlightLayer,
  Texture,
  Ray,
} from "@babylonjs/core";
import { CustomMaterial } from "@babylonjs/materials/custom/customMaterial";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import { DieState, DieKind } from "../engine/types.js";
import { themeManager } from "../services/themeManager.js";

const DIE_SIZES: Record<DieKind, number> = {
  d4: 1.2,
  d6: 1.0,
  d8: 1.1,
  d10: 1.1,
  d12: 1.3,
  d20: 1.4,
};

// Individual die colors - muted palette for better visibility
const DIE_COLORS: Color3[] = [
  Color3.FromHexString("#2a2a2a"), // Dark gray
  Color3.FromHexString("#3d5a4a"), // Muted green
  Color3.FromHexString("#4a5c7a"), // Muted blue
  Color3.FromHexString("#b8a062"), // Muted gold
  Color3.FromHexString("#8f6f7e"), // Muted pink
  Color3.FromHexString("#7a3d3d"), // Muted red
  Color3.FromHexString("#8a4a4a"), // Muted red #2
  Color3.FromHexString("#c4b399"), // Muted cream
  Color3.FromHexString("#c8c8c8"), // Light gray
  Color3.FromHexString("#2a2a2a"), // Dark gray #2
  Color3.FromHexString("#6b5139"), // Muted brown
  Color3.FromHexString("#2a2a2a"), // Dark gray #3
  Color3.FromHexString("#5a6470"), // Muted blue-gray
  Color3.FromHexString("#7a3d3d"), // Muted red
  Color3.FromHexString("#6b5688"), // Muted purple
];

export class DiceRenderer {
  private meshes = new Map<string, Mesh>();
  private selectedMeshes = new Set<string>();
  private shadowGenerator: ShadowGenerator | null = null;
  private highlightLayer: HighlightLayer;
  private colorIndex = 0;
  private dieColors = new Map<string, string>();

  // Template meshes (for instancing)
  private templateMeshes = new Map<string, Mesh>();

  // Materials with light/dark texture variants
  private materialLight: StandardMaterial | null = null;
  private materialDark: StandardMaterial | null = null;

  // Geometry data with collider face maps
  private geometryData: any = null;
  private geometryLoaded = false;

  // Debug mode tracking
  private debugMeshes = new Map<string, Mesh>();
  private isDebugMode = false;

  // Rotation cache for raycast-detected rotations (d10, d12)
  private rotationCache = new Map<string, Map<number, Vector3>>();

  // Theme change unsubscribe function
  private unsubscribeTheme?: () => void;

  constructor(private scene: Scene) {
    const generators = this.scene.lights
      .map((light) => light.getShadowGenerator())
      .filter((gen): gen is ShadowGenerator => gen !== null);
    this.shadowGenerator = generators[0] || null;

    // Create highlight layer for selection glow
    this.highlightLayer = new HighlightLayer("highlight", this.scene);
    this.highlightLayer.blurHorizontalSize = 1.0;
    this.highlightLayer.blurVerticalSize = 1.0;

    // Subscribe to theme changes
    this.unsubscribeTheme = themeManager.onThemeChange(() => {
      this.onThemeChanged();
    });

    // Initialize asynchronously
    this.initializeAsync();
  }

  private async initializeAsync(): Promise<void> {
    try {
      // Load geometry data from dice-box
      await this.loadGeometry();

      // Create materials with textures
      await this.createMaterials();

      // Build rotation cache for d10 and d12 using raycast detection
      await this.buildRotationCache();

      this.geometryLoaded = true;
      console.log("✅ Dice-box rendering system initialized");
    } catch (error) {
      console.error("❌ Failed to initialize dice-box renderer:", error);
      this.geometryLoaded = false;
    }
  }

  /**
   * Build rotation cache for d10 and d12 by finding rotations that work
   */
  private async buildRotationCache(): Promise<void> {
    console.log("🔍 Building rotation cache for d10 and d12...");

    const diceToCache: Array<{ kind: DieKind; maxValue: number }> = [
      { kind: "d10", maxValue: 10 },
      { kind: "d12", maxValue: 12 },
    ];

    for (const { kind, maxValue } of diceToCache) {
      const cache = new Map<number, Vector3>();

      // Use the COLLIDER mesh for raycasting, not the visual mesh
      const colliderName = `${kind}_collider`;
      const template = this.templateMeshes.get(colliderName) || this.templateMeshes.get(kind);

      if (!template) {
        console.warn(`⚠️ No template for ${kind}, skipping cache`);
        continue;
      }

      console.log(`  Using template: ${template.name}`);

      // Create a temporary mesh for testing
      const testMesh = template.clone(`test_${kind}`, null, false, false) as Mesh;
      testMesh.setEnabled(true);
      testMesh.position = new Vector3(0, 10, 0);

      // For each face value, find a rotation that works
      for (let value = 1; value <= maxValue; value++) {
        const displayValue = kind === "d10" ? (value % 10) : value;
        console.log(`  Searching for ${kind} value ${displayValue}...`);
        const rotation = this.findRotationForValue(testMesh, kind, displayValue, 2000);

        if (rotation) {
          cache.set(displayValue, rotation);
          console.log(`  ✓ ${kind} value ${displayValue}: FOUND`);
        } else {
          // Try again with more lenient detection
          console.warn(`  ⚠️ ${kind} value ${displayValue}: NOT FOUND after 2000 attempts, retrying with lenient detection...`);
          const rotation2 = this.findRotationForValue(testMesh, kind, displayValue, 3000);
          if (rotation2) {
            cache.set(displayValue, rotation2);
            console.log(`  ✓ ${kind} value ${displayValue}: FOUND (lenient)`);
          } else {
            console.error(`  ❌ ${kind} value ${displayValue}: FAILED - using fallback`);
            // Use a random rotation as fallback
            cache.set(displayValue, new Vector3(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2));
          }
        }
      }

      testMesh.dispose();
      this.rotationCache.set(kind, cache);
    }

    console.log("✅ Rotation cache built");
  }

  /**
   * Load dice geometry using dice-box format
   * Uses SceneLoader to import .babylon JSON format
   */
  private async loadGeometry(): Promise<void> {
    const themeConfig = themeManager.getCurrentThemeConfig();
    if (!themeConfig) {
      throw new Error("No theme config available");
    }

    const geometryPath = `${themeManager.getCurrentThemePath()}/${themeConfig.meshFile}`;
    console.log(`📦 Loading geometry from: ${geometryPath}`);

    const response = await fetch(geometryPath);
    if (!response.ok) {
      throw new Error(`Failed to load geometry: ${response.statusText}`);
    }

    this.geometryData = await response.json();

    // Strip physics properties to avoid "Physics not enabled" errors
    this.geometryData.physicsEnabled = false;
    if (this.geometryData.meshes) {
      this.geometryData.meshes.forEach((mesh: any) => {
        delete mesh.physicsImpostor;
        delete mesh.physicsMass;
        delete mesh.physicsFriction;
        delete mesh.physicsRestitution;
      });
    }

    // Import meshes using SceneLoader (dice-box approach)
    const result = await SceneLoader.ImportMeshAsync(
      null, // Load all meshes
      null, // No base URL
      "data:" + JSON.stringify(this.geometryData), // Pass JSON as data URI
      this.scene
    );

    // Process imported meshes
    result.meshes.forEach((mesh) => {
      if (mesh.name === "__root__") {
        mesh.dispose();
        return;
      }

      // Store as template mesh (disabled, used for instancing)
      mesh.setEnabled(false);
      mesh.isPickable = false;
      mesh.freezeNormals();

      // Shrink colliders slightly (dice-box approach)
      if (mesh.name.includes("collider")) {
        mesh.scaling.scaleInPlace(0.9);
      }

      this.templateMeshes.set(mesh.name, mesh as Mesh);
      console.log(`📦 Loaded template: ${mesh.name}`);
    });

    // Store collider face map for value detection
    this.scene.metadata = this.scene.metadata || {};
    this.scene.metadata.colliderFaceMap = this.geometryData.colliderFaceMap;
  }

  /**
   * Create materials with light/dark texture variants
   * Following dice-box approach: two materials for readability
   */
  private async createMaterials(): Promise<void> {
    const themeConfig = themeManager.getCurrentThemeConfig();
    if (!themeConfig) {
      console.error("❌ No theme config available");
      return;
    }

    console.log(`🎨 Loading materials for theme: ${themeConfig.name}`);

    if (themeConfig.material.type === 'standard') {
      await this.createStandardMaterial();
    } else {
      await this.createColorMaterial();
    }
  }

  /**
   * Create standard material (diceOfRolling style)
   * Uses texture atlas with all colors baked in
   */
  private async createStandardMaterial(): Promise<void> {
    const basePath = themeManager.getCurrentThemePath();
    const themeConfig = themeManager.getCurrentThemeConfig()!;
    console.log("🎨 Loading standard material from:", basePath);

    const diffuseTexture = new Texture(`${basePath}/${themeConfig.material.diffuseTexture}`, this.scene);
    const normalMap = new Texture(`${basePath}/${themeConfig.material.bumpTexture}`, this.scene);

    let specularMap: Texture | null = null;
    if (themeConfig.material.specularTexture) {
      specularMap = new Texture(`${basePath}/${themeConfig.material.specularTexture}`, this.scene);
    }

    // Wait for textures to load
    await new Promise<void>((resolve) => {
      let loadedCount = 0;
      const totalTextures = specularMap ? 3 : 2;
      const checkLoaded = () => {
        loadedCount++;
        if (loadedCount === totalTextures) resolve();
      };
      diffuseTexture.onLoadObservable.addOnce(checkLoaded);
      normalMap.onLoadObservable.addOnce(checkLoaded);
      if (specularMap) {
        specularMap.onLoadObservable.addOnce(checkLoaded);
      }
    });

    console.log("✅ Standard material textures loaded");

    this.materialDark = new StandardMaterial("dice-material", this.scene);
    this.materialDark.diffuseTexture = diffuseTexture;
    this.materialDark.bumpTexture = normalMap;
    this.materialDark.bumpTexture.level = themeConfig.material.bumpLevel || 0.5;

    if (specularMap) {
      this.materialDark.specularTexture = specularMap;
    }
    this.materialDark.specularColor = new Color3(0.5, 0.5, 0.5);
    this.materialDark.specularPower = themeConfig.material.specularPower || 64;

    this.materialLight = this.materialDark;
  }

  /**
   * Create color material (default/smooth-pip style)
   * Uses transparent texture overlay on colored dice body
   * Following dice-box approach: mix diffuse color with texture alpha
   */
  private async createColorMaterial(): Promise<void> {
    const basePath = themeManager.getCurrentThemePath();
    const themeConfig = themeManager.getCurrentThemeConfig()!;
    console.log("🎨 Loading color material from:", basePath);

    const diffuseConfig = themeConfig.material.diffuseTexture as { light: string; dark: string };
    // Load textures with alpha channel enabled
    const diffuseLight = new Texture(`${basePath}/${diffuseConfig.light}`, this.scene);
    diffuseLight.hasAlpha = true;
    const diffuseDark = new Texture(`${basePath}/${diffuseConfig.dark}`, this.scene);
    diffuseDark.hasAlpha = true;
    const normalMap = new Texture(`${basePath}/${themeConfig.material.bumpTexture}`, this.scene);

    let specularMap: Texture | null = null;
    if (themeConfig.material.specularTexture) {
      specularMap = new Texture(`${basePath}/${themeConfig.material.specularTexture}`, this.scene);
    }

    await new Promise<void>((resolve) => {
      let loadedCount = 0;
      const totalTextures = specularMap ? 4 : 3;
      const checkLoaded = () => {
        loadedCount++;
        if (loadedCount === totalTextures) resolve();
      };
      diffuseLight.onLoadObservable.addOnce(checkLoaded);
      diffuseDark.onLoadObservable.addOnce(checkLoaded);
      normalMap.onLoadObservable.addOnce(checkLoaded);
      if (specularMap) {
        specularMap.onLoadObservable.addOnce(checkLoaded);
      }
    });

    console.log("✅ Color material textures loaded");

    // Apply texture scaling if specified (for themes with different texture sizes)
    const textureScale = (themeConfig.material as any).textureScale;
    if (textureScale) {
      diffuseLight.uScale = textureScale.u || 1;
      diffuseLight.vScale = textureScale.v || 1;
      diffuseDark.uScale = textureScale.u || 1;
      diffuseDark.vScale = textureScale.v || 1;
      normalMap.uScale = textureScale.u || 1;
      normalMap.vScale = textureScale.v || 1;
    }

    // Apply texture offset if specified (for fine-tuning alignment)
    const textureOffset = (themeConfig.material as any).textureOffset;
    if (textureOffset) {
      diffuseLight.uOffset = textureOffset.u || 0;
      diffuseLight.vOffset = textureOffset.v || 0;
      diffuseDark.uOffset = textureOffset.u || 0;
      diffuseDark.vOffset = textureOffset.v || 0;
      normalMap.uOffset = textureOffset.u || 0;
      normalMap.vOffset = textureOffset.v || 0;
    }

    // Simplified approach: just use white base material with texture overlay
    // No custom colors for now - focus on getting the texture mapping right first
    this.materialDark = new StandardMaterial("dice-material-white", this.scene);
    this.materialDark.diffuseColor = new Color3(1, 1, 1); // White base
    this.materialDark.diffuseTexture = diffuseLight;
    this.materialDark.bumpTexture = normalMap;
    this.materialDark.bumpTexture.level = themeConfig.material.bumpLevel || 0.5;
    if (specularMap) {
      this.materialDark.specularTexture = specularMap;
    }
    this.materialDark.specularColor = new Color3(0.8, 0.8, 0.8);
    this.materialDark.specularPower = themeConfig.material.specularPower || 64;

    // Use the same white material for both light and dark (just focusing on getting it to work)
    this.materialLight = this.materialDark;
  }

  /**
   * Create a die instance from template mesh
   * Uses dice-box instancing approach for performance
   */
  createDie(die: DieState): Mesh {
    // Wait for geometry to load if not ready
    if (!this.geometryLoaded || !this.materialLight || !this.materialDark) {
      console.warn("⚠️ Geometry not loaded yet, using placeholder");
      return this.createPlaceholderDie(die);
    }

    // Get template mesh
    const templateName = die.def.kind;
    const template = this.templateMeshes.get(templateName);

    if (!template) {
      console.warn(`⚠️ No template for ${die.def.kind}, using placeholder`);
      return this.createPlaceholderDie(die);
    }

    // IMPORTANT: Clone mesh instead of creating instance
    // Instances cannot have individual materials - they share the template's material
    // We need separate materials per die for different colors
    const instance = template.clone(die.id, null, false, false) as Mesh;

    if (!instance) {
      console.error(`❌ Failed to clone mesh for ${die.def.kind}`);
      return this.createPlaceholderDie(die);
    }

    instance.setEnabled(true);
    instance.isPickable = true; // Enable clicking for selection
    console.log(`✅ Cloned mesh for ${die.def.kind}:`, die.id);

    // For now, just use white material directly - no custom colors per die
    // Store white color for UI purposes
    const hexColor = "#ffffff";
    this.dieColors.set(die.id, hexColor);

    console.log(`🎲 Creating ${die.def.kind} with white material`);

    // Use the shared white material directly (no cloning, no color customization)
    instance.material = this.materialDark;

    // Apply size scaling - dice-box models are VERY small, need significant scaling
    const size = DIE_SIZES[die.def.kind];
    const scaleFactor = size * 10; // Multiply by 10 for proper size
    instance.scaling = new Vector3(scaleFactor, scaleFactor, scaleFactor);

    // Enable shadows
    instance.receiveShadows = true;
    if (this.shadowGenerator) {
      this.shadowGenerator.addShadowCaster(instance);
    }

    // Store reference
    this.meshes.set(die.id, instance);

    console.log(`🎲 Created ${die.def.kind} successfully`);

    return instance;
  }

  /**
   * Detect which face is pointing up using raycast
   * Returns the face index from the collider geometry
   * Only accepts faces that are relatively horizontal (not on edge/vertex)
   */
  private detectUpwardFace(mesh: Mesh): number | null {
    // Cast ray downward from directly above the die's center
    const rayOrigin = mesh.position.add(new Vector3(0, 5, 0));
    const rayDirection = new Vector3(0, -1, 0); // Straight down
    const ray = new Ray(rayOrigin, rayDirection, 10);

    // Pick the mesh with the ray
    const pickInfo = ray.intersectsMesh(mesh);

    if (pickInfo.hit && pickInfo.faceId !== undefined && pickInfo.getNormal(true)) {
      const normal = pickInfo.getNormal(true)!;

      // Check if the face is relatively horizontal (normal pointing up)
      const upDot = Vector3.Dot(normal, new Vector3(0, 1, 0));

      // Fine-tuned threshold for d10/d12
      // 0.35 = ~69 degrees tolerance (sweet spot between flatness and finding all values)
      if (upDot > 0.35) {
        // Additional check: the hit point should be above the mesh center
        const hitPoint = pickInfo.pickedPoint;
        if (hitPoint) {
          const heightDiff = hitPoint.y - mesh.position.y;
          // The hit should be elevated above center
          if (heightDiff > 0) {
            return pickInfo.faceId;
          }
        }
      }
    }

    return null;
  }

  /**
   * Get the die value from a collider face index using colliderFaceMap
   */
  private getFaceValueFromCollider(dieKind: string, faceId: number): number | null {
    const colliderFaceMap = this.scene.metadata?.colliderFaceMap;
    if (!colliderFaceMap || !colliderFaceMap[dieKind]) {
      return null;
    }

    const faceValue = colliderFaceMap[dieKind][faceId.toString()];
    return faceValue !== undefined ? faceValue : null;
  }

  /**
   * Try multiple random rotations to find one that shows the desired value
   * Uses raycast detection to verify the face
   */
  private findRotationForValue(mesh: Mesh, dieKind: string, targetValue: number, maxAttempts: number = 500): Vector3 | null {
    // For d10 and d12, use raycast-based detection with random rotations
    // Generate random rotations and test which face lands up

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Generate random rotation
      const testRotation = new Vector3(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      // Apply rotation to mesh temporarily
      const originalRotation = mesh.rotation.clone();
      mesh.rotation = testRotation;

      // Force mesh to recompute world matrix
      mesh.computeWorldMatrix(true);

      // Detect which face is up
      const faceId = this.detectUpwardFace(mesh);
      if (faceId !== null) {
        const faceValue = this.getFaceValueFromCollider(dieKind, faceId);

        if (faceValue === targetValue) {
          // Found a rotation that shows the target value!
          console.log(`    Found rotation for ${dieKind} value ${targetValue} after ${attempt + 1} attempts`);
          mesh.rotation = originalRotation; // Restore original
          return testRotation;
        }
      }

      // Restore original rotation for next attempt
      mesh.rotation = originalRotation;
    }

    return null; // Couldn't find a suitable rotation
  }

  /**
   * Get rotation (Euler angles) to show the specified value face-up
   * Based on standard die orientations
   */
  private getRotationForValue(dieKind: string, value: number): Vector3 {
    // D6 rotations (cube)
    // Empirically determined from debug view
    if (dieKind === "d6") {
      const d6Rotations: Record<number, Vector3> = {
        1: new Vector3(Math.PI, 0, 0),         // face 1 on top
        2: new Vector3(-Math.PI / 2, 0, 0),    // face 2 on top
        3: new Vector3(0, 0, -Math.PI / 2),    // face 3 on top
        4: new Vector3(0, 0, Math.PI / 2),     // face 4 on top
        5: new Vector3(Math.PI / 2, 0, 0),     // face 5 on top
        6: new Vector3(0, 0, 0),               // face 6 on top
      };
      return d6Rotations[value] || new Vector3(0, 0, 0);
    }

    // D8 rotations (octahedron)
    // Empirically determined rotation mapping for all 8 faces
    if (dieKind === "d8") {
      const faceTilt = 0.615; // ~35 degrees for proper face-flat orientation

      // All 8 rotations mapped to their faces:
      const rotationToFace = [
        new Vector3(faceTilt, 0, Math.PI / 4),              // rotation 0 → face 1
        new Vector3(-faceTilt, 0, -Math.PI / 4),            // rotation 1 → face 5
        new Vector3(faceTilt, 0, -Math.PI / 4),             // rotation 2 → face 4
        new Vector3(-faceTilt, 0, Math.PI / 4),             // rotation 3 → face 8
        new Vector3(faceTilt, 0, 3 * Math.PI / 4),          // rotation 4 → face 2
        new Vector3(-faceTilt, 0, -3 * Math.PI / 4),        // rotation 5 → face 6
        new Vector3(faceTilt, 0, -3 * Math.PI / 4),         // rotation 6 → face 3
        new Vector3(-faceTilt, 0, 3 * Math.PI / 4),         // rotation 7 → face 7
      ];

      // Map desired face value to correct rotation index
      const valueToRotationIndex: Record<number, number> = {
        1: 0,  // face 1 → use rotation 0
        2: 4,  // face 2 → use rotation 4
        3: 6,  // face 3 → use rotation 6
        4: 2,  // face 4 → use rotation 2
        5: 1,  // face 5 → use rotation 1
        6: 5,  // face 6 → use rotation 5
        7: 7,  // face 7 → use rotation 7
        8: 3,  // face 8 → use rotation 3
      };

      const rotationIndex = valueToRotationIndex[value] ?? 0;
      return rotationToFace[rotationIndex];
    }

    // D10/D100 rotations - use cached raycast-detected rotations
    if (dieKind === "d10" || dieKind === "d100") {
      const displayValue = value % 10;
      const cache = this.rotationCache.get("d10");

      if (cache && cache.has(displayValue)) {
        return cache.get(displayValue)!;
      }

      // Fallback if cache miss
      console.warn(`⚠️ No cached rotation for d10 value ${displayValue}`);
      return new Vector3(0, 0, 0);
    }

    // D12 rotations - use cached raycast-detected rotations
    if (dieKind === "d12") {
      const cache = this.rotationCache.get("d12");

      if (cache && cache.has(value)) {
        return cache.get(value)!;
      }

      // Fallback if cache miss
      console.warn(`⚠️ No cached rotation for d12 value ${value}`);
      return new Vector3(0, 0, 0);
    }

    // D20 rotations (icosahedron)
    if (dieKind === "d20") {
      const angleStep = (Math.PI * 2) / 20;
      return new Vector3(
        Math.PI / 3,
        angleStep * (value - 1),
        0
      );
    }

    // D4 - tetrahedral (special case, number is usually on bottom edges)
    if (dieKind === "d4") {
      const angleStep = (Math.PI * 2) / 3;
      return new Vector3(
        -Math.PI / 3,
        angleStep * (value - 1),
        0
      );
    }

    // Default
    return new Vector3(0, 0, 0);
  }

  /**
   * Fallback: create placeholder die if geometry not loaded
   */
  private createPlaceholderDie(die: DieState): Mesh {
    const mesh = MeshBuilder.CreateBox(die.id, { size: 1 }, this.scene);

    const mat = new StandardMaterial(`${die.id}-mat`, this.scene);
    const color = DIE_COLORS[this.colorIndex % DIE_COLORS.length];
    mat.diffuseColor = color;
    mat.specularColor = new Color3(1, 1, 1);
    mat.specularPower = 128;

    mesh.material = mat;
    this.meshes.set(die.id, mesh);
    this.colorIndex++;

    return mesh;
  }

  updateDie(die: DieState) {
    const mesh = this.meshes.get(die.id);
    if (!mesh) return;

    // Update selection state
    if (mesh.material instanceof StandardMaterial) {
      if (this.selectedMeshes.has(die.id)) {
        mesh.material.emissiveColor = new Color3(1, 1, 0.3);
      } else {
        mesh.material.emissiveColor = new Color3(0, 0, 0);
      }
    }
  }

  setSelected(dieId: string, selected: boolean) {
    if (selected) {
      this.selectedMeshes.add(dieId);
    } else {
      this.selectedMeshes.delete(dieId);
    }

    const mesh = this.meshes.get(dieId);
    if (!mesh) return;

    if (selected) {
      this.highlightLayer.addMesh(mesh, new Color3(1, 0.8, 0));
    } else {
      this.highlightLayer.removeMesh(mesh);
    }
  }

  animateRoll(dice: DieState[], onComplete: () => void) {
    const activeDice = dice.filter((d) => d.inPlay && !d.scored);
    if (activeDice.length === 0) {
      onComplete();
      return;
    }

    // Arrange in grid
    const cols = Math.ceil(Math.sqrt(activeDice.length));
    const spacing = 2.5;

    activeDice.forEach((die, i) => {
      let mesh = this.meshes.get(die.id);
      if (!mesh) {
        mesh = this.createDie(die);
      }

      const row = Math.floor(i / cols);
      const col = i % cols;
      const offsetX = (col - cols / 2) * spacing;
      const offsetZ = (row - Math.floor(activeDice.length / cols) / 2) * spacing;

      const randomX = offsetX + (Math.random() - 0.5) * 1.5;
      const randomZ = offsetZ + (Math.random() - 0.5) * 1.5;

      const startY = 15;
      const endY = 0.6;

      mesh.position = new Vector3(randomX, startY, randomZ);

      // Calculate rotation to show the rolled value face-up
      const baseRotation = this.getRotationForValue(die.def.kind, die.value);

      // Add random Y-axis rotation for natural variation
      const randomYRotation = Math.random() * Math.PI * 2;
      const finalRotation = new Vector3(
        baseRotation.x,
        baseRotation.y + randomYRotation,
        baseRotation.z
      );

      const startRotation = new Vector3(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );
      mesh.rotation = startRotation;

      const animDuration = 30 + Math.random() * 10;

      // Drop animation
      const dropAnim = new Animation(
        `${die.id}-drop`,
        "position.y",
        60,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      dropAnim.setKeys([
        { frame: 0, value: startY },
        { frame: animDuration * 0.7, value: endY - 0.1 },
        { frame: animDuration * 0.85, value: endY + 0.3 },
        { frame: animDuration * 0.95, value: endY + 0.1 },
        { frame: animDuration, value: endY },
      ]);

      // Rotation animation
      const rotAnim = new Animation(
        `${die.id}-rotate`,
        "rotation",
        60,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      const midRotation = new Vector3(
        startRotation.x + (Math.random() - 0.5) * Math.PI * 4,
        startRotation.y + (Math.random() - 0.5) * Math.PI * 6,
        startRotation.z + (Math.random() - 0.5) * Math.PI * 4
      );

      rotAnim.setKeys([
        { frame: 0, value: startRotation },
        { frame: animDuration * 0.25, value: midRotation },
        { frame: animDuration, value: finalRotation },
      ]);

      const ease = new CubicEase();
      ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
      dropAnim.setEasingFunction(ease);
      rotAnim.setEasingFunction(ease);

      mesh.animations = [dropAnim, rotAnim];
      this.scene.beginAnimation(mesh, 0, animDuration, false, 0.45, () => {
        this.updateDie(die);
      });
    });

    setTimeout(onComplete, 1000);
  }

  animateScore(dice: DieState[], selected: Set<string>, onComplete: () => void) {
    const toScore = dice.filter((d) => selected.has(d.id));
    if (toScore.length === 0) {
      onComplete();
      return;
    }

    const alreadyScored = dice.filter((d) => d.scored && !selected.has(d.id)).length;

    const gridCols = 3;
    const gridRows = 4;
    const maxGridDice = gridCols * gridRows;
    const spacingX = 1.5;
    const spacingZ = 1.5;
    const baseX = 12;
    const baseZ = -3;
    const baseY = 0.6;

    toScore.forEach((die, i) => {
      const mesh = this.meshes.get(die.id);
      if (!mesh) return;

      this.highlightLayer.removeMesh(mesh);

      const totalIndex = alreadyScored + i;
      let targetX: number, targetY: number, targetZ: number;

      if (totalIndex < maxGridDice) {
        const row = Math.floor(totalIndex / gridCols);
        const col = totalIndex % gridCols;
        const offsetX = (col - (gridCols - 1) / 2) * spacingX;

        targetX = baseX + offsetX;
        targetY = baseY;
        targetZ = baseZ + row * spacingZ;
      } else {
        const stackIndex = totalIndex - maxGridDice;
        targetX = baseX;
        targetY = baseY + stackIndex * 1.3;
        targetZ = baseZ + 1.5 * spacingZ;
      }

      const moveAnim = new Animation(
        `${die.id}-score`,
        "position",
        60,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      moveAnim.setKeys([
        { frame: 0, value: mesh.position.clone() },
        { frame: 20, value: new Vector3(targetX, targetY, targetZ) },
      ]);

      // Reset rotation to clean orientation while keeping value face-up
      const baseRotation = this.getRotationForValue(die.def.kind, die.value);
      const rotAnim = new Animation(
        `${die.id}-score-rot`,
        "rotation",
        60,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      rotAnim.setKeys([
        { frame: 0, value: mesh.rotation.clone() },
        { frame: 20, value: baseRotation },
      ]);

      mesh.animations = [moveAnim, rotAnim];
      this.scene.beginAnimation(mesh, 0, 20, false);
    });

    setTimeout(onComplete, 400);
  }

  getMesh(dieId: string): Mesh | undefined {
    return this.meshes.get(dieId);
  }

  getDieColor(dieId: string): string | undefined {
    return this.dieColors.get(dieId);
  }

  clearDice(): void {
    this.meshes.forEach((mesh) => {
      mesh.dispose();
    });
    this.meshes.clear();
    this.dieColors.clear();
    this.colorIndex = 0;
  }

  private colorToHex(color: Color3): string {
    const r = Math.floor(color.r * 255)
      .toString(16)
      .padStart(2, "0");
    const g = Math.floor(color.g * 255)
      .toString(16)
      .padStart(2, "0");
    const b = Math.floor(color.b * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${r}${g}${b}`;
  }

  /**
   * Create debug dice showing all face values for a specific die type
   * Used by the debug view for rotation testing
   */
  createDebugDice(dieKind: DieKind, faceCount: number): void {
    if (!this.geometryLoaded) {
      console.warn("⚠️ Geometry not loaded yet for debug dice");
      return;
    }

    this.isDebugMode = true;

    // Grid layout parameters - adjust spacing based on die type
    const spacing = DIE_SIZES[dieKind] * 2.5;
    const columns = Math.min(faceCount, 10); // Max 10 per row
    const startX = -(columns - 1) * spacing / 2;
    const startZ = faceCount > 10 ? spacing : 0;

    // Row offset for different die types (stagger vertically)
    const dieTypeOffsets: Record<DieKind, number> = {
      d4: 12,
      d6: 8,
      d8: 4,
      d10: 0,
      d12: -4,
      d20: -8,
    };
    const rowOffset = dieTypeOffsets[dieKind];

    for (let value = 1; value <= faceCount; value++) {
      // For d10, display 0-9 instead of 1-10
      const displayValue = dieKind === "d10" ? (value === 10 ? 0 : value) : value;

      // Calculate grid position
      const col = (value - 1) % columns;
      const row = Math.floor((value - 1) / columns);
      const x = startX + col * spacing;
      const z = startZ - row * spacing * 1.2 + rowOffset;
      const y = 2; // Elevated above ground

      // Create die at position with specific rotation
      const dieId = `debug_${dieKind}_${displayValue}`;
      const die: DieState = {
        id: dieId,
        def: { kind: dieKind, sides: faceCount },
        value: displayValue,
        inPlay: true,
        scored: false,
      };

      // Create the die
      const mesh = this.createDie(die);

      // Set position
      mesh.position = new Vector3(x, y, z);

      // Get rotation for this value (no random Y-axis for debug)
      const rotation = this.getRotationForValue(dieKind, displayValue);

      // Apply rotation directly without animation
      mesh.rotation = rotation;
      this.debugMeshes.set(dieId, mesh);
    }
  }

  /**
   * Clear all debug dice from the scene
   */
  clearDebugDice(): void {
    this.debugMeshes.forEach((mesh, id) => {
      mesh.dispose();
      this.meshes.delete(id);
    });
    this.debugMeshes.clear();
    this.isDebugMode = false;
  }

  /**
   * Handle theme change - reload materials and update all dice
   */
  private async onThemeChanged(): Promise<void> {
    console.log("🔄 Theme changed, reloading materials...");

    // Dispose old materials
    this.materialLight?.dispose();
    this.materialDark?.dispose();

    // Reload materials with new theme
    await this.createMaterials();

    // Update all existing dice with new materials
    this.meshes.forEach((mesh, dieId) => {
      const color = this.dieColors.get(dieId);
      if (color && this.materialDark) {
        // Clone material for this die
        const material = this.materialDark.clone(`${dieId}-material`);
        const colorObj = Color3.FromHexString(color);

        // Tint the texture with the die color
        material.diffuseColor = new Color3(
          0.5 + colorObj.r * 0.5,
          0.5 + colorObj.g * 0.5,
          0.5 + colorObj.b * 0.5
        );

        mesh.material = material;
      }
    });

    console.log("✅ Theme updated for all dice");
  }

  /**
   * Update texture mapping for live debugging
   * Updates scale and offset for all textures on current materials
   */
  updateTextureMapping(scaleU: number, scaleV: number, offsetU: number, offsetV: number): void {
    console.log(`🎨 Updating texture mapping: scale(${scaleU}, ${scaleV}) offset(${offsetU}, ${offsetV})`);

    // Update materialDark textures
    if (this.materialDark) {
      if (this.materialDark.diffuseTexture) {
        this.materialDark.diffuseTexture.uScale = scaleU;
        this.materialDark.diffuseTexture.vScale = scaleV;
        this.materialDark.diffuseTexture.uOffset = offsetU;
        this.materialDark.diffuseTexture.vOffset = offsetV;
      }
      if (this.materialDark.bumpTexture) {
        this.materialDark.bumpTexture.uScale = scaleU;
        this.materialDark.bumpTexture.vScale = scaleV;
        this.materialDark.bumpTexture.uOffset = offsetU;
        this.materialDark.bumpTexture.vOffset = offsetV;
      }
    }

    // Update materialLight textures (if different from materialDark)
    if (this.materialLight && this.materialLight !== this.materialDark) {
      if (this.materialLight.diffuseTexture) {
        this.materialLight.diffuseTexture.uScale = scaleU;
        this.materialLight.diffuseTexture.vScale = scaleV;
        this.materialLight.diffuseTexture.uOffset = offsetU;
        this.materialLight.diffuseTexture.vOffset = offsetV;
      }
      if (this.materialLight.bumpTexture) {
        this.materialLight.bumpTexture.uScale = scaleU;
        this.materialLight.bumpTexture.vScale = scaleV;
        this.materialLight.bumpTexture.uOffset = offsetU;
        this.materialLight.bumpTexture.vOffset = offsetV;
      }
    }
  }

  dispose() {
    // Unsubscribe from theme changes
    this.unsubscribeTheme?.();

    this.meshes.forEach((mesh) => mesh.dispose());
    this.meshes.clear();

    // Dispose template meshes
    this.templateMeshes.forEach((mesh) => mesh.dispose());
    this.templateMeshes.clear();

    // Dispose materials
    this.materialLight?.dispose();
    this.materialDark?.dispose();

    // Dispose debug meshes
    this.debugMeshes.forEach((mesh) => mesh.dispose());
    this.debugMeshes.clear();
  }
}
