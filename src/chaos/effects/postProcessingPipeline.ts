import type { Scene } from "@babylonjs/core/scene";
import type { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector2 } from "@babylonjs/core/Maths/math.vector";
import { Color4 } from "@babylonjs/core/Maths/math.color";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { Effect } from "@babylonjs/core/Materials/effect";
import { PostProcess } from "@babylonjs/core/PostProcesses/postProcess";
import { BlurPostProcess } from "@babylonjs/core/PostProcesses/blurPostProcess";
import { ChromaticAberrationPostProcess } from "@babylonjs/core/PostProcesses/chromaticAberrationPostProcess";
import { ImageProcessingPostProcess } from "@babylonjs/core/PostProcesses/imageProcessingPostProcess";
import { logger } from "../../utils/logger.js";

const log = logger.create("DrunkVisionPostFX");

let doubleVisionShaderRegistered = false;

export interface DrunkVisionSettings {
  blurKernel: number;
  doubleVisionOffsetPx: number;
  doubleVisionStrength: number;
  doubleVisionWobblePx: number;
  vignetteWeight: number;
  chromaticAberration: number;
}

export class DrunkVisionPostProcessingPipeline {
  private readonly scene: Scene;
  private readonly camera: Camera;

  private blurX?: BlurPostProcess;
  private blurY?: BlurPostProcess;
  private chromatic?: ChromaticAberrationPostProcess;
  private imageProcessing?: ImageProcessingPostProcess;
  private doubleVision?: PostProcess;

  private doubleVisionOffsetPx = 0;
  private doubleVisionStrength = 0;
  private doubleVisionWobblePx = 0;

  private blackoutOverlay?: HTMLDivElement;
  private blackoutFrameHandle?: number;
  private blackoutTimeoutHandle?: ReturnType<typeof setTimeout>;

  constructor(scene: Scene, camera: Camera) {
    this.scene = scene;
    this.camera = camera;
  }

  apply(settings: DrunkVisionSettings): void {
    this.enableBlur(settings.blurKernel);
    this.enableChromaticAberration(settings.chromaticAberration);
    this.enableVignette(settings.vignetteWeight);
    this.enableDoubleVision(
      settings.doubleVisionOffsetPx,
      settings.doubleVisionStrength,
      settings.doubleVisionWobblePx
    );
  }

  triggerBlackout(
    fadeInMs: number = 220,
    holdMs: number = 180,
    fadeOutMs: number = 260
  ): void {
    const overlay = this.ensureBlackoutOverlay();
    if (!overlay) return;

    this.cancelBlackoutAnimation();
    this.setBlackoutOpacity(0);

    this.animateBlackoutOpacity(0, 1, fadeInMs, () => {
      this.blackoutTimeoutHandle = setTimeout(() => {
        this.animateBlackoutOpacity(1, 0, fadeOutMs);
      }, Math.max(0, holdMs));
    });
  }

  clearAll(): void {
    this.disposeBlur();
    this.disposeChromaticAberration();
    this.disposeImageProcessing();
    this.disposeDoubleVision();
    this.cancelBlackoutAnimation();
    this.setBlackoutOpacity(0);
  }

  dispose(): void {
    this.clearAll();
    if (this.blackoutOverlay?.parentElement) {
      this.blackoutOverlay.parentElement.removeChild(this.blackoutOverlay);
    }
    this.blackoutOverlay = undefined;
  }

  private enableBlur(kernel: number): void {
    const safeKernel = Math.max(0, kernel);
    if (safeKernel <= 0.01) {
      this.disposeBlur();
      return;
    }

    if (!this.blurX || !this.blurY) {
      this.blurX = new BlurPostProcess(
        "drunkBlurX",
        new Vector2(1, 0),
        safeKernel,
        1.0,
        this.camera,
        Texture.BILINEAR_SAMPLINGMODE,
        this.scene.getEngine(),
        true
      );
      this.blurY = new BlurPostProcess(
        "drunkBlurY",
        new Vector2(0, 1),
        safeKernel,
        1.0,
        this.camera,
        Texture.BILINEAR_SAMPLINGMODE,
        this.scene.getEngine(),
        true
      );
      log.debug("Enabled blur post-processes");
    } else {
      this.blurX.kernel = safeKernel;
      this.blurY.kernel = safeKernel;
    }
  }

