/**
 * Splash Screen
 * Displays intro screen with animated 3D dice background
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  Vector4,
  HemisphericLight,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Animation,
  DynamicTexture,
  PhysicsImpostor,
} from "@babylonjs/core";
import "@babylonjs/core/Physics/physicsEngineComponent";
import { audioService } from "../services/audio.js";
import {environment} from "../environments/environment";

export class SplashScreen {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private animationRunning = false;
  gameTitle = environment.gameTitle;

  constructor(onStart: () => void, onSettings: () => void, onLeaderboard: () => void, onRules: () => void) {
    // Create splash container
    this.container = document.createElement("div");
    this.container.id = "splash-screen";
    this.container.innerHTML = `
      <canvas id="splash-canvas"></canvas>
      <div class="splash-content">
        <h1 class="splash-title">${this.gameTitle}</h1>
        <p class="splash-subtitle">Push Your Luck Dice Game</p>
        <p class="splash-tagline">Roll • Select • Score Low to Win</p>
        <div class="splash-buttons">
          <button id="start-game-btn" class="primary splash-btn">Start Game</button>
          <button id="splash-rules-btn" class="splash-btn">How to Play</button>
          <button id="splash-leaderboard-btn" class="splash-btn">Leaderboard</button>
          <button id="splash-settings-btn" class="splash-btn">Settings</button>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);

    this.canvas = document.getElementById("splash-canvas") as HTMLCanvasElement;

    // Setup button handlers
    document.getElementById("start-game-btn")!.addEventListener("click", () => {
      audioService.playSfx("click");
      this.hide();
      onStart();
    });

    document.getElementById("splash-rules-btn")!.addEventListener("click", () => {
      audioService.playSfx("click");
      onRules();
    });

    document.getElementById("splash-leaderboard-btn")!.addEventListener("click", () => {
      audioService.playSfx("click");
      onLeaderboard();
    });

    document.getElementById("splash-settings-btn")!.addEventListener("click", () => {
      audioService.playSfx("click");
      onSettings();
    });

    // Initialize 3D background
    this.initializeBackground();
  }

  /**
   * Initialize animated 3D dice background
   */
  private initializeBackground(): void {
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color3(0.1, 0.1, 0.18).toColor4();

    // Camera
    const camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 4,
      Math.PI / 3,
      15,
      Vector3.Zero(),
      this.scene
    );
    camera.lowerRadiusLimit = 10;
    camera.upperRadiusLimit = 20;

    // Slowly rotate camera
    this.scene.registerBeforeRender(() => {
      camera.alpha += 0.001;
    });

    // Lighting
    const light = new HemisphericLight("light", new Vector3(0, 1, 0), this.scene);
    light.intensity = 0.8;

    // Create multiple animated dice
    this.createAnimatedDice();

    // Start render loop
    this.animationRunning = true;
    this.engine.runRenderLoop(() => {
      if (this.animationRunning && this.scene) {
        this.scene.render();
      }
    });

    // Handle resize
    window.addEventListener("resize", () => {
      this.engine?.resize();
    });
  }

  /**
   * Create multiple dice tumbling in space
   */
  private createAnimatedDice(): void {
    if (!this.scene) return;

    const dieColors = [
      "#1a1a1a", // Black
      "#2d8b45", // Green
      "#3366cc", // Blue
      "#cc2233", // Red
      "#ffd700", // Yellow
      "#ff69b4", // Pink
      "#9966cc", // Purple
      "#f5deb3", // Cream
    ];

    const dieTypes = [
      { type: 0, name: "d4", size: 1.3 },   // Tetrahedron
      { type: "d6", name: "d6", size: 1.5 }, // Cube (special case)
      { type: 1, name: "d8", size: 1.4 },   // Octahedron
      { type: "d10", name: "d10", size: 1.4 }, // Cylinder (special case)
      { type: 3, name: "d12", size: 1.6 },  // Dodecahedron
    ];

    // Create 15 dice with random types
    for (let i = 0; i < 15; i++) {
      const dieType = dieTypes[i % dieTypes.length];
      let die;

      if (dieType.name === "d6") {
        // Create d6 with UV mapping for texture atlas
        const faceUV: Vector4[] = [];
        const faceMap = [1, 6, 2, 5, 3, 4]; // front, back, right, left, top, bottom

        for (let face of faceMap) {
          const col = (face - 1) % 3;
          const row = Math.floor((face - 1) / 3);
          const u1 = col / 3;
          const v1 = row / 2;
          const u2 = (col + 1) / 3;
          const v2 = (row + 1) / 2;
          faceUV.push(new Vector4(u1, v1, u2, v2));
        }

        die = MeshBuilder.CreateBox(
          `die-${i}`,
          {
            size: dieType.size,
            faceUV: faceUV,
            wrap: true
          },
          this.scene
        );
      } else if (dieType.name === "d10") {
        // Create d10 as cylinder
        die = MeshBuilder.CreateCylinder(
          `die-${i}`,
          {
            height: dieType.size * 0.8,
            diameterTop: dieType.size * 0.6,
            diameterBottom: dieType.size * 0.6,
            tessellation: 5
          },
          this.scene
        );
      } else {
        // Create polyhedron
        die = MeshBuilder.CreatePolyhedron(
          `die-${i}`,
          { type: dieType.type as number, size: dieType.size * 0.8 },
          this.scene
        );
      }

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

      // Create material
      const baseColor = Color3.FromHexString(dieColors[i % dieColors.length]);
      const mat = new StandardMaterial(`mat-${i}`, this.scene);
      mat.diffuseColor = baseColor;
      mat.specularColor = new Color3(1, 1, 1);
      mat.specularPower = 128;

      // Add texture for d6
      if (dieType.name === "d6") {
        const texture = this.createD6Texture(baseColor, i);
        mat.diffuseTexture = texture;
      }

      die.material = mat;

      // Random rotation speeds (increased)
      const rotSpeedX = (Math.random() - 0.5) * 0.06;
      const rotSpeedY = (Math.random() - 0.5) * 0.06;
      const rotSpeedZ = (Math.random() - 0.5) * 0.06;

      // Random velocity for flying motion
      const velocityX = (Math.random() - 0.5) * 0.08;
      const velocityY = (Math.random() - 0.5) * 0.08;
      const velocityZ = (Math.random() - 0.5) * 0.08;

      // Boundary for wrapping
      const maxDistance = 15;

      // Continuous rotation and movement animation
      this.scene.registerBeforeRender(() => {
        die.rotation.x += rotSpeedX;
        die.rotation.y += rotSpeedY;
        die.rotation.z += rotSpeedZ;

        // Flying motion
        die.position.x += velocityX;
        die.position.y += velocityY;
        die.position.z += velocityZ;

        // Wrap around when dice fly off screen
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
    }
  }

  /**
   * Show splash screen
   */
  show(): void {
    this.container.style.display = "flex";
    this.animationRunning = true;
    this.engine?.resize();
  }

  /**
   * Hide splash screen with fade out
   */
  hide(): void {
    this.container.classList.add("fade-out");

    setTimeout(() => {
      this.container.style.display = "none";
      this.animationRunning = false;
    }, 500);
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.animationRunning = false;
    this.scene?.dispose();
    this.engine?.dispose();
    this.container.remove();
  }

  /**
   * Create d6 texture with pips (same as game dice)
   */
  private createD6Texture(baseColor: Color3, index: number): DynamicTexture {
    // 3x2 atlas layout:
    // Top row: 1, 2, 3
    // Bottom row: 4, 5, 6
    const texture = new DynamicTexture(`splash-d6-${index}`, { width: 1536, height: 1024 }, this.scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D;

    const faceSize = 512;
    const r = Math.floor(baseColor.r * 255);
    const g = Math.floor(baseColor.g * 255);
    const b = Math.floor(baseColor.b * 255);

    // Draw all 6 faces
    for (let i = 1; i <= 6; i++) {
      const col = (i - 1) % 3;
      const row = Math.floor((i - 1) / 3);
      const x = col * faceSize;
      const y = row * faceSize;

      // Fill face background
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(x, y, faceSize, faceSize);

      // Draw pips for this face
      ctx.save();
      ctx.translate(x, y);
      this.drawPipsOnFace(ctx, i, faceSize);
      ctx.restore();
    }

    texture.update();
    return texture;
  }

  /**
   * Draw pips on a die face (same as game dice)
   */
  private drawPipsOnFace(ctx: CanvasRenderingContext2D, value: number, faceSize: number): void {
    const center = faceSize / 2;
    const offset = faceSize * 0.235;
    const pipRadius = faceSize * 0.098;

    const positions: Record<number, Array<[number, number]>> = {
      1: [[center, center]],
      2: [[center - offset, center - offset], [center + offset, center + offset]],
      3: [[center - offset, center - offset], [center, center], [center + offset, center + offset]],
      4: [
        [center - offset, center - offset],
        [center + offset, center - offset],
        [center - offset, center + offset],
        [center + offset, center + offset],
      ],
      5: [
        [center - offset, center - offset],
        [center + offset, center - offset],
        [center, center],
        [center - offset, center + offset],
        [center + offset, center + offset],
      ],
      6: [
        [center - offset, center - offset * 1.1],
        [center - offset, center],
        [center - offset, center + offset * 1.1],
        [center + offset, center - offset * 1.1],
        [center + offset, center],
        [center + offset, center + offset * 1.1],
      ],
    };

    const pips = positions[value] || [];

    // Draw white pips
    pips.forEach(([x, y]) => {
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, pipRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}
