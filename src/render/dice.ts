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
  Material,
  StandardMaterial,
  ShaderMaterial,
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
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import { DieState, DieKind } from "../engine/types.js";
import { themeManager } from "../services/themeManager.js";
import { logger } from "../utils/logger.js";
import { createColorMaterial } from "./colorMaterial.js";

const log = logger.create('DiceRenderer');

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

// Animation constants
const ANIMATION_DURATION_FRAMES = 80;
const ANIMATION_SPEED = 0.45;
const ROLL_COMPLETE_DELAY_MS = 1000;
const SCORE_ANIMATION_DELAY_MS = 400;

// Physics constants
const DROP_START_HEIGHT = 15;
const DROP_END_HEIGHT = 0.6;
const COLLIDER_SCALE_FACTOR = 0.9;
const RANDOM_POSITION_SPREAD = 1.5;

// Rotation detection constants
const RAYCAST_UP_DOT_THRESHOLD = 0.35; // ~69 degrees tolerance for d10/d12
const D8_FACE_TILT_RADIANS = 0.615; // ~35 degrees for proper face-flat orientation
const MAX_ROTATION_ATTEMPTS_INITIAL = 2000;
const MAX_ROTATION_ATTEMPTS_RETRY = 3000;
const DEFAULT_MAX_ROTATION_ATTEMPTS = 500;

// Material constants
const DEFAULT_BUMP_LEVEL = 0.5;
const DEFAULT_SPECULAR_POWER = 64;
const SPECULAR_COLOR_LIGHT = new Color3(0.8, 0.8, 0.8);
const SPECULAR_COLOR_DARK = new Color3(0.5, 0.5, 0.5);
const WHITE_COLOR = new Color3(1, 1, 1);
const BLACK_COLOR = new Color3(0, 0, 0);
const SELECTION_GLOW_COLOR = new Color3(1, 0.8, 0);
const SELECTION_EMISSIVE_COLOR = new Color3(1, 1, 0.3);

