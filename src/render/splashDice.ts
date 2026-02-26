/**
 * Splash Dice Renderer
 * Simplified dice renderer for splash screen background
 * Uses same geometry and materials as game dice
 */

import {
  Scene,
  Mesh,
  Material,
  StandardMaterial,
  ShaderMaterial,
  Color3,
  Vector3,
  Texture,
} from "@babylonjs/core";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import { themeManager } from "../services/themeManager.js";
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

export class SplashDiceRenderer {
  private templateMeshes = new Map<string, Mesh>();
  private diceMeshes: Mesh[] = [];
  private material: StandardMaterial | ShaderMaterial | null = null;
  private geometryLoaded = false;
  private unsubscribeTheme?: () => void;
  private initPromise: Promise<void>;

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

    // Clear material cache
    this.materialCache.clear();

    // Load primary theme material
    await this.loadMaterialForTheme(themeConfig, false);

    // Load fallback theme material if configured
    if (themeConfig.fallbackTheme) {
      const fallbackConfig = themeManager.getThemeConfig(themeConfig.fallbackTheme);
      if (fallbackConfig) {
        log.info(`Loading fallback splash material: ${fallbackConfig.name}`);
        await this.loadMaterialForTheme(fallbackConfig, true);
      }
    }
  }

  /**
   * Load material for a specific theme
   */
  private async loadMaterialForTheme(themeConfig: any, isFallback: boolean): Promise<void> {
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

      const materialName = isFallback ? `splash-dice-material-${themeConfig.systemName}` : "splash-dice-material";
      const material = new StandardMaterial(materialName, this.scene);
      material.diffuseTexture = diffuseTexture;
      material.bumpTexture = normalMap;
      material.bumpTexture.level = themeConfig.material.bumpLevel || 0.5;
      if (specularMap) {
        material.specularTexture = specularMap;
      }
      material.specularColor = new Color3(0.5, 0.5, 0.5);
      material.specularPower = themeConfig.material.specularPower || 64;

      if (isFallback) {
        this.materialCache.set(themeConfig.systemName, material);
      } else {
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
      const materialName = isFallback ? `splash-dice-color-material-${themeConfig.systemName}` : "splash-dice-color-material";
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

      if (isFallback) {
        this.materialCache.set(themeConfig.systemName, material);
      } else {
        this.material = material;
      }
    }

    log.info("Splash material loaded");
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
      die.isPickable = false;

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

      // Determine which material to use (primary or fallback)
      const currentTheme = themeManager.getCurrentThemeConfig();
      let materialToUse = this.material;

      if (currentTheme?.useFallbackFor?.includes(dieType) && currentTheme.fallbackTheme) {
        const fallbackMaterial = this.materialCache.get(currentTheme.fallbackTheme);
        if (fallbackMaterial) {
          materialToUse = fallbackMaterial;
          log.debug(`Splash die ${dieType} using fallback material: ${currentTheme.fallbackTheme}`);
        }
      }

      // Clone material with color tint (only for StandardMaterial)
      const baseColor = Color3.FromHexString(DIE_COLORS[i % DIE_COLORS.length]);
      const mat = materialToUse!.clone(`splash-mat-${i}`) as StandardMaterial | ShaderMaterial;

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

      const maxDistance = 15;

      // Animation
      this.scene.registerBeforeRender(() => {
        die.rotation.x += rotSpeedX;
        die.rotation.y += rotSpeedY;
        die.rotation.z += rotSpeedZ;

        die.position.x += velocityX;
        die.position.y += velocityY;
        die.position.z += velocityZ;

        // Wrap around
        if (Math.abs(die.position.x) > maxDistance) {
          die.position.x = -Math.sign(die.position.x) * maxDistance;
        }
        if (Math.abs(die.position.y) > maxDistance) {
          die.position.y = -Math.sign(die.position.y) * maxDistance;
        }
        if (Math.abs(die.position.z) > maxDistance) {
          die.position.z = -Math.sign(die.position.z) * maxDistance;
        }
      });

      this.diceMeshes.push(die);
    }

    log.info(`Created ${count} splash dice`);
  }

  /**
   * Handle theme change
   */
  private async onThemeChanged(): Promise<void> {
    log.info("Theme changed for splash dice...");

    // Dispose old material
    this.material?.dispose();

    // Reload material
    await this.createMaterial();

    // Update all dice materials
    this.diceMeshes.forEach((die, index) => {
      if (this.material) {
        const baseColor = Color3.FromHexString(DIE_COLORS[index % DIE_COLORS.length]);
        const mat = this.material.clone(`splash-mat-${index}`) as StandardMaterial | ShaderMaterial;

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
      }
    });

    log.info("Splash dice theme updated");
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.unsubscribeTheme?.();

    this.diceMeshes.forEach(die => die.dispose());
    this.diceMeshes = [];

    this.templateMeshes.forEach(mesh => mesh.dispose());
    this.templateMeshes.clear();

    this.material?.dispose();
  }
}
