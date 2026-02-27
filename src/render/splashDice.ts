/**
 * Splash Dice Renderer
 * Simplified dice renderer for splash screen background
 * Uses same geometry and materials as game dice
 */

import {
  Scene,
  AbstractMesh,
  Mesh,
  StandardMaterial,
  ShaderMaterial,
  Color3,
  Scalar,
  Vector3,
  Texture,
} from "@babylonjs/core";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import { themeManager, type ThemeConfig } from "../services/themeManager.js";
import { logger } from "../utils/logger.js";
import { createColorMaterial } from "./colorMaterial.js";

const log = logger.create('SplashDiceRenderer');

const DIE_SIZES: Record<string, number> = {
  d4: 1.3,
  d6: 1.5,
  d8: 1.4,
  d10: 1.4,
  d12: 1.6,
  d20: 1.5,
};

const DIE_COLORS = [
  "#1a1a1a", // Black
  "#2d8b45", // Green
  "#3366cc", // Blue
  "#cc2233", // Red
  "#ffd700", // Gold
  "#ff69b4", // Pink
  "#9966cc", // Purple
  "#f5deb3", // Cream
];

const SPLASH_DICE_WRAP_DISTANCE = 24;
const SPLASH_DICE_SPEED_MULTIPLIER = 74;
const SPLASH_DICE_NEAR_SCALE_DISTANCE = 6;
const SPLASH_DICE_FAR_SCALE_DISTANCE = 36;
const SPLASH_DICE_NEAR_SCALE_MULTIPLIER = 1.9;
const SPLASH_DICE_FAR_SCALE_MULTIPLIER = 0.07;
const SPLASH_DICE_EDGE_FADE_START = 0.52;
const SPLASH_DICE_EDGE_FADE_RANGE = 0.52;

interface SplashDieMotionState {
  mesh: Mesh;
  velocity: Vector3;
  rotationVelocity: Vector3;
  baseScale: number;
  dieType: string;
}

export class SplashDiceRenderer {
  private templateMeshes = new Map<string, Mesh>();
  private diceMeshes: Mesh[] = [];
  private dieMotionStates: SplashDieMotionState[] = [];
  private motionStateByMeshId = new Map<number, SplashDieMotionState>();
  private dieThemeByMeshId = new Map<number, string>();
  private material: StandardMaterial | ShaderMaterial | null = null;
  private geometryLoaded = false;
  private unsubscribeTheme?: () => void;
  private initPromise: Promise<void>;
  private animationRegistered = false;
  private readonly animateDice = () => {
    this.updateDiceMotion();
  };

  // Material cache for fallback themes (themeName -> material)
  private materialCache = new Map<string, StandardMaterial | ShaderMaterial>();

  constructor(private scene: Scene) {
    // Subscribe to theme changes
    this.unsubscribeTheme = themeManager.onThemeChange(() => {
      this.onThemeChanged();
    });

    this.initPromise = this.initializeAsync();
  }

  private async initializeAsync(): Promise<void> {
    try {
      await this.loadGeometry();
      await this.createMaterial();
      this.geometryLoaded = true;
      log.info("Splash dice renderer initialized");
    } catch (error) {
      log.error("Failed to initialize splash dice renderer:", error);
      this.geometryLoaded = false;
    }
  }

  /**
   * Load dice geometry from dice-box format
   */
  private async loadGeometry(): Promise<void> {
    const themeConfig = themeManager.getCurrentThemeConfig();
    if (!themeConfig) {
      throw new Error("No theme config available for splash");
    }

    const geometryPath = `${themeManager.getCurrentThemePath()}/${themeConfig.meshFile}`;
    log.debug(`Loading splash geometry from: ${geometryPath}`);

    const response = await fetch(geometryPath);
    if (!response.ok) {
      throw new Error(`Failed to load geometry: ${response.statusText}`);
    }

    const geometryData = await response.json();

    // Strip physics properties
    geometryData.physicsEnabled = false;
    if (geometryData.meshes) {
      geometryData.meshes.forEach((mesh: any) => {
        delete mesh.physicsImpostor;
        delete mesh.physicsMass;
        delete mesh.physicsFriction;
        delete mesh.physicsRestitution;
      });
    }

    // Import meshes
    const result = await SceneLoader.ImportMeshAsync(
      "",
      "",
      "data:" + JSON.stringify(geometryData),
      this.scene
    );

    // Process imported meshes - only keep visual meshes, not colliders
    result.meshes.forEach((mesh) => {
      if (mesh.name === "__root__" || mesh.name.includes("collider")) {
        mesh.dispose();
        return;
      }

      // Store as template mesh
      mesh.setEnabled(false);
      mesh.isPickable = false;
      if ((mesh as Mesh).freezeNormals) {
        (mesh as Mesh).freezeNormals();
      }
      this.templateMeshes.set(mesh.name, mesh as Mesh);
    });
  }

