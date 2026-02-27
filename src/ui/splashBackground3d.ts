/**
 * Splash Background 3D
 * Handles floating dice background for splash/main menu.
 * Loaded lazily to keep shell startup lightweight.
 */

import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  DynamicTexture,
  Engine,
  HemisphericLight,
  Layer,
  Light,
  PointerEventTypes,
  Scene,
  SpotLight,
  Vector3,
} from "@babylonjs/core";
import { SplashDiceRenderer } from "../render/splashDice.js";
import { logger } from "../utils/logger.js";

const log = logger.create("SplashBackground3D");
const ACCENT_SPOT_COUNT = 7;
const SPLASH_DICE_COUNT = 30;
const POLICE_LIGHT_DURATION_MS = 3800;
const COLOR_CYCLE_SPEED = 2.2;
const BOKEH_LAYER_COUNT = 34;
const BOKEH_COLORS = [
  "rgba(90, 148, 255, 0.2)",
  "rgba(64, 232, 255, 0.18)",
  "rgba(255, 112, 186, 0.14)",
  "rgba(255, 206, 120, 0.12)",
];

export class SplashBackground3D {
  private engine: Engine | null = null;
  private scene: Scene | null = null;
  private camera: ArcRotateCamera | null = null;
  private diceRenderer: SplashDiceRenderer | null = null;
  private ambientLight: HemisphericLight | null = null;
  private keyLight: DirectionalLight | null = null;
  private accentSpotLights: SpotLight[] = [];
  private policeModeUntilMs = 0;
  private initialized = false;
  private readonly renderLoop = () => {
    this.scene?.render();
  };
  private readonly sceneAnimator = () => {
    this.updateSceneAnimation();
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
    this.scene.attachControl(true, true, true);

    this.createGradientBackground();
    this.createCameraAndLighting();

    onStatus?.("Loading dice assets...");
    this.diceRenderer = new SplashDiceRenderer(this.scene);

    onStatus?.("Spawning floating dice...");
    await this.diceRenderer.createDice(SPLASH_DICE_COUNT);
    this.setupDiceInteraction();

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
    this.scene?.unregisterBeforeRender(this.sceneAnimator);
    this.scene?.detachControl();
    this.diceRenderer?.dispose();
    this.diceRenderer = null;
    this.camera = null;
    this.ambientLight = null;
    this.keyLight = null;
    this.accentSpotLights = [];
    this.policeModeUntilMs = 0;
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

    this.camera = new ArcRotateCamera(
      "splash-camera",
      -Math.PI / 4,
      Math.PI / 3,
      15,
      Vector3.Zero(),
      this.scene
    );
    this.camera.lowerRadiusLimit = 10;
    this.camera.upperRadiusLimit = 20;
    this.scene.activeCamera = this.camera;
    this.scene.registerBeforeRender(this.sceneAnimator);

    this.ambientLight = new HemisphericLight(
      "splash-ambient-light",
      new Vector3(0, 1, 0),
      this.scene
    );
    this.ambientLight.intensity = 0.34;
    this.ambientLight.groundColor = new Color3(0.06, 0.09, 0.16);

    this.keyLight = new DirectionalLight(
      "splash-key-light",
      new Vector3(-0.35, -1, -0.35),
      this.scene
    );
    this.keyLight.position = new Vector3(10, 20, 10);
    this.keyLight.intensity = 1.08;
    this.keyLight.diffuse = new Color3(0.96, 0.97, 1.0);

    this.accentSpotLights = [];
    for (let i = 0; i < ACCENT_SPOT_COUNT; i += 1) {
      const phase = (i / ACCENT_SPOT_COUNT) * Math.PI * 2;
      const spot = new SpotLight(
        `splash-accent-spot-${i}`,
        new Vector3(Math.cos(phase) * 18, 11.8, Math.sin(phase) * 18),
        new Vector3(0, -1, 0),
        Math.PI / 2.95,
        0.95,
        this.scene
      );
      spot.falloffType = Light.FALLOFF_GLTF;
      spot.innerAngle = spot.angle * 0.15;
      spot.intensity = 1.9;
      this.accentSpotLights.push(spot);
    }
  }

  private setupDiceInteraction(): void {
    if (!this.scene || !this.diceRenderer) {
      return;
    }

    this.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) {
        return;
      }

      const pickedMesh = pointerInfo.pickInfo?.pickedMesh;
      if (!pickedMesh || !this.diceRenderer?.isDiceMesh(pickedMesh)) {
        return;
      }

