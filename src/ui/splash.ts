/**
 * Splash Screen
 * Displays intro screen with animated 3D dice background
 */

import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  Color3,
  Color4,
  DynamicTexture,
  Layer,
} from "@babylonjs/core";
import { audioService } from "../services/audio.js";
import { environment } from "../environments/environment.js";
import { SplashDiceRenderer } from "../render/splashDice.js";

export class SplashScreen {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private diceRenderer: SplashDiceRenderer | null = null;
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

    // Create gradient background with atmospheric depth (matches game scene)
    this.scene.clearColor = new Color4(0, 0, 0, 0); // Transparent for gradient
    this.createGradientBackground();

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

    // Create dice renderer and dice
    this.diceRenderer = new SplashDiceRenderer(this.scene);
    // Wait a bit for geometry to load before creating dice
    setTimeout(() => {
      this.diceRenderer?.createDice(15);
    }, 100);

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
   * Create gradient background with atmospheric depth
   * Matches the game scene gradient for visual consistency
   */
  private createGradientBackground(): void {
    const gradientTexture = new DynamicTexture(
      "splashGradient",
      { width: 512, height: 512 },
      this.scene,
      false
    );

    const ctx = gradientTexture.getContext() as CanvasRenderingContext2D;

    // Create vertical gradient (top to bottom)
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);

    // Top: Lighter atmospheric blue-gray (ceiling/sky)
    gradient.addColorStop(0, "#2a3545"); // Medium blue-gray
    gradient.addColorStop(0.3, "#1f2935"); // Darker
    gradient.addColorStop(0.6, "#151c26"); // Even darker
    gradient.addColorStop(1, "#0a0f16"); // Very dark at bottom (floor)

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    gradientTexture.update();

    // Create background layer
    const backgroundLayer = new Layer(
      "splashBackgroundLayer",
      null, // Pass null for imgUrl, assign texture directly
      this.scene,
      true
    );

    // Assign DynamicTexture to Layer's texture property
    backgroundLayer.texture = gradientTexture;
    backgroundLayer.isBackground = true;
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    this.animationRunning = false;
    this.diceRenderer?.dispose();
    this.scene?.dispose();
    this.engine?.dispose();
    this.container.remove();
  }
}