  /**
   * Create material using current theme
   * Also loads fallback theme materials if configured
   */
  private async createMaterial(): Promise<void> {
    const themeConfig = themeManager.getCurrentThemeConfig();
    if (!themeConfig) {
      log.error("No theme config available for splash");
      return;
    }

    this.disposeMaterialCache();

    // Load current theme first.
    await this.loadMaterialForTheme(themeConfig);

    // Load fallback theme material if configured
    if (themeConfig.fallbackTheme) {
      const fallbackConfig = themeManager.getThemeConfig(themeConfig.fallbackTheme);
      if (fallbackConfig) {
        log.info(`Loading fallback splash material: ${fallbackConfig.name}`);
        try {
          await this.loadMaterialForTheme(fallbackConfig);
        } catch (error) {
          log.warn(`Failed loading fallback splash material "${fallbackConfig.systemName}"`, error);
        }
      }
    }

    if (!this.material) {
      const fallbackPrimary = this.materialCache.get(themeConfig.systemName);
      if (fallbackPrimary) {
        this.material = fallbackPrimary;
      }
    }
  }

  /**
   * Load material for a specific theme
   */
  private async loadMaterialForTheme(themeConfig: ThemeConfig): Promise<void> {
    const basePath = themeManager.getThemePath(themeConfig.systemName);
    log.info(`Loading splash material from: ${basePath}`);

    // Load textures based on theme type
    if (themeConfig.material.type === 'standard') {
      const diffuseTexture = new Texture(
        `${basePath}/${themeConfig.material.diffuseTexture}`,
        this.scene,
        undefined,
        true // invertY
      );
      const normalMap = new Texture(
        `${basePath}/${themeConfig.material.bumpTexture}`,
        this.scene,
        undefined,
        true
      );

      let specularMap: Texture | null = null;
      if (themeConfig.material.specularTexture) {
        specularMap = new Texture(
          `${basePath}/${themeConfig.material.specularTexture}`,
          this.scene,
          undefined,
          true
        );
      }

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

      // Apply texture scale/offset from theme config
      const textureScale = (themeConfig.material as any).textureScale;
      if (textureScale) {
        diffuseTexture.uScale = textureScale.u || 1;
        diffuseTexture.vScale = textureScale.v || 1;
        normalMap.uScale = textureScale.u || 1;
        normalMap.vScale = textureScale.v || 1;
      }

      const textureOffset = (themeConfig.material as any).textureOffset;
      if (textureOffset) {
        diffuseTexture.uOffset = textureOffset.u || 0;
        diffuseTexture.vOffset = textureOffset.v || 0;
        normalMap.uOffset = textureOffset.u || 0;
        normalMap.vOffset = textureOffset.v || 0;
      }

      const materialName = `splash-dice-material-${themeConfig.systemName}`;
      const material = new StandardMaterial(materialName, this.scene);
      material.diffuseTexture = diffuseTexture;
      material.bumpTexture = normalMap;
      material.bumpTexture.level = themeConfig.material.bumpLevel || 0.5;
      if (specularMap) {
        material.specularTexture = specularMap;
      }
      material.specularColor = new Color3(0.5, 0.5, 0.5);
      material.specularPower = themeConfig.material.specularPower || 64;
      this.materialCache.set(themeConfig.systemName, material);
      if (themeConfig.systemName === themeManager.getCurrentTheme()) {
        this.material = material;
      }
    } else {
      // Color material type - use custom shader material
      const diffuseConfig = themeConfig.material.diffuseTexture as { light: string; dark: string };
      const diffuseLight = new Texture(
        `${basePath}/${diffuseConfig.light}`,
        this.scene,
        undefined,
        true // invertY
      );
      const normalMap = new Texture(
        `${basePath}/${themeConfig.material.bumpTexture}`,
        this.scene,
        undefined,
        true
      );

      let specularMap: Texture | null = null;
      if (themeConfig.material.specularTexture) {
        specularMap = new Texture(
          `${basePath}/${themeConfig.material.specularTexture}`,
          this.scene,
          undefined,
          true
        );
      }

      await new Promise<void>((resolve) => {
        let loadedCount = 0;
        const totalTextures = specularMap ? 3 : 2;
        const checkLoaded = () => {
          loadedCount++;
          if (loadedCount === totalTextures) resolve();
        };
        diffuseLight.onLoadObservable.addOnce(checkLoaded);
        normalMap.onLoadObservable.addOnce(checkLoaded);
        if (specularMap) {
          specularMap.onLoadObservable.addOnce(checkLoaded);
        }
      });

      // Apply texture scale/offset from theme config
      const textureScale = (themeConfig.material as any).textureScale;
      if (textureScale) {
        diffuseLight.uScale = textureScale.u || 1;
        diffuseLight.vScale = textureScale.v || 1;
        normalMap.uScale = textureScale.u || 1;
        normalMap.vScale = textureScale.v || 1;
      }

      const textureOffset = (themeConfig.material as any).textureOffset;
      if (textureOffset) {
        diffuseLight.uOffset = textureOffset.u || 0;
        diffuseLight.vOffset = textureOffset.v || 0;
        normalMap.uOffset = textureOffset.u || 0;
        normalMap.vOffset = textureOffset.v || 0;
      }

      // Use custom shader material for proper color blending
      // Dark base color + light pip textures for good contrast
      const darkBaseColor = new Color3(0.2, 0.2, 0.2);
      const materialName = `splash-dice-color-material-${themeConfig.systemName}`;
      const material = createColorMaterial(
        materialName,
        this.scene,
        {
          baseColor: darkBaseColor,
          diffuseTexture: diffuseLight,
          bumpTexture: normalMap,
          bumpLevel: themeConfig.material.bumpLevel || 0.5,
          specularTexture: specularMap || undefined,
          specularPower: themeConfig.material.specularPower || 64,
          specularColor: new Color3(0.8, 0.8, 0.8),
        }
      ) as any;

      this.materialCache.set(themeConfig.systemName, material);
      if (themeConfig.systemName === themeManager.getCurrentTheme()) {
        this.material = material;
      }
    }

    log.info("Splash material loaded");
  }