      this.diceRenderer.nudgeDie(pickedMesh);
      this.triggerPoliceLights();
    });
  }

  private triggerPoliceLights(durationMs: number = POLICE_LIGHT_DURATION_MS): void {
    const nextTimeout = performance.now() + Math.max(0, durationMs);
    this.policeModeUntilMs = Math.max(this.policeModeUntilMs, nextTimeout);
  }

  private updateSceneAnimation(): void {
    if (!this.camera) {
      return;
    }

    const nowMs = performance.now();
    const timeSeconds = nowMs * 0.001;
    const inPoliceMode = nowMs < this.policeModeUntilMs;
    const strobe = inPoliceMode
      ? Math.sin(timeSeconds * 58) > 0.02
        ? 1
        : 0.08
      : 0;

    this.camera.alpha += 0.00115;
    this.camera.beta = Math.PI / 3 + Math.sin(timeSeconds * 0.38) * 0.045;

    if (this.ambientLight) {
      this.ambientLight.intensity = inPoliceMode ? 0.18 + strobe * 0.62 : 0.34;
    }
    if (this.keyLight) {
      this.keyLight.intensity = inPoliceMode ? 0.4 + strobe * 1.45 : 1.08;
    }

    this.accentSpotLights.forEach((spot, index) => {
      const phase = (index / Math.max(1, this.accentSpotLights.length)) * Math.PI * 2;
      const directionFactor = index % 2 === 0 ? 1 : -1;
      const orbitAngle = phase + timeSeconds * 0.95 * directionFactor;
      const orbitRadius = 17 + Math.sin(timeSeconds * 0.7 + phase * 1.2) * 3.1;
      const height = 11 + Math.sin(timeSeconds * 1.2 + phase * 0.9) * 2.4;
      spot.position.set(
        Math.cos(orbitAngle) * orbitRadius,
        height,
        Math.sin(orbitAngle) * orbitRadius
      );

      const focusTarget = new Vector3(
        Math.sin(timeSeconds * 0.7 + phase) * 3,
        0.8 + Math.sin(timeSeconds * 0.5 + phase * 0.6) * 0.4,
        Math.cos(timeSeconds * 0.75 + phase) * 3
      );
      const direction = focusTarget.subtract(spot.position);
      if (direction.lengthSquared() > 0.0001) {
        spot.direction = direction.normalize();
      }

      if (inPoliceMode) {
        const policePhase = Math.floor(timeSeconds * 9) % 2;
        const isBlueLead = policePhase === 0;
        const red = new Color3(1.0, 0.16, 0.14);
        const blue = new Color3(0.2, 0.42, 1.0);
        const baseColor = index % 2 === 0 ? (isBlueLead ? blue : red) : (isBlueLead ? red : blue);
        const whiteMix = Math.min(1, 0.34 + strobe * 1.0);
        spot.diffuse = new Color3(
          baseColor.r * (1 - whiteMix) + whiteMix,
          baseColor.g * (1 - whiteMix) + whiteMix,
          baseColor.b * (1 - whiteMix) + whiteMix
        );
        spot.specular = new Color3(1.0, 1.0, 1.0);
        spot.intensity = 2.1 + strobe * 4.2;
      } else {
        const cycle = timeSeconds * COLOR_CYCLE_SPEED + phase;
        const color = new Color3(
          0.35 + 0.65 * (0.5 + 0.5 * Math.sin(cycle)),
          0.35 + 0.65 * (0.5 + 0.5 * Math.sin(cycle + 2.094)),
          0.35 + 0.65 * (0.5 + 0.5 * Math.sin(cycle + 4.188))
        );
        const chromaBoost = 0.75 + 0.25 * Math.sin(timeSeconds * 1.8 + phase);
        color.scaleInPlace(chromaBoost);
        spot.diffuse = color;
        spot.specular = new Color3(color.r * 0.9, color.g * 0.9, color.b * 0.9);
        spot.intensity = 1.95 + 1.6 * (0.5 + 0.5 * Math.sin(timeSeconds * 3.4 + phase));
      }
    });
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
    gradient.addColorStop(0, "#101a34");
    gradient.addColorStop(0.32, "#081327");
    gradient.addColorStop(0.66, "#050d1f");
    gradient.addColorStop(1, "#01050e");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);

    const bloomGradient = ctx.createRadialGradient(256, 140, 40, 256, 150, 280);
    bloomGradient.addColorStop(0, "rgba(82, 138, 255, 0.18)");
    bloomGradient.addColorStop(0.5, "rgba(68, 132, 255, 0.08)");
    bloomGradient.addColorStop(1, "rgba(68, 132, 255, 0)");
    ctx.fillStyle = bloomGradient;
    ctx.fillRect(0, 0, 512, 512);

    // Procedural bokeh orbs for cinematic depth.
    for (let i = 0; i < BOKEH_LAYER_COUNT; i += 1) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const radius = 22 + Math.random() * 95;
      const color = BOKEH_COLORS[Math.floor(Math.random() * BOKEH_COLORS.length)];
      const bokeh = ctx.createRadialGradient(x, y, 0, x, y, radius);
      bokeh.addColorStop(0, color);
      bokeh.addColorStop(0.55, color.replace(/0\.\d+\)/, "0.05)"));
      bokeh.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = bokeh;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }

    const vignette = ctx.createRadialGradient(256, 270, 65, 256, 256, 370);
    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(0.62, "rgba(0, 0, 0, 0.2)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.78)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, 512, 512);

    gradientTexture.update();

    const backgroundLayer = new Layer("splashBackgroundLayer", null, this.scene, true);
    backgroundLayer.texture = gradientTexture;
    backgroundLayer.isBackground = true;
  }
}
