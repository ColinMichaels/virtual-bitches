/**
 * Splash Background 3D
 * Handles floating dice background for splash/main menu.
 * Loaded lazily to keep shell startup lightweight.
 */

import {
  ArcRotateCamera,
  Color4,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Layer,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { SplashDiceRenderer } from "../render/splashDice.js";
import { logger } from "../utils/logger.js";

const log = logger.create("SplashBackground3D");

export class SplashBackground3D {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private diceRenderer: SplashDiceRenderer | null = null;
  private initialized = false;
  private readonly renderLoop = () => {
    this.scene?.render();
  };
  private readonly resizeHandler = () => {
    this.engine?.resize();
  };

  constructor(private readonly canvas: HTMLCanvasElement) {}

  async initialize(onStatus?: (message: string) => void): Promise<void> {
    if (this.initialized) {
      this.start();
      return;
    }

    onStatus?.("Initializing 3D menu...");
    this.engine = new Engine(this.canvas, true);
    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color4(0, 0, 0, 0);

    this.createGradientBackground();
    this.createCameraAndLighting();

    onStatus?.("Loading dice assets...");
    this.diceRenderer = new SplashDiceRenderer(this.scene);

    onStatus?.("Spawning floating dice...");
    await this.diceRenderer.createDice(15);

    onStatus?.("Animating floating dice...");
    this.initialized = true;
    this.start();
    window.addEventListener("resize", this.resizeHandler);
    this.engine.resize();
    log.info("Splash background initialized");
  }

  start(): void {
    if (!this.engine || !this.initialized) {
      return;
    }
    this.engine.runRenderLoop(this.renderLoop);
  }

  stop(): void {
    if (!this.engine) {
      return;
    }
    this.engine.stopRenderLoop(this.renderLoop);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener("resize", this.resizeHandler);
    this.diceRenderer?.dispose();
    this.diceRenderer = null;
    this.scene?.dispose();
    this.scene = null;
    this.engine?.dispose();
    this.engine = null;
    this.initialized = false;
  }

  private createCameraAndLighting(): void {
    if (!this.scene) {
      return;
    }

    const camera = new ArcRotateCamera(
      "splash-camera",
      -Math.PI / 4,
      Math.PI / 3,
      15,
      Vector3.Zero(),
      this.scene
    );
    camera.lowerRadiusLimit = 10;
    camera.upperRadiusLimit = 20;

    this.scene.registerBeforeRender(() => {
      camera.alpha += 0.001;
    });

    const light = new HemisphericLight("splash-light", new Vector3(0, 1, 0), this.scene);
    light.intensity = 0.8;
  }

  private createGradientBackground(): void {
    if (!this.scene) {
      return;
    }

    const gradientTexture = new DynamicTexture(
      "splashGradient",
      { width: 512, height: 512 },
      this.scene,
      false
    );

    const ctx = gradientTexture.getContext() as CanvasRenderingContext2D;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, "#2a3545");
    gradient.addColorStop(0.3, "#1f2935");
    gradient.addColorStop(0.6, "#151c26");
    gradient.addColorStop(1, "#0a0f16");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    gradientTexture.update();

    const backgroundLayer = new Layer("splashBackgroundLayer", null, this.scene, true);
    backgroundLayer.texture = gradientTexture;
    backgroundLayer.isBackground = true;
  }
}