  private disposeMaterialCache(): void {
    this.materialCache.forEach((material) => material.dispose());
    this.materialCache.clear();
    this.material = null;
  }

  private resolveMaterialForDie(
    dieType: string
  ): { material: StandardMaterial | ShaderMaterial; themeName: string } | null {
    const currentThemeConfig = themeManager.getCurrentThemeConfig();
    const currentThemeName = currentThemeConfig?.systemName ?? themeManager.getCurrentTheme();
    const fallbackThemeName =
      currentThemeConfig?.useFallbackFor?.includes(dieType) === true
        ? currentThemeConfig.fallbackTheme
        : undefined;

    if (fallbackThemeName && this.materialCache.has(fallbackThemeName)) {
      const fallbackMaterial = this.materialCache.get(fallbackThemeName)!;
      return { material: fallbackMaterial, themeName: fallbackThemeName };
    }

    const currentThemeMaterial =
      (currentThemeName && this.materialCache.get(currentThemeName)) || this.material;

    if (currentThemeMaterial && currentThemeName) {
      return { material: currentThemeMaterial, themeName: currentThemeName };
    }
    const firstThemeEntry = this.materialCache.entries().next().value as
      | [string, StandardMaterial | ShaderMaterial]
      | undefined;
    if (firstThemeEntry) {
      return { themeName: firstThemeEntry[0], material: firstThemeEntry[1] };
    }
    return null;
  }