// Color conversion constant
const RGB_MAX_VALUE = 255;

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

  // Material cache for fallback themes (themeName -> { light, dark })
  private materialCache = new Map<string, { light: StandardMaterial | ShaderMaterial; dark: StandardMaterial | ShaderMaterial }>();

  // Texture cache for shader materials (material instance -> { diffuse, bump })
  private textureCache = new WeakMap<ShaderMaterial, { diffuse?: Texture; bump?: Texture }>();

  // Geometry data with collider face maps
  private geometryData: any = null;
  private geometryLoaded = false;

  // Debug mode tracking
  private debugMeshes = new Map<string, Mesh>();
  private isDebugMode = false;
  private debugUseLightMaterial = false;

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
      log.info("Dice-box rendering system initialized");
    } catch (error) {
      log.error("Failed to initialize dice-box renderer:", error);
      this.geometryLoaded = false;
    }
  }

  /**
   * Build rotation cache for d10 and d12 by finding rotations that work
   */
  private async buildRotationCache(): Promise<void> {
    log.debug("Building rotation cache for d10 and d12...");

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
        log.warn(`No template for ${kind}, skipping cache`);
        continue;
      }

      log.debug(`Using template: ${template.name}`);

      // Create a temporary mesh for testing
      const testMesh = template.clone(`test_${kind}`, null, false, false) as Mesh;
      testMesh.setEnabled(true);
      testMesh.position = new Vector3(0, 10, 0);

      // For each face value, find a rotation that works
      for (let value = 1; value <= maxValue; value++) {
        const displayValue = kind === "d10" ? (value % 10) : value;
        log.debug(`Searching for ${kind} value ${displayValue}...`);
        const rotation = this.findRotationForValue(testMesh, kind, displayValue, MAX_ROTATION_ATTEMPTS_INITIAL);

        if (rotation) {
          cache.set(displayValue, rotation);
          log.debug(`${kind} value ${displayValue}: FOUND`);
        } else {
          // Try again with more lenient detection
          log.warn(`${kind} value ${displayValue}: NOT FOUND after ${MAX_ROTATION_ATTEMPTS_INITIAL} attempts, retrying...`);
          const rotation2 = this.findRotationForValue(testMesh, kind, displayValue, MAX_ROTATION_ATTEMPTS_RETRY);
          if (rotation2) {
            cache.set(displayValue, rotation2);
            log.debug(`${kind} value ${displayValue}: FOUND (lenient)`);
          } else {
            log.error(`${kind} value ${displayValue}: FAILED - using fallback`);
            // Use a random rotation as fallback
            cache.set(displayValue, new Vector3(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2));
          }
        }
      }

      testMesh.dispose();
      this.rotationCache.set(kind, cache);
    }

    log.debug("Rotation cache built successfully");
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
    log.debug(`Loading geometry from: ${geometryPath}`);

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
      "", // Load all meshes
      "", // No base URL
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
      if ((mesh as Mesh).freezeNormals) {
        (mesh as Mesh).freezeNormals();
      }

      // Shrink colliders slightly (dice-box approach)
      if (mesh.name.includes("collider")) {
        mesh.scaling.scaleInPlace(COLLIDER_SCALE_FACTOR);
      }

      this.templateMeshes.set(mesh.name, mesh as Mesh);
      log.debug(`Loaded template: ${mesh.name}`);
    });

    // Store collider face map for value detection
    this.scene.metadata = this.scene.metadata || {};
    this.scene.metadata.colliderFaceMap = this.geometryData.colliderFaceMap;
  }

  /**
   * Create materials with light/dark texture variants
   * Following dice-box approach: two materials for readability
   * Also loads fallback theme materials if configured
   */
  private async createMaterials(): Promise<void> {
    const themeConfig = themeManager.getCurrentThemeConfig();
    if (!themeConfig) {
      log.error("No theme config available");
      return;
    }

    log.info(`Loading materials for theme: ${themeConfig.name}`);

    // Clear material cache
    this.materialCache.clear();

    // Load primary theme materials
    await this.loadMaterialsForTheme(themeConfig);

    // Store primary materials in cache
    if (this.materialLight && this.materialDark) {
      this.materialCache.set(themeConfig.systemName, {
        light: this.materialLight,
        dark: this.materialDark
      });
    }

    // Load fallback theme materials if configured
    if (themeConfig.fallbackTheme) {
      const fallbackConfig = themeManager.getThemeConfig(themeConfig.fallbackTheme);
      if (fallbackConfig) {
        log.info(`Loading fallback theme materials: ${fallbackConfig.name}`);
        await this.loadMaterialsForTheme(fallbackConfig, true);
      }
    }
  }

  /**
   * Load materials for a specific theme configuration
   */
  private async loadMaterialsForTheme(themeConfig: any, isFallback: boolean = false): Promise<void> {
    const themePath = `/assets/themes/${themeConfig.systemName}`;

    if (themeConfig.material.type === 'standard') {
      await this.createStandardMaterialForTheme(themeConfig, themePath, isFallback);
    } else {
      await this.createColorMaterialForTheme(themeConfig, themePath, isFallback);
    }
  }

  /**
   * Create standard material (diceOfRolling style)
   * Uses texture atlas with all colors baked in
   */
  private async createStandardMaterialForTheme(themeConfig: any, basePath: string, isFallback: boolean): Promise<void> {
    log.info("Loading standard material from:", basePath);

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

    log.info("Standard material textures loaded");

    const materialName = isFallback ? `dice-material-${themeConfig.systemName}` : "dice-material";
    const material = new StandardMaterial(materialName, this.scene);
    material.diffuseTexture = diffuseTexture;
    material.bumpTexture = normalMap;
    material.bumpTexture.level = themeConfig.material.bumpLevel || DEFAULT_BUMP_LEVEL;

    if (specularMap) {
      material.specularTexture = specularMap;
    }
    material.specularColor = SPECULAR_COLOR_DARK;
    material.specularPower = themeConfig.material.specularPower || DEFAULT_SPECULAR_POWER;

    if (isFallback) {
      // Store in cache for fallback dice
      this.materialCache.set(themeConfig.systemName, {
        light: material,
        dark: material
      });
    } else {
      // Set as primary materials
      this.materialDark = material;
      this.materialLight = material;
    }
  }

  /**
   * Create color material (default/smooth-pip style)
   * Uses transparent texture overlay on colored dice body
   * Following dice-box approach: mix diffuse color with texture alpha
   */
  private async createColorMaterialForTheme(themeConfig: any, basePath: string, isFallback: boolean): Promise<void> {
    log.info("Loading color material from:", basePath);

    const diffuseConfig = themeConfig.material.diffuseTexture as { light: string; dark: string };
    // Load textures - we'll use them for both diffuse and opacity
    const diffuseLight = new Texture(`${basePath}/${diffuseConfig.light}`, this.scene);
    const diffuseDark = new Texture(`${basePath}/${diffuseConfig.dark}`, this.scene);
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

    log.info("Color material textures loaded");

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

    // Use custom shader material for proper color blending
    // Key insight: Use DARK base color with LIGHT pip textures for contrast
    // Dark die body (dark gray/black) + light pips (white) = good readability

    const materialNamePrefix = isFallback ? `dice-color-material-${themeConfig.systemName}` : "dice-color-material";

    // Create dark material: dark base color + light pips
    const darkBaseColor = new Color3(0.2, 0.2, 0.2); // Dark gray die body
    const darkMaterialName = `${materialNamePrefix}-dark`;
    const materialDark = createColorMaterial(
      darkMaterialName,
      this.scene,
      {
        baseColor: darkBaseColor,
        diffuseTexture: diffuseLight, // Light pips on dark body
        bumpTexture: normalMap,
        bumpLevel: themeConfig.material.bumpLevel || DEFAULT_BUMP_LEVEL,
        specularTexture: specularMap || undefined,
        specularPower: themeConfig.material.specularPower || DEFAULT_SPECULAR_POWER,
        specularColor: SPECULAR_COLOR_LIGHT,
      }
    ) as any; // Cast to any to work with StandardMaterial type

    // Store texture references for dark material (for updateTextureMapping)
    this.textureCache.set(materialDark, {
      diffuse: diffuseLight,
      bump: normalMap
    });

    // Create light material: light base color + dark pips
    const lightBaseColor = new Color3(0.9, 0.9, 0.9); // Light gray die body
    const lightMaterialName = `${materialNamePrefix}-light`;
    const materialLight = createColorMaterial(
      lightMaterialName,
      this.scene,
      {
        baseColor: lightBaseColor,
        diffuseTexture: diffuseDark, // Dark pips on light body
        bumpTexture: normalMap,
        bumpLevel: themeConfig.material.bumpLevel || DEFAULT_BUMP_LEVEL,
        specularTexture: specularMap || undefined,
        specularPower: themeConfig.material.specularPower || DEFAULT_SPECULAR_POWER,
        specularColor: SPECULAR_COLOR_DARK,
      }
    ) as any;

    // Store texture references for light material
    this.textureCache.set(materialLight, {
      diffuse: diffuseDark,
      bump: normalMap
    });

    if (isFallback) {
      // Store in cache for fallback dice
      this.materialCache.set(themeConfig.systemName, {
        light: materialLight,
        dark: materialDark
      });
    } else {
      // Set as primary materials
      this.materialDark = materialDark;
      this.materialLight = materialLight;
    }
  }

  /**
   * Create a die instance from template mesh
   * Uses dice-box instancing approach for performance
   */
  createDie(die: DieState): Mesh {
    // Wait for geometry to load if not ready
    if (!this.geometryLoaded || !this.materialLight || !this.materialDark) {
      log.warn("Geometry not loaded yet, using placeholder");
      return this.createPlaceholderDie(die);
    }

    // Get template mesh
    const templateName = die.def.kind;
    const template = this.templateMeshes.get(templateName);

    if (!template) {
      log.warn(`No template for ${die.def.kind}, using placeholder`);
      return this.createPlaceholderDie(die);
    }

    // IMPORTANT: Clone mesh instead of creating instance
    // Instances cannot have individual materials - they share the template's material
    // We need separate materials per die for different colors
    const instance = template.clone(die.id, null, false, false) as Mesh;

    if (!instance) {
      log.error(`Failed to clone mesh for ${die.def.kind}`);
      return this.createPlaceholderDie(die);
    }

    instance.setEnabled(true);
    instance.isPickable = true; // Enable clicking for selection
    log.debug(`Cloned mesh for ${die.def.kind}:`, die.id);

    // For now, just use white material directly - no custom colors per die
    // Store white color for UI purposes
    const hexColor = "#ffffff";
    this.dieColors.set(die.id, hexColor);

    // Check if this die type should use fallback theme material
    const currentTheme = themeManager.getCurrentThemeConfig();
    let materialToUse: Material | null;

    // Determine which material variant to use (light or dark)
    const useLight = this.isDebugMode ? this.debugUseLightMaterial : false;

    if (currentTheme?.useFallbackFor?.includes(die.def.kind) && currentTheme.fallbackTheme) {
      const fallbackMaterials = this.materialCache.get(currentTheme.fallbackTheme);
      if (fallbackMaterials) {
        materialToUse = useLight ? fallbackMaterials.light : fallbackMaterials.dark;
        log.debug(`Using fallback theme "${currentTheme.fallbackTheme}" ${useLight ? 'light' : 'dark'} material for ${die.def.kind}`);
      } else {
        materialToUse = useLight ? this.materialLight : this.materialDark;
      }
    } else {
      materialToUse = useLight ? this.materialLight : this.materialDark;
    }

    log.debug(`Creating ${die.def.kind} with ${useLight ? 'light' : 'dark'} material`);

    // Use the appropriate material (primary or fallback, light or dark)
    instance.material = materialToUse;

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

    log.debug(`Created ${die.def.kind} successfully`);

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
      // RAYCAST_UP_DOT_THRESHOLD = ~69 degrees tolerance (sweet spot between flatness and finding all values)
      if (upDot > RAYCAST_UP_DOT_THRESHOLD) {
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
  private findRotationForValue(mesh: Mesh, dieKind: string, targetValue: number, maxAttempts: number = DEFAULT_MAX_ROTATION_ATTEMPTS): Vector3 | null {
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
          log.debug(`Found rotation for ${dieKind} value ${targetValue} after ${attempt + 1} attempts`);
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
      const faceTilt = D8_FACE_TILT_RADIANS;

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
      log.warn(`No cached rotation for d10 value ${displayValue}`);
      return new Vector3(0, 0, 0);
    }

    // D12 rotations - use cached raycast-detected rotations
    if (dieKind === "d12") {
      const cache = this.rotationCache.get("d12");

      if (cache && cache.has(value)) {
        return cache.get(value)!;
      }

      // Fallback if cache miss
      log.warn(`No cached rotation for d12 value ${value}`);
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
        mesh.material.emissiveColor = SELECTION_EMISSIVE_COLOR;
      } else {
        mesh.material.emissiveColor = BLACK_COLOR;
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
      this.highlightLayer.addMesh(mesh, SELECTION_GLOW_COLOR);
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

      const randomX = offsetX + (Math.random() - 0.5) * RANDOM_POSITION_SPREAD;
      const randomZ = offsetZ + (Math.random() - 0.5) * RANDOM_POSITION_SPREAD;

      const startY = DROP_START_HEIGHT;
      const endY = DROP_END_HEIGHT;

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
      this.scene.beginAnimation(mesh, 0, animDuration, false, ANIMATION_SPEED, () => {
        this.updateDie(die);
      });
    });

    setTimeout(onComplete, ROLL_COMPLETE_DELAY_MS);
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
    const baseY = DROP_END_HEIGHT;

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

    setTimeout(onComplete, SCORE_ANIMATION_DELAY_MS);
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
    const r = Math.floor(color.r * RGB_MAX_VALUE)
      .toString(16)
      .padStart(2, "0");
    const g = Math.floor(color.g * RGB_MAX_VALUE)
      .toString(16)
      .padStart(2, "0");
    const b = Math.floor(color.b * RGB_MAX_VALUE)
      .toString(16)
      .padStart(2, "0");
    return `#${r}${g}${b}`;
  }

  /**
   * Create debug dice showing all face values for a specific die type
   * Used by the debug view for rotation testing
   */
  createDebugDice(dieKind: DieKind, faceCount: number, useLightMaterial: boolean = false): void {
    if (!this.geometryLoaded) {
      log.warn("Geometry not loaded yet for debug dice");
      return;
    }

    this.isDebugMode = true;
    this.debugUseLightMaterial = useLightMaterial;

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
    log.info("Theme changed, reloading materials...");

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

    log.info("Theme updated for all dice");
  }

  /**
   * Update texture mapping for live debugging
   * Updates scale and offset for all textures on current materials
   * @param dieKind Optional - if specified, only updates materials for that specific die type
   */
  updateTextureMapping(scaleU: number, scaleV: number, offsetU: number, offsetV: number, dieKind?: DieKind): void {
    log.debug(`Updating texture mapping: scale(${scaleU}, ${scaleV}) offset(${offsetU}, ${offsetV}) for ${dieKind || 'all dice'}`);

    // Helper to update textures for both StandardMaterial and ShaderMaterial
    const updateMaterialTextures = (material: Material | null) => {
      if (!material) return;

      // For StandardMaterial, access properties directly
      if (material instanceof StandardMaterial) {
        if (material.diffuseTexture) {
          const diffuseTex = material.diffuseTexture as Texture;
          diffuseTex.uScale = scaleU;
          diffuseTex.vScale = scaleV;
          diffuseTex.uOffset = offsetU;
          diffuseTex.vOffset = offsetV;
        }
        if (material.bumpTexture) {
          const bumpTex = material.bumpTexture as Texture;
          bumpTex.uScale = scaleU;
          bumpTex.vScale = scaleV;
          bumpTex.uOffset = offsetU;
          bumpTex.vOffset = offsetV;
        }
      }
      // For ShaderMaterial (color materials), access via texture cache
      else if (material instanceof ShaderMaterial) {
        const textures = this.textureCache.get(material);
        if (textures) {
          log.debug(`Found textures in cache for ShaderMaterial: ${material.name}`);
          if (textures.diffuse) {
            log.debug(`Updating diffuse texture: ${textures.diffuse.name}`);
            textures.diffuse.uScale = scaleU;
            textures.diffuse.vScale = scaleV;
            textures.diffuse.uOffset = offsetU;
            textures.diffuse.vOffset = offsetV;
          }
          if (textures.bump) {
            log.debug(`Updating bump texture: ${textures.bump.name}`);
            textures.bump.uScale = scaleU;
            textures.bump.vScale = scaleV;
            textures.bump.uOffset = offsetU;
            textures.bump.vOffset = offsetV;
          }
        } else {
          log.warn(`No textures found in cache for ShaderMaterial: ${material.name}`);
        }
      }
    };

    // If a specific die kind is provided, only update materials for that die
    if (dieKind) {
      const currentTheme = themeManager.getCurrentThemeConfig();

      // Check if this die uses fallback
      if (currentTheme?.useFallbackFor?.includes(dieKind) && currentTheme.fallbackTheme) {
        const fallbackMaterials = this.materialCache.get(currentTheme.fallbackTheme);
        if (fallbackMaterials) {
          log.debug(`Updating fallback materials for ${dieKind}`);
          updateMaterialTextures(fallbackMaterials.dark);
          if (fallbackMaterials.light !== fallbackMaterials.dark) {
            updateMaterialTextures(fallbackMaterials.light);
          }
        }
      } else {
        // Use primary materials
        log.debug(`Updating primary materials for ${dieKind}`);
        updateMaterialTextures(this.materialDark);
        if (this.materialLight !== this.materialDark) {
          updateMaterialTextures(this.materialLight);
        }
      }
    } else {
      // Update all materials (legacy behavior)
      updateMaterialTextures(this.materialDark);
      if (this.materialLight !== this.materialDark) {
        updateMaterialTextures(this.materialLight);
      }

      // Update all cached materials (for fallback themes)
      this.materialCache.forEach((materials) => {
        updateMaterialTextures(materials.dark);
        if (materials.light !== materials.dark) {
          updateMaterialTextures(materials.light);
        }
      });
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
