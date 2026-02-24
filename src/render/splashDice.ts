/**
 * Splash Dice Renderer
 * Simplified dice renderer for splash screen background
 * Uses same geometry and materials as game dice
 */

import {
  Scene,
  Mesh,
  StandardMaterial,
  Color3,
  Vector3,
  Texture,
} from "@babylonjs/core";
import { SceneLoader } from "@babylonjs/core/Loading/sceneLoader";
import "@babylonjs/loaders/glTF";
import { themeManager } from "../services/themeManager.js";

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
  private material: StandardMaterial | null = null;
  private geometryLoaded = false;
  private unsubscribeTheme?: () => void;
  private initPromise: Promise<void>;

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
      console.log("✅ Splash dice renderer initialized");
    } catch (error) {
      console.error("❌ Failed to initialize splash dice renderer:", error);
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
    console.log(`📦 Loading splash geometry from: ${geometryPath}`);

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
      null,
      null,
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
      mesh.freezeNormals();
      this.templateMeshes.set(mesh.name, mesh as Mesh);
    });
  }

  /**
   * Create material using current theme
   */
  private async createMaterial(): Promise<void> {
    const themeConfig = themeManager.getCurrentThemeConfig();
    if (!themeConfig) {
      console.error("❌ No theme config available for splash");
      return;
    }

    const basePath = themeManager.getCurrentThemePath();
    console.log("🎨 Loading splash material from:", basePath);

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

      this.material = new StandardMaterial("splash-dice-material", this.scene);
      this.material.diffuseTexture = diffuseTexture;
      this.material.bumpTexture = normalMap;
      this.material.bumpTexture.level = themeConfig.material.bumpLevel || 0.5;
      if (specularMap) {
        this.material.specularTexture = specularMap;
      }
      this.material.specularColor = new Color3(0.5, 0.5, 0.5);
      this.material.specularPower = themeConfig.material.specularPower || 64;
    } else {
      // Color material type
      const diffuseConfig = themeConfig.material.diffuseTexture as { light: string; dark: string };
      const diffuseLight = new Texture(
        `${basePath}/${diffuseConfig.light}`,
        this.scene,
        undefined,
        true // invertY
      );
      diffuseLight.hasAlpha = true;
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

      this.material = new StandardMaterial("splash-dice-material", this.scene);
      // Use diffuseTexture directly - matches dice-box approach
      this.material.diffuseTexture = diffuseLight;
      this.material.bumpTexture = normalMap;
      this.material.bumpTexture.level = themeConfig.material.bumpLevel || 0.5;
      if (specularMap) {
        this.material.specularTexture = specularMap;
      }
      this.material.specularColor = new Color3(0.8, 0.8, 0.8);
      this.material.specularPower = themeConfig.material.specularPower || 64;
    }

    console.log("✅ Splash material loaded");
  }

  /**
   * Create animated dice in the scene
   */
  async createDice(count: number = 15): Promise<void> {
    // Wait for initialization to complete
    await this.initPromise;

    if (!this.geometryLoaded || !this.material) {
      console.warn("⚠️ Geometry not loaded yet for splash dice");
      return;
    }

    const dieTypes = ["d4", "d6", "d8", "d10", "d12", "d20"];

    for (let i = 0; i < count; i++) {
      const dieType = dieTypes[i % dieTypes.length];
      const template = this.templateMeshes.get(dieType);

      if (!template) {
        console.warn(`⚠️ No template for ${dieType}`);
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

      // Clone material with color tint
      const baseColor = Color3.FromHexString(DIE_COLORS[i % DIE_COLORS.length]);
      const mat = this.material.clone(`splash-mat-${i}`);
      mat.diffuseColor = new Color3(
        0.5 + baseColor.r * 0.5,
        0.5 + baseColor.g * 0.5,
        0.5 + baseColor.b * 0.5
      );
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

    console.log(`✅ Created ${count} splash dice`);
  }

  /**
   * Handle theme change
   */
  private async onThemeChanged(): Promise<void> {
    console.log("🔄 Theme changed for splash dice...");

    // Dispose old material
    this.material?.dispose();

    // Reload material
    await this.createMaterial();

    // Update all dice materials
    this.diceMeshes.forEach((die, index) => {
      if (this.material) {
        const baseColor = Color3.FromHexString(DIE_COLORS[index % DIE_COLORS.length]);
        const mat = this.material.clone(`splash-mat-${index}`);
        mat.diffuseColor = new Color3(
          0.5 + baseColor.r * 0.5,
          0.5 + baseColor.g * 0.5,
          0.5 + baseColor.b * 0.5
        );
        die.material?.dispose();
        die.material = mat;
      }
    });

    console.log("✅ Splash dice theme updated");
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