  private enableChromaticAberration(amount: number): void {
    const safeAmount = Math.max(0, amount);
    if (safeAmount <= 0.01) {
      this.disposeChromaticAberration();
      return;
    }

    const engine = this.scene.getEngine();
    if (!this.chromatic) {
      this.chromatic = new ChromaticAberrationPostProcess(
        "drunkChromatic",
        engine.getRenderWidth(),
        engine.getRenderHeight(),
        1.0,
        this.camera,
        Texture.BILINEAR_SAMPLINGMODE,
        engine,
        true
      );
      log.debug("Enabled chromatic aberration post-process");
    }

    this.chromatic.aberrationAmount = safeAmount;
    this.chromatic.radialIntensity = 0.9;
    this.chromatic.direction = new Vector2(0.7, 0.7);
    this.chromatic.centerPosition = new Vector2(0.5, 0.5);
    this.chromatic.screenWidth = engine.getRenderWidth();
    this.chromatic.screenHeight = engine.getRenderHeight();
  }

  private enableVignette(weight: number): void {
    const safeWeight = Math.max(0, weight);
    if (safeWeight <= 0.01) {
      this.disposeImageProcessing();
      return;
    }

    if (!this.imageProcessing) {
      this.imageProcessing = new ImageProcessingPostProcess(
        "drunkImageProcessing",
        1.0,
        this.camera,
        Texture.BILINEAR_SAMPLINGMODE,
        this.scene.getEngine(),
        true
      );
      log.debug("Enabled image processing post-process");
    }

    this.imageProcessing.vignetteEnabled = true;
    this.imageProcessing.vignetteWeight = safeWeight;
    this.imageProcessing.vignetteStretch = 0;
    this.imageProcessing.vignetteColor = new Color4(0, 0, 0, 1);
    this.imageProcessing.vignetteBlendMode = 0;
  }

  private enableDoubleVision(
    offsetPx: number,
    strength: number,
    wobblePx: number
  ): void {
    const safeStrength = Math.max(0, Math.min(1, strength));
    if (safeStrength <= 0.01 || Math.abs(offsetPx) <= 0.01) {
      this.disposeDoubleVision();
      return;
    }

    this.doubleVisionOffsetPx = offsetPx;
    this.doubleVisionStrength = safeStrength;
    this.doubleVisionWobblePx = Math.max(0, wobblePx);

    if (!this.doubleVision) {
      this.registerDoubleVisionShader();
      this.doubleVision = new PostProcess(
        "drunkDoubleVision",
        "drunkDoubleVision",
        ["offset", "ghostStrength"],
        [],
        1.0,
        this.camera,
        Texture.BILINEAR_SAMPLINGMODE,
        this.scene.getEngine(),
        true
      );
      this.doubleVision.onApply = (effect) => {
        const engine = this.scene.getEngine();
        const width = Math.max(1, engine.getRenderWidth());
        const height = Math.max(1, engine.getRenderHeight());
        const t = this.now() * 0.001;
        const wobble = this.doubleVisionWobblePx * Math.sin(t * 3.2);
        const offsetX = (this.doubleVisionOffsetPx + wobble) / width;
        const offsetY = (wobble * 0.35) / height;

        effect.setFloat2("offset", offsetX, offsetY);
        effect.setFloat("ghostStrength", this.doubleVisionStrength);
      };
      log.debug("Enabled double-vision post-process");
    }
  }

  private disposeBlur(): void {
    if (this.blurX) {
      this.blurX.dispose(this.camera);
      this.blurX = undefined;
    }
    if (this.blurY) {
      this.blurY.dispose(this.camera);
      this.blurY = undefined;
    }
  }