  /**
   * Create animated dice in the scene
   */
  async createDice(count: number = 15): Promise<void> {
    // Wait for initialization to complete
    await this.initPromise;

    if (!this.geometryLoaded || !this.material) {
      log.warn("Geometry not loaded yet for splash dice");
      return;
    }

    const dieTypes = ["d4", "d6", "d8", "d10", "d12", "d20"];

    for (let i = 0; i < count; i++) {
      const dieType = dieTypes[i % dieTypes.length];
      const template = this.templateMeshes.get(dieType);

      if (!template) {
        log.warn(`No template for ${dieType}`);
        continue;
      }

      // Clone die
      const die = template.clone(`splash-die-${i}`, null, false, false) as Mesh;
      die.setEnabled(true);
      die.isPickable = true;

      // Random position in 3D space
      const angle = Math.random() * Math.PI * 2;
      const radius = 5 + Math.random() * 5;
      const height = (Math.random() - 0.5) * 8;

      die.position.x = Math.cos(angle) * radius;
      die.position.y = height;
      die.position.z = Math.sin(angle) * radius;

      // Random initial rotation
      die.rotation.x = Math.random() * Math.PI * 2;
      die.rotation.y = Math.random() * Math.PI * 2;
      die.rotation.z = Math.random() * Math.PI * 2;

      // Apply size scaling
      const size = DIE_SIZES[dieType] || 1.5;
      const scaleFactor = size * 10;
      die.scaling = new Vector3(scaleFactor, scaleFactor, scaleFactor);

      const materialSelection = this.resolveMaterialForDie(dieType);
      if (!materialSelection) {
        die.dispose();
        continue;
      }
      const materialToUse = materialSelection.material;

      // Clone material with color tint (only for StandardMaterial)
      const baseColor = Color3.FromHexString(DIE_COLORS[i % DIE_COLORS.length]);
      const mat = materialToUse.clone(`splash-mat-${i}`) as StandardMaterial | ShaderMaterial;

      // Only apply diffuse color tint for StandardMaterial
      if (mat instanceof StandardMaterial) {
        mat.diffuseColor = new Color3(
          0.5 + baseColor.r * 0.5,
          0.5 + baseColor.g * 0.5,
          0.5 + baseColor.b * 0.5
        );
      }
      // For ShaderMaterial (color materials), the base color is already set
      // No need to tint as it would override the shader's baseColor uniform

      die.material = mat;

      // Random rotation speeds
      const rotSpeedX = (Math.random() - 0.5) * 0.06;
      const rotSpeedY = (Math.random() - 0.5) * 0.06;
      const rotSpeedZ = (Math.random() - 0.5) * 0.06;

      // Random velocity for flying motion
      const velocityX = (Math.random() - 0.5) * 0.08;
      const velocityY = (Math.random() - 0.5) * 0.08;
      const velocityZ = (Math.random() - 0.5) * 0.08;

      const motionState: SplashDieMotionState = {
        mesh: die,
        velocity: new Vector3(velocityX, velocityY, velocityZ),
        rotationVelocity: new Vector3(rotSpeedX, rotSpeedY, rotSpeedZ),
        baseScale: scaleFactor,
        dieType,
      };
      this.dieMotionStates.push(motionState);
      this.motionStateByMeshId.set(die.uniqueId, motionState);
      this.dieThemeByMeshId.set(die.uniqueId, materialSelection.themeName);
      this.diceMeshes.push(die);
    }
    this.ensureAnimationLoop();

    log.info(`Created ${count} splash dice`);
  }

  isDiceMesh(mesh: AbstractMesh): boolean {
    return this.motionStateByMeshId.has(mesh.uniqueId);
  }

  nudgeDie(mesh: AbstractMesh): void {
    const state = this.motionStateByMeshId.get(mesh.uniqueId);
    if (!state) {
      return;
    }

    const impulseVector = state.mesh.position.clone();
    if (impulseVector.lengthSquared() < 0.0001) {
      impulseVector.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
    }
    impulseVector.normalize();
    const impulseStrength = 0.04 + Math.random() * 0.06;
    state.velocity.addInPlace(impulseVector.scale(impulseStrength));
    state.velocity.y += (Math.random() - 0.25) * 0.05;

    const maxVelocity = 0.2;
    const velocityLength = state.velocity.length();
    if (velocityLength > maxVelocity) {
      state.velocity.scaleInPlace(maxVelocity / velocityLength);
    }

    state.rotationVelocity.scaleInPlace(1.12);
  }

  private ensureAnimationLoop(): void {
    if (this.animationRegistered) {
      return;
    }
    this.scene.registerBeforeRender(this.animateDice);
    this.animationRegistered = true;
  }

