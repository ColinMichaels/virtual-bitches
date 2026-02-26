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
  Quaternion,
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
import { particleService } from "../services/particleService.js";
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

// Collision radii for dice (scaled size * 10 * buffer factor)
// Used for spacing calculations to prevent overlaps
const DIE_COLLISION_RADII: Record<DieKind, number> = {
  d4: 1.2 * 10 * 0.6,  // 7.2 units
  d6: 1.0 * 10 * 0.6,  // 6.0 units
  d8: 1.1 * 10 * 0.6,  // 6.6 units
  d10: 1.1 * 10 * 0.6, // 6.6 units
  d12: 1.3 * 10 * 0.6, // 7.8 units
  d20: 1.4 * 10 * 0.6, // 8.4 units
};

// Individual die colors - brightened palette for better visibility against dark table
const DIE_COLORS: Color3[] = [
  Color3.FromHexString("#3a3a3a"), // Dark gray (was #2a2a2a)
  Color3.FromHexString("#4d7a60"), // Brighter green (was #3d5a4a)
  Color3.FromHexString("#5a76a0"), // Brighter blue (was #4a5c7a)
  Color3.FromHexString("#e0c080"), // Brighter gold (was #b8a062)
  Color3.FromHexString("#b88fa4"), // Brighter pink (was #8f6f7e)
  Color3.FromHexString("#a04f4f"), // Brighter red (was #7a3d3d)
  Color3.FromHexString("#b06060"), // Brighter red #2 (was #8a4a4a)
  Color3.FromHexString("#e8d8b8"), // Brighter cream (was #c4b399)
  Color3.FromHexString("#e8e8e8"), // Brighter light gray (was #c8c8c8)
  Color3.FromHexString("#3a3a3a"), // Dark gray #2 (was #2a2a2a)
  Color3.FromHexString("#8a6a4a"), // Brighter brown (was #6b5139)
  Color3.FromHexString("#3a3a3a"), // Dark gray #3 (was #2a2a2a)
  Color3.FromHexString("#748490"), // Brighter blue-gray (was #5a6470)
  Color3.FromHexString("#a04f4f"), // Brighter red (was #7a3d3d)
  Color3.FromHexString("#8a82b0"), // Brighter purple (was #6b5688)
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
const RANDOM_POSITION_SPREAD = 2.0; // Base randomization spread (modulated per die size)

// Rotation detection constants
const RAYCAST_UP_DOT_THRESHOLD = 0.35; // ~69 degrees tolerance for finding faces during cache building
const STABLE_ROTATION_THRESHOLD = 0.95; // ~18 degrees - require nearly horizontal for final cached rotations
const D8_FACE_TILT_RADIANS = 0.615; // ~35 degrees for proper face-flat orientation
const MAX_ROTATION_ATTEMPTS_INITIAL = 2000;
const MAX_ROTATION_ATTEMPTS_RETRY = 3000;
const DEFAULT_MAX_ROTATION_ATTEMPTS = 500;
const ROTATION_CANDIDATES_PER_VALUE = 5; // Try to find multiple stable rotations per value

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
const SPECTATOR_PREVIEW_TTL_MS = 65000;

const SIDES_TO_DIE_KIND: Record<number, DieKind> = {
  4: "d4",
  6: "d6",
  8: "d8",
  10: "d10",
  12: "d12",
  20: "d20",
};

interface SpectatorPreviewState {
  rollingDice: DieState[];
  rollingSourceToTempId: Map<string, string>;
  rollingTempIds: string[];
  scoredTempIds: string[];
  scoreAreaPosition: Vector3;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
}

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
  private loadedMeshFile: string | null = null;

  // Debug mode tracking
  private debugMeshes = new Map<string, Mesh>();
  private isDebugMode = false;
  private debugUseLightMaterial = false;
  private spectatorPreviews = new Map<string, SpectatorPreviewState>();

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
   * Build rotation cache for d8, d10, d12, and d20 by finding stable rotations via raycasting
   */
  private async buildRotationCache(): Promise<void> {
    log.debug("Building rotation cache for d8, d10, d12, and d20...");

    const diceToCache: Array<{ kind: DieKind; maxValue: number }> = [
      { kind: "d8", maxValue: 8 },
      { kind: "d10", maxValue: 10 },
      { kind: "d12", maxValue: 12 },
      { kind: "d20", maxValue: 20 },
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
        const rotation = this.findRotationForValue(testMesh, kind, displayValue, MAX_ROTATION_ATTEMPTS_INITIAL, true);

        if (rotation) {
          cache.set(displayValue, rotation);
          log.debug(`${kind} value ${displayValue}: FOUND`);
        } else {
          // Try again with more attempts and lenient stability requirement
          log.warn(`${kind} value ${displayValue}: NOT FOUND with stable threshold after ${MAX_ROTATION_ATTEMPTS_INITIAL} attempts, retrying with lenient...`);
          const rotation2 = this.findRotationForValue(testMesh, kind, displayValue, MAX_ROTATION_ATTEMPTS_RETRY, false);
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
    this.loadedMeshFile = themeConfig.meshFile;

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

      // Apply per-die settings from theme config (overrides geometry file)
      const dieKind = mesh.name.replace("_collider", "") as DieKind;
      const perDieSettings = themeConfig.perDieSettings?.[dieKind];

      if (perDieSettings && !mesh.name.includes("collider")) {
        // Apply position offset (overrides geometry file)
        if (perDieSettings.positionOffset) {
          mesh.position.set(
            perDieSettings.positionOffset[0],
            perDieSettings.positionOffset[1],
            perDieSettings.positionOffset[2]
          );
          log.debug(`Applied position offset to ${mesh.name}:`, perDieSettings.positionOffset);
        }

        // Apply rotation (overrides geometry file)
        if (perDieSettings.rotationQuaternion) {
          mesh.rotationQuaternion = new Quaternion(
            perDieSettings.rotationQuaternion[0],
            perDieSettings.rotationQuaternion[1],
            perDieSettings.rotationQuaternion[2],
            perDieSettings.rotationQuaternion[3]
          );
          log.debug(`Applied rotation to ${mesh.name}:`, perDieSettings.rotationQuaternion);
        }

        // Apply scaling (overrides geometry file)
        if (perDieSettings.scaling) {
          mesh.scaling.set(
            perDieSettings.scaling[0],
            perDieSettings.scaling[1],
            perDieSettings.scaling[2]
          );
          log.debug(`Applied scaling to ${mesh.name}:`, perDieSettings.scaling);
        }
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
    const baseUrl = import.meta.env.BASE_URL || './';
    const themePath = `${baseUrl}assets/themes/${themeConfig.systemName}`;

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

    // Add ambient and emissive for better visibility against dark table
    material.ambientColor = new Color3(0.3, 0.3, 0.3); // Boost ambient response
    material.emissiveColor = new Color3(0.08, 0.08, 0.08); // Subtle glow

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
        ambientColor: new Color3(0.3, 0.3, 0.3),
        emissiveColor: new Color3(0.08, 0.08, 0.08),
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
        ambientColor: new Color3(0.3, 0.3, 0.3),
        emissiveColor: new Color3(0.08, 0.08, 0.08),
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

    // Reset position to origin (template has position offset from geometry file)
    // The actual die position will be set by the game engine
    instance.position = Vector3.Zero();
    instance.rotation = Vector3.Zero();

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
    let themeConfigForOverrides: any = currentTheme; // Track which theme config to use for overrides

    // Determine which material variant to use (light or dark)
    const useLight = this.isDebugMode ? this.debugUseLightMaterial : false;

    const usingFallback = currentTheme?.useFallbackFor?.includes(die.def.kind) && currentTheme.fallbackTheme;

    if (usingFallback && currentTheme?.fallbackTheme) {
      const fallbackMaterials = this.materialCache.get(currentTheme.fallbackTheme);
      if (fallbackMaterials) {
        materialToUse = useLight ? fallbackMaterials.light : fallbackMaterials.dark;
        // Use fallback theme config for overrides, not the current theme
        themeConfigForOverrides = themeManager.getThemeConfig(currentTheme.fallbackTheme);
        log.debug(`Using fallback theme "${currentTheme.fallbackTheme}" ${useLight ? 'light' : 'dark'} material for ${die.def.kind}`);
      } else {
        materialToUse = useLight ? this.materialLight : this.materialDark;
      }
    } else {
      materialToUse = useLight ? this.materialLight : this.materialDark;
    }

    log.debug(`Creating ${die.def.kind} with ${useLight ? 'light' : 'dark'} material`);

    // Check if this die needs per-die texture overrides from the appropriate theme config
    const perDieOverrides = themeConfigForOverrides?.material?.perDieOverrides?.[die.def.kind];

    if (perDieOverrides && materialToUse) {
      // Clone the material for this specific die so we can apply custom texture settings
      const customMaterial = materialToUse.clone(`${die.id}-material`);

      // For ShaderMaterial, copy texture cache reference to the cloned material
      if (!(customMaterial instanceof StandardMaterial) && materialToUse instanceof ShaderMaterial && customMaterial instanceof ShaderMaterial) {
        const originalTextures = this.textureCache.get(materialToUse);
        if (originalTextures) {
          this.textureCache.set(customMaterial, originalTextures);
        }
      }

      // Apply per-die texture overrides
      if (perDieOverrides.textureScale || perDieOverrides.textureOffset) {
        log.debug(`Applying per-die overrides for ${die.def.kind}:`, perDieOverrides);

        // Get textures from the material (works for both StandardMaterial and ShaderMaterial)
        const textures: any[] = [];

        if (customMaterial instanceof StandardMaterial) {
          if (customMaterial.diffuseTexture) textures.push(customMaterial.diffuseTexture);
          if (customMaterial.bumpTexture) textures.push(customMaterial.bumpTexture);
        } else if (customMaterial instanceof ShaderMaterial) {
          // ShaderMaterial - get from texture cache
          const cachedTextures = this.textureCache.get(customMaterial);
          if (cachedTextures) {
            if (cachedTextures.diffuse) textures.push(cachedTextures.diffuse);
            if (cachedTextures.bump) textures.push(cachedTextures.bump);
          }
        }

        // Apply scale/offset to all textures
        textures.forEach(texture => {
          if (perDieOverrides.textureScale) {
            texture.uScale = perDieOverrides.textureScale.u;
            texture.vScale = perDieOverrides.textureScale.v;
          }
          if (perDieOverrides.textureOffset) {
            texture.uOffset = perDieOverrides.textureOffset.u;
            texture.vOffset = perDieOverrides.textureOffset.v;
          }
        });

        log.debug(`Applied overrides to ${textures.length} textures for ${die.def.kind}`);
      }

      instance.material = customMaterial;
    } else {
      // Use the shared material (primary or fallback, light or dark)
      instance.material = materialToUse;
    }

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
   * Returns the face index and stability score from the collider geometry
   * Only accepts faces that are relatively horizontal (not on edge/vertex)
   */
  private detectUpwardFace(mesh: Mesh): { faceId: number; stabilityScore: number } | null {
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
            return { faceId: pickInfo.faceId, stabilityScore: upDot };
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
   * Try multiple random rotations to find the most stable one that shows the desired value
   * Uses raycast detection to verify the face and stability score
   */
  private findRotationForValue(mesh: Mesh, dieKind: string, targetValue: number, maxAttempts: number = DEFAULT_MAX_ROTATION_ATTEMPTS, requireStable: boolean = true): Vector3 | null {
    // Collect multiple candidates and pick the most stable one
    const candidates: Array<{ rotation: Vector3; stabilityScore: number }> = [];
    const originalRotation = mesh.rotation.clone();

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Generate random rotation
      const testRotation = new Vector3(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );

      // Apply rotation to mesh temporarily
      mesh.rotation = testRotation;

      // Force mesh to recompute world matrix
      mesh.computeWorldMatrix(true);

      // Detect which face is up with stability score
      const result = this.detectUpwardFace(mesh);
      if (result !== null) {
        const faceValue = this.getFaceValueFromCollider(dieKind, result.faceId);

        if (faceValue === targetValue) {
          // Check stability requirement
          const meetsStability = !requireStable || result.stabilityScore >= STABLE_ROTATION_THRESHOLD;

          if (meetsStability) {
            candidates.push({
              rotation: testRotation.clone(),
              stabilityScore: result.stabilityScore
            });

            // Stop early if we found enough stable candidates
            if (requireStable && candidates.length >= ROTATION_CANDIDATES_PER_VALUE) {
              break;
            } else if (!requireStable && candidates.length >= 1) {
              // If not requiring stable, take first match
              break;
            }
          }
        }
      }
    }

    // Restore original rotation
    mesh.rotation = originalRotation;

    if (candidates.length === 0) {
      return null; // Couldn't find a suitable rotation
    }

    // Select the most stable rotation (highest upDot score)
    candidates.sort((a, b) => b.stabilityScore - a.stabilityScore);
    const best = candidates[0];

    log.debug(`Found ${candidates.length} rotation(s) for ${dieKind} value ${targetValue}, best stability: ${best.stabilityScore.toFixed(3)} ${requireStable ? '(stable)' : '(lenient)'}`);

    return best.rotation;
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

    // D8 rotations - use cached raycast-detected rotations
    if (dieKind === "d8") {
      const cache = this.rotationCache.get("d8");

      if (cache && cache.has(value)) {
        return cache.get(value)!;
      }

      // Fallback if cache miss
      log.warn(`No cached rotation for d8 value ${value}`);
      return new Vector3(0, 0, 0);
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

    // D20 rotations - use cached raycast-detected rotations
    if (dieKind === "d20") {
      const cache = this.rotationCache.get("d20");

      if (cache && cache.has(value)) {
        return cache.get(value)!;
      }

      // Fallback if cache miss
      log.warn(`No cached rotation for d20 value ${value}`);
      return new Vector3(0, 0, 0);
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

  /**
   * Validate die rotation after animation completes
   * Checks if the correct face is up and if the die is stable (flat)
   */
  private validateDieRotation(die: DieState, mesh: Mesh): void {
    // Only validate dice that use raycast-based rotations
    if (!['d8', 'd10', 'd12', 'd20', 'd100'].includes(die.def.kind)) {
      return;
    }

    const result = this.detectUpwardFace(mesh);

    if (result === null) {
      log.debug(`[Validation] ${die.def.kind} value ${die.value}: No face detected (possible edge landing)`);
      return;
    }

    const detectedValue = this.getFaceValueFromCollider(die.def.kind, result.faceId);
    const expectedValue = die.def.kind === 'd10' ? die.value % 10 : die.value;

    if (detectedValue !== expectedValue) {
      log.debug(`[Validation] ${die.def.kind} value ${die.value}: Face mismatch - expected ${expectedValue}, detected ${detectedValue}, stability: ${result.stabilityScore.toFixed(3)}`);
    } else if (result.stabilityScore < STABLE_ROTATION_THRESHOLD) {
      log.debug(`[Validation] ${die.def.kind} value ${die.value}: Correct face but unstable - stability: ${result.stabilityScore.toFixed(3)} (threshold: ${STABLE_ROTATION_THRESHOLD})`);
    } else {
      log.debug(`[Validation] ${die.def.kind} value ${die.value}: ✓ Correct and stable - stability: ${result.stabilityScore.toFixed(3)}`);
    }
  }

  animateRoll(dice: DieState[], onComplete: () => void, rollAreaPosition?: Vector3) {
    const activeDice = dice.filter((d) => d.inPlay && !d.scored);
    if (activeDice.length === 0) {
      onComplete();
      return;
    }

    // Shuffle dice order for randomized positioning on grid
    // Fisher-Yates shuffle to randomize which dice land where
    const shuffledDice = [...activeDice];
    for (let i = shuffledDice.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledDice[i], shuffledDice[j]] = [shuffledDice[j], shuffledDice[i]];
    }

    // Calculate dynamic spacing based on largest die in this roll
    const maxDieSize = Math.max(...shuffledDice.map(d => DIE_SIZES[d.def.kind]));
    const maxCollisionRadius = Math.max(...shuffledDice.map(d => DIE_COLLISION_RADII[d.def.kind]));

    // Base spacing accounts for largest die + buffer
    // Use collision radius * 2 for diameter, plus 20% spacing buffer
    const baseSpacing = (maxCollisionRadius * 2) / 10; // Divide by 10 to get world units
    const spacing = Math.max(baseSpacing * 1.2, 3.0); // Minimum 3.0 units, 20% buffer

    // Arrange in grid
    const cols = Math.ceil(Math.sqrt(shuffledDice.length));

    // Track placed dice positions for collision detection
    const placedPositions: Array<{ x: number; z: number; radius: number }> = [];

    shuffledDice.forEach((die, i) => {
      let mesh = this.meshes.get(die.id);
      if (!mesh) {
        mesh = this.createDie(die);
      }

      const row = Math.floor(i / cols);
      const col = i % cols;
      const rollAreaX = rollAreaPosition?.x ?? 0;
      const rollAreaZ = rollAreaPosition?.z ?? 0;
      const offsetX = rollAreaX + (col - cols / 2) * spacing;
      const offsetZ = rollAreaZ + (row - Math.floor(shuffledDice.length / cols) / 2) * spacing;

      // Size-based random spread: smaller dice get more spread, larger stay closer to grid
      const dieSize = DIE_SIZES[die.def.kind];
      const dieRadius = DIE_COLLISION_RADII[die.def.kind] / 10; // Convert to world units
      const spreadFactor = 2.0 - (dieSize - 1.0); // d6(1.0)→2.0, d20(1.4)→1.6
      const randomSpread = RANDOM_POSITION_SPREAD * Math.max(spreadFactor, 0.8);

      // Try to find a non-overlapping position (max 10 attempts)
      let finalX = offsetX;
      let finalZ = offsetZ;
      let attempts = 0;
      const maxAttempts = 10;

      while (attempts < maxAttempts) {
        const randomX = offsetX + (Math.random() - 0.5) * randomSpread;
        const randomZ = offsetZ + (Math.random() - 0.5) * randomSpread;

        // Check collision with already placed dice
        let hasCollision = false;
        for (const placed of placedPositions) {
          const dx = randomX - placed.x;
          const dz = randomZ - placed.z;
          const distance = Math.sqrt(dx * dx + dz * dz);
          const minDistance = dieRadius + placed.radius;

          if (distance < minDistance) {
            hasCollision = true;
            break;
          }
        }

        if (!hasCollision) {
          finalX = randomX;
          finalZ = randomZ;
          break;
        }

        attempts++;
      }

      // If all attempts failed, fall back to grid position (no random spread)
      if (attempts === maxAttempts) {
        finalX = offsetX;
        finalZ = offsetZ;
      }

      // Record this position for collision checking
      placedPositions.push({ x: finalX, z: finalZ, radius: dieRadius });

      // Staggered drop timing creates cascading effect (dice don't all drop at once)
      const dropDelay = i * 2; // 2 frames delay per die (cascade effect)
      const animDuration = 31 + Math.random() * 7; // Slightly faster animation

      // Random starting position (clustered center) that moves to final position
      // Creates "scrambling" effect as dice spread out while falling
      const startClusterRadius = 3; // Start in tight cluster
      const startX = rollAreaX + (Math.random() - 0.5) * startClusterRadius;
      const startZ = rollAreaZ + (Math.random() - 0.5) * startClusterRadius;
      const startY = DROP_START_HEIGHT + (Math.random() - 0.5) * 4; // Varied heights
      const endY = DROP_END_HEIGHT;

      // Set initial position (clustered)
      mesh.position = new Vector3(startX, startY, startZ);

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

      // Horizontal X movement animation (scrambling sideways)
      const xAnim = new Animation(
        `${die.id}-x`,
        "position.x",
        60,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      // Add mid-point for more interesting trajectory
      const midX = (startX + finalX) / 2 + (Math.random() - 0.5) * 2;
      xAnim.setKeys([
        { frame: dropDelay, value: startX },
        { frame: dropDelay + animDuration * 0.4, value: midX },
        { frame: dropDelay + animDuration, value: finalX },
      ]);

      // Horizontal Z movement animation (scrambling forward/back)
      const zAnim = new Animation(
        `${die.id}-z`,
        "position.z",
        60,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      const midZ = (startZ + finalZ) / 2 + (Math.random() - 0.5) * 2;
      zAnim.setKeys([
        { frame: dropDelay, value: startZ },
        { frame: dropDelay + animDuration * 0.4, value: midZ },
        { frame: dropDelay + animDuration, value: finalZ },
      ]);

      // Vertical drop animation with bounce
      const yAnim = new Animation(
        `${die.id}-y`,
        "position.y",
        60,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      yAnim.setKeys([
        { frame: dropDelay, value: startY },
        { frame: dropDelay + animDuration * 0.6, value: endY - 0.1 },
        { frame: dropDelay + animDuration * 0.75, value: endY + 0.3 },
        { frame: dropDelay + animDuration * 0.88, value: endY + 0.1 },
        { frame: dropDelay + animDuration, value: endY },
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
        startRotation.x + (Math.random() - 0.5) * Math.PI * 2,
        startRotation.y + (Math.random() - 0.5) * Math.PI * 3,
        startRotation.z + (Math.random() - 0.5) * Math.PI * 2
      );

      rotAnim.setKeys([
        { frame: dropDelay, value: startRotation },
        { frame: dropDelay + animDuration * 0.25, value: midRotation },
        { frame: dropDelay + animDuration, value: finalRotation },
      ]);

      const ease = new CubicEase();
      ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
      xAnim.setEasingFunction(ease);
      zAnim.setEasingFunction(ease);
      yAnim.setEasingFunction(ease);
      rotAnim.setEasingFunction(ease);

      mesh.animations = [xAnim, zAnim, yAnim, rotAnim];
      this.scene.beginAnimation(mesh, 0, dropDelay + animDuration, false, ANIMATION_SPEED, () => {
        this.updateDie(die);
        // Validate die rotation after animation completes
        this.validateDieRotation(die, mesh);

        // Emit small particle burst when die lands
        particleService.emit({
          effectId: "burst-white",
          position: new Vector3(finalX, endY + 0.3, finalZ),
          options: {
            scale: 0.25, // Reduced from 0.4 (normal intensity will be 0.15)
            networkSync: false,
          },
        });
      });
    });

    setTimeout(onComplete, ROLL_COMPLETE_DELAY_MS);
  }

  animateScore(
    dice: DieState[],
    selected: Set<string>,
    onComplete: () => void,
    scoreAreaPosition?: Vector3,
    options?: { gridStartIndex?: number }
  ) {
    const toScore = dice.filter((d) => selected.has(d.id));
    if (toScore.length === 0) {
      onComplete();
      return;
    }

    const alreadyScored = dice.filter((d) => d.scored && !selected.has(d.id)).length;
    const gridStartIndex =
      typeof options?.gridStartIndex === "number" && Number.isFinite(options.gridStartIndex)
        ? Math.max(0, Math.floor(options.gridStartIndex))
        : alreadyScored;

    const gridCols = 3;
    const gridRows = 4;
    const maxGridDice = gridCols * gridRows;
    const spacingX = 1.5;
    const spacingZ = 1.5;

    // Score area center can be seat-specific (multiplayer) or fallback.
    const baseX = scoreAreaPosition?.x ?? 9;
    const baseZ = scoreAreaPosition?.z ?? -3;
    const baseY = DROP_END_HEIGHT;

    toScore.forEach((die, i) => {
      const mesh = this.meshes.get(die.id);
      if (!mesh) return;

      this.highlightLayer.removeMesh(mesh);

      const totalIndex = gridStartIndex + i;
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
      const anim = this.scene.beginAnimation(mesh, 0, 20, false);

      // Emit particle burst when die lands in score area
      anim.onAnimationEndObservable.addOnce(() => {
        particleService.emit({
          effectId: "burst-gold",
          position: new Vector3(targetX, targetY + 0.5, targetZ),
          options: {
            scale: 0.6, // Reduced from 1.0 (normal intensity will be 0.36)
            networkSync: false,
          },
        });
      });
    });

    setTimeout(onComplete, SCORE_ANIMATION_DELAY_MS);
  }

  startSpectatorRollPreview(
    previewKey: string,
    roll: { rollIndex: number; dice: Array<{ dieId: string; sides: number; value?: number }> },
    scoreAreaPosition: Vector3
  ): boolean {
    const key = typeof previewKey === "string" ? previewKey.trim() : "";
    if (!key || !roll || !Array.isArray(roll.dice) || roll.dice.length === 0) {
      return false;
    }

    let preview = this.spectatorPreviews.get(key);
    if (!preview) {
      preview = {
        rollingDice: [],
        rollingSourceToTempId: new Map<string, string>(),
        rollingTempIds: [],
        scoredTempIds: [],
        scoreAreaPosition: scoreAreaPosition.clone(),
        cleanupTimer: null,
      };
      this.spectatorPreviews.set(key, preview);
    } else {
      this.clearSpectatorRollingDice(preview);
      preview.scoreAreaPosition = scoreAreaPosition.clone();
    }

    const sourceToTempId = new Map<string, string>();
    const dice: DieState[] = [];

    const safeRollIndex =
      Number.isFinite(roll.rollIndex) && roll.rollIndex > 0 ? Math.floor(roll.rollIndex) : 1;
    roll.dice.forEach((die, index) => {
      const sourceId = typeof die?.dieId === "string" ? die.dieId.trim() : "";
      const sides = Number.isFinite(die?.sides) ? Math.floor(die.sides) : NaN;
      const kind = SIDES_TO_DIE_KIND[sides];
      if (!sourceId || !kind) {
        return;
      }
      const valueRaw = Number.isFinite(die?.value) ? Math.floor(die.value as number) : 1;
      const value = Math.max(1, Math.min(sides, valueRaw));
      const tempId = `${kind}-spectator-${key}-${safeRollIndex}-${index + 1}-${Date.now()}`;
      sourceToTempId.set(sourceId, tempId);
      dice.push({
        id: tempId,
        def: { kind, sides },
        value,
        inPlay: true,
        scored: false,
      });
    });

    if (dice.length === 0) {
      return false;
    }

    const rollAreaPosition = this.resolveSpectatorRollArea(scoreAreaPosition);
    preview.rollingDice = dice;
    preview.rollingSourceToTempId = sourceToTempId;
    preview.rollingTempIds = dice.map((die) => die.id);
    preview.scoreAreaPosition = scoreAreaPosition.clone();

    this.animateRoll(dice, () => {
      this.scheduleSpectatorRollingCleanup(key);
    }, rollAreaPosition);
    return true;
  }

  completeSpectatorScorePreview(
    previewKey: string,
    selectedSourceDiceIds: string[]
  ): boolean {
    const key = typeof previewKey === "string" ? previewKey.trim() : "";
    const preview = this.spectatorPreviews.get(key);
    if (!key || !preview || !Array.isArray(selectedSourceDiceIds)) {
      return false;
    }

    if (preview.cleanupTimer) {
      clearTimeout(preview.cleanupTimer);
      preview.cleanupTimer = null;
    }

    const selectedTempIds = selectedSourceDiceIds
      .map((sourceId) => preview.rollingSourceToTempId.get(sourceId))
      .filter((dieId): dieId is string => typeof dieId === "string");
    if (selectedTempIds.length === 0) {
      this.clearSpectatorRollingDice(preview);
      if (preview.scoredTempIds.length === 0) {
        this.spectatorPreviews.delete(key);
      }
      return false;
    }

    const selectedSet = new Set(selectedTempIds);
    const diceToScore = preview.rollingDice.filter((die) => selectedSet.has(die.id));
    if (diceToScore.length === 0) {
      this.clearSpectatorRollingDice(preview);
      if (preview.scoredTempIds.length === 0) {
        this.spectatorPreviews.delete(key);
      }
      return false;
    }

    const unselectedTempIds = preview.rollingTempIds.filter((dieId) => !selectedSet.has(dieId));
    this.disposeSpectatorDiceIds(unselectedTempIds);

    const gridStartIndex = preview.scoredTempIds.length;
    preview.scoredTempIds.push(...selectedTempIds);
    preview.rollingDice = [];
    preview.rollingTempIds = [];
    preview.rollingSourceToTempId.clear();

    this.animateScore(
      diceToScore,
      selectedSet,
      () => {},
      preview.scoreAreaPosition,
      { gridStartIndex }
    );
    return true;
  }

  cancelSpectatorPreview(previewKey: string): void {
    const key = typeof previewKey === "string" ? previewKey.trim() : "";
    if (!key) {
      return;
    }

    const preview = this.spectatorPreviews.get(key);
    if (!preview) {
      return;
    }
    if (preview.cleanupTimer) {
      clearTimeout(preview.cleanupTimer);
    }
    this.clearSpectatorRollingDice(preview);
    this.disposeSpectatorDiceIds(preview.scoredTempIds);
    preview.scoredTempIds = [];
    this.spectatorPreviews.delete(key);
  }

  clearSpectatorRollingPreview(previewKey: string): void {
    const key = typeof previewKey === "string" ? previewKey.trim() : "";
    if (!key) {
      return;
    }

    const preview = this.spectatorPreviews.get(key);
    if (!preview) {
      return;
    }

    this.clearSpectatorRollingDice(preview);
    if (preview.scoredTempIds.length === 0) {
      this.spectatorPreviews.delete(key);
    }
  }

  cancelAllSpectatorPreviews(): void {
    const previewKeys = [...this.spectatorPreviews.keys()];
    previewKeys.forEach((previewKey) => {
      this.cancelSpectatorPreview(previewKey);
    });
  }

  private scheduleSpectatorRollingCleanup(previewKey: string, delayMs: number = SPECTATOR_PREVIEW_TTL_MS): void {
    const preview = this.spectatorPreviews.get(previewKey);
    if (!preview) {
      return;
    }
    if (preview.cleanupTimer) {
      clearTimeout(preview.cleanupTimer);
    }

    preview.cleanupTimer = setTimeout(() => {
      const currentPreview = this.spectatorPreviews.get(previewKey);
      if (!currentPreview) {
        return;
      }
      this.clearSpectatorRollingDice(currentPreview);
      if (currentPreview.scoredTempIds.length === 0) {
        this.spectatorPreviews.delete(previewKey);
      }
    }, Math.max(200, Math.floor(delayMs)));
  }

  private clearSpectatorRollingDice(preview: SpectatorPreviewState): void {
    if (preview.cleanupTimer) {
      clearTimeout(preview.cleanupTimer);
      preview.cleanupTimer = null;
    }
    this.disposeSpectatorDiceIds(preview.rollingTempIds);
    preview.rollingDice = [];
    preview.rollingSourceToTempId.clear();
    preview.rollingTempIds = [];
  }

  private disposeSpectatorDiceIds(dieIds: string[]): void {
    dieIds.forEach((dieId) => {
      this.selectedMeshes.delete(dieId);
      this.dieColors.delete(dieId);
      const mesh = this.meshes.get(dieId);
      if (mesh) {
        this.highlightLayer.removeMesh(mesh);
        mesh.dispose();
      }
      this.meshes.delete(dieId);
    });
  }

  private resolveSpectatorRollArea(scoreAreaPosition: Vector3): Vector3 {
    const radial = new Vector3(scoreAreaPosition.x, 0, scoreAreaPosition.z);
    const length = radial.length();
    if (!Number.isFinite(length) || length <= 0.01) {
      return new Vector3(0, 0, 0);
    }

    radial.normalize();
    const rollDistance = Math.max(3, length * 0.62);
    return new Vector3(radial.x * rollDistance, 0, radial.z * rollDistance);
  }

  getMesh(dieId: string): Mesh | undefined {
    return this.meshes.get(dieId);
  }

  getDieColor(dieId: string): string | undefined {
    return this.dieColors.get(dieId);
  }

  clearDice(): void {
    this.cancelAllSpectatorPreviews();
    this.meshes.forEach((mesh) => {
      mesh.dispose();
    });
    this.meshes.clear();
    this.selectedMeshes.clear();
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
    log.info("Theme changed, reloading...");
    this.cancelAllSpectatorPreviews();

    const currentTheme = themeManager.getCurrentThemeConfig();
    const newMeshFile = currentTheme?.meshFile;

    // Check if we need to reload geometry (different mesh file)
    const needsGeometryReload = this.loadedMeshFile &&
                                 newMeshFile &&
                                 this.loadedMeshFile !== newMeshFile;

    if (needsGeometryReload) {
      log.info(`Mesh file changed from ${this.loadedMeshFile} to ${newMeshFile}, reloading geometry...`);

      // Dispose ALL existing dice meshes
      this.meshes.forEach((mesh) => {
        mesh.dispose();
      });
      this.meshes.clear();

      // Dispose template meshes
      this.templateMeshes.forEach((mesh) => {
        mesh.dispose();
      });
      this.templateMeshes.clear();

      // Clear rotation cache (it's geometry-specific)
      this.rotationCache.clear();

      // Reload geometry
      await this.loadGeometry();

      // Rebuild rotation cache
      await this.buildRotationCache();
    }

    // Dispose old per-die materials first
    this.meshes.forEach((mesh) => {
      if (mesh.material) {
        // Only dispose if it's a cloned material (contains die ID in name)
        if (mesh.material.name && (mesh.material.name.includes('d4-') ||
            mesh.material.name.includes('d6-') || mesh.material.name.includes('d8-') ||
            mesh.material.name.includes('d10-') || mesh.material.name.includes('d12-') ||
            mesh.material.name.includes('d20-'))) {
          mesh.material.dispose();
        }
      }
    });

    // Dispose shared materials
    this.materialLight?.dispose();
    this.materialDark?.dispose();

    // Clear material cache for fallback themes
    this.materialCache.forEach((materials) => {
      materials.light?.dispose();
      if (materials.dark !== materials.light) {
        materials.dark?.dispose();
      }
    });
    this.materialCache.clear();

    // Reload materials with new theme
    await this.createMaterials();

    // Update all existing dice with new materials
    // We need to rebuild each die's material considering fallback and per-die overrides
    this.meshes.forEach((mesh, dieId) => {
      // Extract die kind from die ID (format: "d6-0", "d8-1", etc.)
      const dieKindMatch = dieId.match(/^(d\d+)/);
      if (!dieKindMatch) {
        log.warn(`Could not determine die kind from ID: ${dieId}`);
        return;
      }
      const dieKind = dieKindMatch[1] as DieKind;

      // Determine which material to use (with fallback logic)
      let materialToUse: Material | null;
      let themeConfigForOverrides: any = currentTheme;
      const useLight = this.isDebugMode ? this.debugUseLightMaterial : false;
      const usingFallback = currentTheme?.useFallbackFor?.includes(dieKind) && currentTheme.fallbackTheme;

      if (usingFallback && currentTheme?.fallbackTheme) {
        const fallbackMaterials = this.materialCache.get(currentTheme.fallbackTheme);
        if (fallbackMaterials) {
          materialToUse = useLight ? fallbackMaterials.light : fallbackMaterials.dark;
          themeConfigForOverrides = themeManager.getThemeConfig(currentTheme.fallbackTheme);
        } else {
          materialToUse = useLight ? this.materialLight : this.materialDark;
        }
      } else {
        materialToUse = useLight ? this.materialLight : this.materialDark;
      }

      // Ensure mesh scaling is correct (might get corrupted during material changes)
      const size = DIE_SIZES[dieKind];
      const scaleFactor = size * 10;
      mesh.scaling.set(scaleFactor, scaleFactor, scaleFactor);

      // Check for per-die overrides
      const perDieOverrides = themeConfigForOverrides?.material?.perDieOverrides?.[dieKind];

      if (perDieOverrides && materialToUse) {
        // Clone material and apply overrides
        const customMaterial = materialToUse.clone(`${dieId}-material`);

        // For ShaderMaterial, copy texture cache reference to the cloned material
        if (!(customMaterial instanceof StandardMaterial) && materialToUse instanceof ShaderMaterial && customMaterial instanceof ShaderMaterial) {
          const originalTextures = this.textureCache.get(materialToUse);
          if (originalTextures) {
            this.textureCache.set(customMaterial, originalTextures);
          }
        }

        if (perDieOverrides.textureScale || perDieOverrides.textureOffset) {
          const textures: any[] = [];

          if (customMaterial instanceof StandardMaterial) {
            if (customMaterial.diffuseTexture) textures.push(customMaterial.diffuseTexture);
            if (customMaterial.bumpTexture) textures.push(customMaterial.bumpTexture);
          } else if (customMaterial instanceof ShaderMaterial) {
            const cachedTextures = this.textureCache.get(customMaterial);
            if (cachedTextures) {
              if (cachedTextures.diffuse) textures.push(cachedTextures.diffuse);
              if (cachedTextures.bump) textures.push(cachedTextures.bump);
            }
          }

          textures.forEach(texture => {
            if (perDieOverrides.textureScale) {
              texture.uScale = perDieOverrides.textureScale.u;
              texture.vScale = perDieOverrides.textureScale.v;
            }
            if (perDieOverrides.textureOffset) {
              texture.uOffset = perDieOverrides.textureOffset.u;
              texture.vOffset = perDieOverrides.textureOffset.v;
            }
          });
        }

        mesh.material = customMaterial;
      } else {
        // Use shared material
        mesh.material = materialToUse;
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
    this.cancelAllSpectatorPreviews();

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