  private disposeChromaticAberration(): void {
    if (!this.chromatic) return;
    this.chromatic.dispose(this.camera);
    this.chromatic = undefined;
  }

  private disposeImageProcessing(): void {
    if (!this.imageProcessing) return;
    this.imageProcessing.dispose(this.camera);
    this.imageProcessing = undefined;
  }

  private disposeDoubleVision(): void {
    if (!this.doubleVision) return;
    this.doubleVision.dispose(this.camera);
    this.doubleVision = undefined;
  }

  private ensureBlackoutOverlay(): HTMLDivElement | null {
    if (typeof document === "undefined") return null;

    if (this.blackoutOverlay) {
      return this.blackoutOverlay;
    }

    const host =
      (document.getElementById("app") as HTMLElement | null) ??
      document.body ??
      null;
    if (!host) return null;

    const overlay = document.createElement("div");
    overlay.setAttribute("data-role", "drunk-blackout-overlay");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.pointerEvents = "none";
    overlay.style.background = "#000";
    overlay.style.opacity = "0";
    overlay.style.zIndex = "999";
    host.appendChild(overlay);

    this.blackoutOverlay = overlay;
    return overlay;
  }

  private cancelBlackoutAnimation(): void {
    if (this.blackoutFrameHandle !== undefined) {
      this.cancelFrame(this.blackoutFrameHandle);
      this.blackoutFrameHandle = undefined;
    }
    if (this.blackoutTimeoutHandle) {
      clearTimeout(this.blackoutTimeoutHandle);
      this.blackoutTimeoutHandle = undefined;
    }
  }

  private animateBlackoutOpacity(
    from: number,
    to: number,
    durationMs: number,
    onComplete?: () => void
  ): void {
    const overlay = this.ensureBlackoutOverlay();
    if (!overlay) return;

    const start = this.now();
    const total = Math.max(1, durationMs);

    const tick = () => {
      const elapsed = this.now() - start;
      const progress = Math.min(elapsed / total, 1);
      const eased = progress < 0.5
        ? 2 * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 2) / 2;
      const opacity = from + (to - from) * eased;
      this.setBlackoutOpacity(opacity);

      if (progress >= 1) {
        this.blackoutFrameHandle = undefined;
        onComplete?.();
        return;
      }

      this.blackoutFrameHandle = this.scheduleFrame(tick);
    };

    this.blackoutFrameHandle = this.scheduleFrame(tick);
  }

  private setBlackoutOpacity(opacity: number): void {
    if (!this.blackoutOverlay) return;
    this.blackoutOverlay.style.opacity = String(Math.max(0, Math.min(1, opacity)));
  }

  private registerDoubleVisionShader(): void {
    if (doubleVisionShaderRegistered) return;

    Effect.ShadersStore["drunkDoubleVisionFragmentShader"] = `
      precision highp float;
      varying vec2 vUV;
      uniform sampler2D textureSampler;
      uniform vec2 offset;
      uniform float ghostStrength;

      void main(void) {
        vec2 ghostUv = clamp(vUV + offset, vec2(0.0), vec2(1.0));
        vec4 baseColor = texture2D(textureSampler, vUV);
        vec4 ghostColor = texture2D(textureSampler, ghostUv);
        gl_FragColor = mix(baseColor, ghostColor, ghostStrength);
      }
    `;

    doubleVisionShaderRegistered = true;
  }

  private scheduleFrame(callback: () => void): number {
    if (typeof requestAnimationFrame === "function") {
      return requestAnimationFrame(callback);
    }
    return setTimeout(callback, 16) as unknown as number;
  }

  private cancelFrame(frameHandle: number): void {
    if (typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(frameHandle);
      return;
    }
    clearTimeout(frameHandle as unknown as ReturnType<typeof setTimeout>);
  }

  private now(): number {
    if (typeof performance !== "undefined" && typeof performance.now === "function") {
      return performance.now();
    }
    return Date.now();
  }
}