  private updateDiceMotion(): void {
    if (this.dieMotionStates.length === 0) {
      return;
    }

    const camera = this.scene.activeCamera;
    if (!camera) {
      return;
    }

    const deltaSeconds = Math.min(this.scene.getEngine().getDeltaTime() / 1000, 0.05);
    const frameScale = deltaSeconds * SPLASH_DICE_SPEED_MULTIPLIER;
    const cameraPosition = camera.globalPosition ?? (camera as any).position;
    if (!cameraPosition) {
      return;
    }

    this.dieMotionStates.forEach((state) => {
      const { mesh, velocity, rotationVelocity } = state;
      mesh.rotation.x += rotationVelocity.x * frameScale;
      mesh.rotation.y += rotationVelocity.y * frameScale;
      mesh.rotation.z += rotationVelocity.z * frameScale;

      mesh.position.x += velocity.x * frameScale;
      mesh.position.y += velocity.y * frameScale;
      mesh.position.z += velocity.z * frameScale;

      // Wrap in volume to keep endless motion.
      if (Math.abs(mesh.position.x) > SPLASH_DICE_WRAP_DISTANCE) {
        mesh.position.x = -Math.sign(mesh.position.x) * SPLASH_DICE_WRAP_DISTANCE;
      }
      if (Math.abs(mesh.position.y) > SPLASH_DICE_WRAP_DISTANCE) {
        mesh.position.y = -Math.sign(mesh.position.y) * SPLASH_DICE_WRAP_DISTANCE;
      }
      if (Math.abs(mesh.position.z) > SPLASH_DICE_WRAP_DISTANCE) {
        mesh.position.z = -Math.sign(mesh.position.z) * SPLASH_DICE_WRAP_DISTANCE;
      }

      // Scale by camera distance: grow when approaching, shrink when receding.
      const distanceToCamera = Vector3.Distance(mesh.position, cameraPosition);
      const distanceT = Scalar.Clamp(
        (distanceToCamera - SPLASH_DICE_NEAR_SCALE_DISTANCE) /
          (SPLASH_DICE_FAR_SCALE_DISTANCE - SPLASH_DICE_NEAR_SCALE_DISTANCE),
        0,
        1
      );
      const easedDistanceT = distanceT * distanceT;
      const distanceScale =
        SPLASH_DICE_NEAR_SCALE_MULTIPLIER +
        (SPLASH_DICE_FAR_SCALE_MULTIPLIER - SPLASH_DICE_NEAR_SCALE_MULTIPLIER) * easedDistanceT;

      // Additional edge fade makes wrap transitions feel less abrupt.
      const edgeDistance = Math.max(
        Math.abs(mesh.position.x),
        Math.abs(mesh.position.y),
        Math.abs(mesh.position.z)
      );
      const edgeFadeT = Scalar.Clamp(
        (edgeDistance - SPLASH_DICE_WRAP_DISTANCE * SPLASH_DICE_EDGE_FADE_START) /
          (SPLASH_DICE_WRAP_DISTANCE * SPLASH_DICE_EDGE_FADE_RANGE),
        0,
        1
      );
      const edgeScale = 1 - edgeFadeT * 0.92;

      const scaledSize = Math.max(0.08, state.baseScale * distanceScale * edgeScale);
      mesh.scaling.set(scaledSize, scaledSize, scaledSize);
    });
  }

  /**
   * Handle theme change
   */
  private async onThemeChanged(): Promise<void> {
    log.info("Theme changed for splash dice...");

    // Reload material
    await this.createMaterial();

    // Update all dice materials with fresh random cross-theme assignment.
    this.dieMotionStates.forEach((motionState, index) => {
      const die = motionState.mesh;
      const materialSelection = this.resolveMaterialForDie(motionState.dieType);
      if (!materialSelection) {
        return;
      }

      const baseColor = Color3.FromHexString(DIE_COLORS[index % DIE_COLORS.length]);
      const mat = materialSelection.material.clone(
        `splash-mat-theme-${index}-${materialSelection.themeName}`
      ) as StandardMaterial | ShaderMaterial;

      // Only apply diffuse color tint for StandardMaterial
      if (mat instanceof StandardMaterial) {
        mat.diffuseColor = new Color3(
          0.5 + baseColor.r * 0.5,
          0.5 + baseColor.g * 0.5,
          0.5 + baseColor.b * 0.5
        );
      }

      die.material?.dispose();
      die.material = mat;
      this.dieThemeByMeshId.set(die.uniqueId, materialSelection.themeName);
    });

    log.info("Splash dice theme updated");
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.unsubscribeTheme?.();

    if (this.animationRegistered) {
      this.scene.unregisterBeforeRender(this.animateDice);
      this.animationRegistered = false;
    }

    this.diceMeshes.forEach(die => die.dispose());
    this.diceMeshes = [];
    this.dieMotionStates = [];
    this.motionStateByMeshId.clear();
    this.dieThemeByMeshId.clear();

    this.templateMeshes.forEach(mesh => mesh.dispose());
    this.templateMeshes.clear();

    this.disposeMaterialCache();
  }
}
