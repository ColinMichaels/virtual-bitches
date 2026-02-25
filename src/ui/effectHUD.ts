import type { CameraEffect, CameraEffectType } from "../services/cameraEffects.js";

interface CameraEffectsReadable {
  getActiveEffects(): CameraEffect[];
  getQueuedEffectCount(): number;
}

interface EffectHUDOptions {
  refreshMs?: number;
  maxVisibleEffects?: number;
}

const DEFAULT_REFRESH_MS = 120;
const DEFAULT_MAX_VISIBLE_EFFECTS = 4;

const EFFECT_ICON_BY_TYPE: Record<CameraEffectType, string> = {
  shake: "SHK",
  spin: "SPN",
  zoom: "ZOM",
  drunk: "DRK",
};

const EFFECT_LABEL_BY_TYPE: Record<CameraEffectType, string> = {
  shake: "Screen Shake",
  spin: "Spin",
  zoom: "Zoom Warp",
  drunk: "Drunk Vision",
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class EffectHUD {
  private readonly cameraEffects: CameraEffectsReadable;
  private readonly root: HTMLElement;
  private readonly contentEl: HTMLElement;
  private readonly refreshMs: number;
  private readonly maxVisibleEffects: number;
  private intervalHandle?: ReturnType<typeof setInterval>;

  constructor(cameraEffects: CameraEffectsReadable, options: EffectHUDOptions = {}) {
    this.cameraEffects = cameraEffects;
    this.refreshMs = options.refreshMs ?? DEFAULT_REFRESH_MS;
    this.maxVisibleEffects = options.maxVisibleEffects ?? DEFAULT_MAX_VISIBLE_EFFECTS;
    this.root = this.ensureRoot();
    this.contentEl = this.ensureContentElement(this.root);
    this.render();
  }

  start(): void {
    if (this.intervalHandle) return;
    this.render();
    this.intervalHandle = setInterval(() => this.render(), this.refreshMs);
  }

  stop(): void {
    if (!this.intervalHandle) return;
    clearInterval(this.intervalHandle);
    this.intervalHandle = undefined;
  }

  private ensureRoot(): HTMLElement {
    const existing = document.getElementById("effect-hud");
    if (existing) {
      return existing;
    }

    const host = document.getElementById("app") ?? document.body;
    const root = document.createElement("div");
    root.id = "effect-hud";
    host.appendChild(root);
    return root;
  }

  private ensureContentElement(root: HTMLElement): HTMLElement {
    const existing = root.querySelector(".effect-hud__content") as HTMLElement | null;
    if (existing) {
      return existing;
    }

    const content = document.createElement("div");
    content.className = "effect-hud__content";
    root.appendChild(content);
    return content;
  }

  private render(): void {
    const now = Date.now();
    const activeEffects = this.cameraEffects
      .getActiveEffects()
      .slice()
      .sort((a, b) => a.startTime - b.startTime);
    const queuedCount = this.cameraEffects.getQueuedEffectCount();

    if (activeEffects.length === 0 && queuedCount === 0) {
      this.root.classList.add("is-hidden");
      this.contentEl.innerHTML = "";
      return;
    }

    this.root.classList.remove("is-hidden");
    const visibleEffects = activeEffects.slice(0, this.maxVisibleEffects);
    const cardsHtml = visibleEffects
      .map((effect) => this.renderEffectCard(effect, now))
      .join("");

    const overflowCount = Math.max(0, activeEffects.length - visibleEffects.length);
    const queueBadge = queuedCount > 0
      ? `<div class="effect-hud__queue">Queued: ${queuedCount}</div>`
      : "";
    const overflowBadge = overflowCount > 0
      ? `<div class="effect-hud__queue">+${overflowCount} more active</div>`
      : "";

    this.contentEl.innerHTML = `
      <div class="effect-hud__header">
        <span class="effect-hud__title">Camera Effects</span>
        ${queueBadge}
        ${overflowBadge}
      </div>
      <div class="effect-hud__list">
        ${cardsHtml}
      </div>
    `;
  }

  private renderEffectCard(effect: CameraEffect, nowMs: number): string {
    const elapsedMs = Math.max(0, nowMs - effect.startTime);
    const remainingMs = Math.max(0, effect.duration - elapsedMs);
    const progress = effect.duration > 0
      ? clamp(elapsedMs / effect.duration, 0, 1)
      : 1;
    const intensityPercent = this.intensityToPercent(effect);

    return `
      <article class="effect-hud__card effect-hud__card--${effect.type}">
        <div class="effect-hud__row">
          <span class="effect-hud__icon">${EFFECT_ICON_BY_TYPE[effect.type]}</span>
          <span class="effect-hud__name">${EFFECT_LABEL_BY_TYPE[effect.type]}</span>
          <span class="effect-hud__time">${this.formatDuration(remainingMs)}</span>
        </div>
        <div class="effect-hud__meter">
          <div class="effect-hud__meter-fill" style="width:${Math.round((1 - progress) * 100)}%"></div>
        </div>
        <div class="effect-hud__meta">Intensity ${intensityPercent}%</div>
      </article>
    `;
  }

  private intensityToPercent(effect: CameraEffect): number {
    switch (effect.type) {
      case "shake":
        return Math.round(clamp((effect.intensity / 2) * 100, 0, 100));
      case "spin":
        return Math.round(clamp((effect.intensity / 8) * 100, 0, 100));
      case "zoom":
        return Math.round(clamp((effect.intensity / 20) * 100, 0, 100));
      case "drunk":
        return Math.round(clamp((effect.intensity / 1.2) * 100, 0, 100));
      default:
        return 0;
    }
  }

  private formatDuration(durationMs: number): string {
    const seconds = durationMs / 1000;
    return `${seconds.toFixed(1)}s`;
  }
}
