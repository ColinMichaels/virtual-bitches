/**
 * Player seat visualization system for octagon table.
 */

import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  DynamicTexture,
  ActionManager,
  ExecuteCodeAction,
} from "@babylonjs/core";
import { PlayerSeat } from "./octagonGeometry.js";

const SCORE_ZONE_DISTANCE_FACTOR = 0.46;
const CHAT_BUBBLE_DEFAULT_DURATION_MS = 2400;
const CHAT_BUBBLE_MIN_DURATION_MS = 900;
const CHAT_BUBBLE_MAX_DURATION_MS = 8000;

type SeatChatBubbleTone = "info" | "success" | "warning" | "error";

export interface SeatChatBubbleOptions {
  tone?: SeatChatBubbleTone;
  durationMs?: number;
  isBot?: boolean;
}

/**
 * Player seat state.
 */
export interface SeatState {
  index: number;
  occupied: boolean;
  isCurrentPlayer: boolean;
  isBot?: boolean;
  playerName?: string;
  avatarColor?: Color3;
  score?: number;
  isComplete?: boolean;
}

/**
 * Player seat renderer for octagon table.
 */
export class PlayerSeatRenderer {
  private scene: Scene;
  private seatMeshes: Map<number, Mesh> = new Map();
  private namePlateMeshes: Map<number, Mesh> = new Map();
  private scoreBadgeMeshes: Map<number, Mesh> = new Map();
  private chatBubbleMeshes: Map<number, Mesh> = new Map();
  private scoreZoneMeshes: Map<number, Mesh> = new Map();
  private turnMarkerMeshes: Map<number, Mesh> = new Map();
  private seatStates: Map<number, SeatState> = new Map();
  private scorePulseTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private chatBubbleHideTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private highlightedSeatIndex: number | null = null;
  private onSeatClickCallback?: (seatIndex: number) => void;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Set callback for when a player seat is clicked.
   */
  onSeatClick(callback: (seatIndex: number) => void): void {
    this.onSeatClickCallback = callback;
  }

  /**
   * Create all 8 player seats around the octagon table.
   */
  createPlayerSeats(seats: PlayerSeat[], currentPlayerSeat: number = 0): void {
    seats.forEach((seat) => {
      this.createSeatAvatar(seat);
      this.createNamePlate(seat);
      this.createScoreBadge(seat);
      this.createChatBubble(seat);
      this.createScoredZone(seat);
      this.createTurnMarker(seat);

      const isCurrentPlayer = seat.index === currentPlayerSeat;
      this.updateSeat(seat.index, {
        index: seat.index,
        occupied: isCurrentPlayer,
        isCurrentPlayer,
        playerName: isCurrentPlayer ? `YOU (Seat ${seat.index + 1})` : "Empty",
        score: 0,
        isComplete: false,
      });
    });
  }

  /**
   * Create avatar geometry for one seat.
   */
  private createSeatAvatar(seat: PlayerSeat): void {
    const pedestal = MeshBuilder.CreateCylinder(
      `seat-pedestal-${seat.index}`,
      { height: 0.5, diameter: 1.5 },
      this.scene
    );
    pedestal.position = seat.position.clone();
    pedestal.position.y -= 0.5;

    const avatar = MeshBuilder.CreateCylinder(
      `seat-avatar-${seat.index}`,
      { height: 2.5, diameterTop: 0.8, diameterBottom: 1.2 },
      this.scene
    );
    avatar.position = new Vector3(0, 1.5, 0);
    avatar.parent = pedestal;

    const head = MeshBuilder.CreateSphere(
      `seat-head-${seat.index}`,
      { diameter: 1.0 },
      this.scene
    );
    head.position = new Vector3(0, 3.0, 0);
    head.parent = pedestal;

    const pedestalMat = new StandardMaterial(`pedestal-mat-${seat.index}`, this.scene);
    const avatarMat = new StandardMaterial(`avatar-mat-${seat.index}`, this.scene);
    const headMat = new StandardMaterial(`head-mat-${seat.index}`, this.scene);
    pedestal.material = pedestalMat;
    avatar.material = avatarMat;
    head.material = headMat;

    this.addClickInteraction(pedestal, seat.index);
    this.addClickInteraction(avatar, seat.index);
    this.addClickInteraction(head, seat.index);

    pedestal.rotation.y = seat.angle + Math.PI;
    this.seatMeshes.set(seat.index, pedestal);
  }

  /**
   * Add click interaction to a mesh.
   */
  private addClickInteraction(mesh: Mesh, seatIndex: number): void {
    mesh.actionManager = new ActionManager(this.scene);

    mesh.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        if (this.onSeatClickCallback) {
          this.onSeatClickCallback(seatIndex);
        }
      })
    );

    mesh.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
        const material = mesh.material as StandardMaterial;
        if (material) {
          material.emissiveColor = material.emissiveColor.add(new Color3(0.08, 0.08, 0.08));
        }
      })
    );

    mesh.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
        const state = this.seatStates.get(seatIndex);
        if (state) {
          this.applySeatVisuals(seatIndex, state);
        }
      })
    );
  }

  /**
   * Create seat name plate.
   */
  private createNamePlate(seat: PlayerSeat): void {
    const pedestal = this.seatMeshes.get(seat.index);
    const namePlate = MeshBuilder.CreatePlane(
      `nameplate-${seat.index}`,
      { width: 3, height: 0.8 },
      this.scene
    );
    namePlate.position = new Vector3(0, 4.5, 0);
    if (pedestal) {
      namePlate.parent = pedestal;
    }
    namePlate.isPickable = false;

    const texture = new DynamicTexture(
      `nameplate-texture-${seat.index}`,
      { width: 512, height: 128 },
      this.scene,
      false
    );

    const material = new StandardMaterial(`nameplate-mat-${seat.index}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.backFaceCulling = false;
    namePlate.material = material;

    this.namePlateMeshes.set(seat.index, namePlate);
  }

  /**
   * Create floating score badge above avatar head.
   */
  private createScoreBadge(seat: PlayerSeat): void {
    const pedestal = this.seatMeshes.get(seat.index);
    const badge = MeshBuilder.CreatePlane(
      `score-badge-${seat.index}`,
      { width: 2.2, height: 0.72 },
      this.scene
    );
    badge.position = new Vector3(0, 5.4, 0);
    if (pedestal) {
      badge.parent = pedestal;
    }
    badge.isPickable = false;

    const texture = new DynamicTexture(
      `score-badge-texture-${seat.index}`,
      { width: 384, height: 128 },
      this.scene,
      false
    );

    const material = new StandardMaterial(`score-badge-mat-${seat.index}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.backFaceCulling = false;
    badge.material = material;

    this.scoreBadgeMeshes.set(seat.index, badge);
  }

  /**
   * Create floating chat bubble above avatar head.
   */
  private createChatBubble(seat: PlayerSeat): void {
    const pedestal = this.seatMeshes.get(seat.index);
    const bubble = MeshBuilder.CreatePlane(
      `seat-chat-bubble-${seat.index}`,
      { width: 3.8, height: 1.35 },
      this.scene
    );
    bubble.position = new Vector3(0, 6.65, 0);
    if (pedestal) {
      bubble.parent = pedestal;
    }
    bubble.isPickable = false;
    bubble.billboardMode = Mesh.BILLBOARDMODE_ALL;
    bubble.isVisible = false;

    const texture = new DynamicTexture(
      `seat-chat-bubble-texture-${seat.index}`,
      { width: 640, height: 224 },
      this.scene,
      false
    );

    const material = new StandardMaterial(`seat-chat-bubble-mat-${seat.index}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.backFaceCulling = false;
    material.useAlphaFromDiffuseTexture = true;
    bubble.material = material;

    this.chatBubbleMeshes.set(seat.index, bubble);
  }

  /**
   * Create a scored-dice section near this seat.
   */
  private createScoredZone(seat: PlayerSeat): void {
    const radial = new Vector3(seat.position.x, 0, seat.position.z);
    if (radial.lengthSquared() < 0.0001) {
      return;
    }

    const distance = radial.length() * SCORE_ZONE_DISTANCE_FACTOR;
    radial.normalize();

    const scoredZone = MeshBuilder.CreateCylinder(
      `seat-score-zone-${seat.index}`,
      { diameter: 4.8, height: 0.08, tessellation: 28 },
      this.scene
    );
    scoredZone.position = new Vector3(radial.x * distance, -0.05, radial.z * distance);
    scoredZone.isPickable = false;

    const scoredZoneMat = new StandardMaterial(`seat-score-zone-mat-${seat.index}`, this.scene);
    scoredZone.material = scoredZoneMat;

    this.scoreZoneMeshes.set(seat.index, scoredZone);
  }

  /**
   * Get scored-zone center position for a seat.
   */
  getSeatScoreZonePosition(seatIndex: number): Vector3 | null {
    const zone = this.scoreZoneMeshes.get(seatIndex);
    if (!zone) {
      return null;
    }
    return zone.getAbsolutePosition().clone();
  }

  /**
   * Trigger a short pulse on a seat's scored zone.
   */
  pulseScoreZone(seatIndex: number): void {
    const zone = this.scoreZoneMeshes.get(seatIndex);
    const state = this.seatStates.get(seatIndex);
    if (!zone || !state) {
      return;
    }

    const existingTimer = this.scorePulseTimers.get(seatIndex);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    zone.scaling = new Vector3(1.16, 1.16, 1.16);
    const zoneMat = zone.material as StandardMaterial | null;
    if (zoneMat) {
      zoneMat.emissiveColor = zoneMat.emissiveColor.add(new Color3(0.18, 0.14, 0.06));
    }

    const timer = setTimeout(() => {
      this.scorePulseTimers.delete(seatIndex);
      this.applySeatVisuals(seatIndex, state);
    }, 260);
    this.scorePulseTimers.set(seatIndex, timer);
  }

  showSeatChatBubble(seatIndex: number, message: string, options: SeatChatBubbleOptions = {}): void {
    const bubble = this.chatBubbleMeshes.get(seatIndex);
    if (!bubble) {
      return;
    }

    const normalizedMessage = typeof message === "string" ? message.trim().replace(/\s+/g, " ") : "";
    if (!normalizedMessage) {
      this.hideSeatChatBubble(seatIndex);
      return;
    }

    const state = this.seatStates.get(seatIndex);
    const tone: SeatChatBubbleTone = options.tone ?? "info";
    const isBot = options.isBot ?? state?.isBot === true;
    this.drawChatBubble(bubble, normalizedMessage, tone, isBot);
    bubble.isVisible = true;

    const existingTimer = this.chatBubbleHideTimers.get(seatIndex);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const durationRaw = Number.isFinite(options.durationMs) ? Math.floor(options.durationMs as number) : CHAT_BUBBLE_DEFAULT_DURATION_MS;
    const durationMs = Math.max(CHAT_BUBBLE_MIN_DURATION_MS, Math.min(CHAT_BUBBLE_MAX_DURATION_MS, durationRaw));
    const hideTimer = setTimeout(() => {
      this.chatBubbleHideTimers.delete(seatIndex);
      this.hideSeatChatBubble(seatIndex);
    }, durationMs);
    this.chatBubbleHideTimers.set(seatIndex, hideTimer);
  }

  hideSeatChatBubble(seatIndex: number): void {
    const existingTimer = this.chatBubbleHideTimers.get(seatIndex);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.chatBubbleHideTimers.delete(seatIndex);
    }

    const bubble = this.chatBubbleMeshes.get(seatIndex);
    if (bubble) {
      bubble.isVisible = false;
    }
  }

  /**
   * Create a strong current-turn marker near the seat avatar.
   */
  private createTurnMarker(seat: PlayerSeat): void {
    const pedestal = this.seatMeshes.get(seat.index);
    if (!pedestal) {
      return;
    }

    const marker = MeshBuilder.CreateTorus(
      `seat-turn-marker-${seat.index}`,
      { diameter: 1.7, thickness: 0.13, tessellation: 24 },
      this.scene
    );
    marker.position = new Vector3(0, 3.95, 0);
    marker.rotation.x = Math.PI / 2;
    marker.parent = pedestal;
    marker.isPickable = false;

    const markerMat = new StandardMaterial(`seat-turn-marker-mat-${seat.index}`, this.scene);
    markerMat.diffuseColor = new Color3(0.95, 0.74, 0.3);
    markerMat.emissiveColor = new Color3(0.32, 0.22, 0.08);
    markerMat.alpha = 0.95;
    marker.material = markerMat;
    marker.isVisible = false;

    this.turnMarkerMeshes.set(seat.index, marker);
  }

  /**
   * Update a seat's state (occupied, player name, score, completion).
   */
  updateSeat(seatIndex: number, state: Partial<SeatState>): void {
    const pedestal = this.seatMeshes.get(seatIndex);
    const namePlate = this.namePlateMeshes.get(seatIndex);
    const scoreBadge = this.scoreBadgeMeshes.get(seatIndex);
    if (!pedestal || !namePlate || !scoreBadge) {
      return;
    }

    const existing = this.seatStates.get(seatIndex) ?? {
      index: seatIndex,
      occupied: false,
      isCurrentPlayer: false,
      isBot: false,
      playerName: "Empty",
      score: 0,
      isComplete: false,
    };

    const merged: SeatState = {
      ...existing,
      ...state,
      index: seatIndex,
    };

    if (merged.isCurrentPlayer) {
      merged.occupied = true;
    }
    if (!Number.isFinite(merged.score) || (merged.score as number) < 0) {
      merged.score = 0;
    }
    merged.score = Math.floor(merged.score ?? 0);
    merged.isComplete = merged.isComplete === true;

    this.seatStates.set(seatIndex, merged);
    this.applySeatVisuals(seatIndex, merged);
  }

  /**
   * Apply seat visuals from current state.
   */
  private applySeatVisuals(seatIndex: number, state: SeatState): void {
    const pedestal = this.seatMeshes.get(seatIndex);
    const namePlate = this.namePlateMeshes.get(seatIndex);
    const scoreBadge = this.scoreBadgeMeshes.get(seatIndex);
    const scoreZone = this.scoreZoneMeshes.get(seatIndex);
    const turnMarker = this.turnMarkerMeshes.get(seatIndex);
    if (!pedestal || !namePlate || !scoreBadge || !scoreZone) {
      return;
    }

    const childMeshes = pedestal.getChildMeshes();
    const avatarMesh = childMeshes[0] as Mesh | undefined;
    const headMesh = childMeshes[1] as Mesh | undefined;
    if (!avatarMesh || !headMesh) {
      return;
    }

    const avatarMat = avatarMesh.material as StandardMaterial;
    const headMat = headMesh.material as StandardMaterial;
    const pedestalMat = pedestal.material as StandardMaterial;
    const scoreZoneMat = scoreZone.material as StandardMaterial;

    const isCurrentPlayer = state.isCurrentPlayer === true;
    const isOccupied = state.occupied === true || isCurrentPlayer;
    const isBot = state.isBot === true;
    const isComplete = state.isComplete === true;

    pedestal.scaling = new Vector3(1, 1, 1);
    scoreZone.scaling = new Vector3(1, 1, 1);
    namePlate.scaling = new Vector3(1, 1, 1);
    if (turnMarker) {
      turnMarker.isVisible = false;
    }

    if (isCurrentPlayer) {
      const color = state.avatarColor || new Color3(0.24, 0.84, 0.36);
      pedestalMat.diffuseColor = new Color3(0.2, 0.8, 0.3);
      pedestalMat.emissiveColor = new Color3(0.1, 0.38, 0.15);
      pedestalMat.alpha = 1;
      avatarMat.diffuseColor = color;
      avatarMat.emissiveColor = color.scale(0.3);
      headMat.diffuseColor = new Color3(0.9, 0.7, 0.5);
      avatarMat.alpha = 1;
      headMat.alpha = 1;
    } else if (isOccupied) {
      const color =
        state.avatarColor || (isBot ? new Color3(0.84, 0.52, 0.24) : new Color3(0.4, 0.62, 0.9));
      pedestalMat.diffuseColor = isBot ? new Color3(0.44, 0.3, 0.2) : new Color3(0.24, 0.3, 0.42);
      pedestalMat.emissiveColor = new Color3(0.05, 0.05, 0.08);
      pedestalMat.alpha = 1;
      avatarMat.diffuseColor = color;
      avatarMat.emissiveColor = color.scale(0.24);
      headMat.diffuseColor = isBot ? new Color3(0.76, 0.62, 0.52) : new Color3(0.9, 0.7, 0.5);
      avatarMat.alpha = 1;
      headMat.alpha = 1;
    } else {
      pedestalMat.diffuseColor = new Color3(0.15, 0.15, 0.17);
      pedestalMat.emissiveColor = new Color3(0, 0, 0);
      pedestalMat.alpha = 0.5;
      avatarMat.diffuseColor = new Color3(0.2, 0.2, 0.22);
      avatarMat.emissiveColor = new Color3(0, 0, 0);
      headMat.diffuseColor = new Color3(0.5, 0.5, 0.55);
      avatarMat.alpha = 0.5;
      headMat.alpha = 0.5;
    }

    if (isComplete && isOccupied) {
      pedestalMat.diffuseColor = new Color3(0.36, 0.31, 0.18);
      pedestalMat.emissiveColor = new Color3(0.1, 0.08, 0.03);
    }

    if (isComplete && isOccupied) {
      scoreZoneMat.diffuseColor = new Color3(0.43, 0.33, 0.13);
      scoreZoneMat.emissiveColor = new Color3(0.06, 0.04, 0.01);
      scoreZoneMat.alpha = 0.88;
    } else if (isCurrentPlayer) {
      scoreZoneMat.diffuseColor = new Color3(0.16, 0.48, 0.26);
      scoreZoneMat.emissiveColor = new Color3(0.03, 0.08, 0.04);
      scoreZoneMat.alpha = 0.84;
    } else if (isOccupied && isBot) {
      scoreZoneMat.diffuseColor = new Color3(0.46, 0.3, 0.18);
      scoreZoneMat.emissiveColor = new Color3(0.06, 0.04, 0.03);
      scoreZoneMat.alpha = 0.8;
    } else if (isOccupied) {
      scoreZoneMat.diffuseColor = new Color3(0.2, 0.34, 0.54);
      scoreZoneMat.emissiveColor = new Color3(0.03, 0.05, 0.08);
      scoreZoneMat.alpha = 0.8;
    } else {
      scoreZoneMat.diffuseColor = new Color3(0.11, 0.11, 0.13);
      scoreZoneMat.emissiveColor = new Color3(0, 0, 0);
      scoreZoneMat.alpha = 0.36;
    }

    this.drawNamePlate(namePlate, seatIndex, state, isOccupied, isCurrentPlayer, isBot, isComplete);
    this.drawScoreBadge(scoreBadge, state, isOccupied, isCurrentPlayer, isBot, isComplete);

    if (this.highlightedSeatIndex === seatIndex) {
      pedestal.scaling = new Vector3(1.1, 1.1, 1.1);
      scoreZone.scaling = new Vector3(1.05, 1.05, 1.05);
      namePlate.scaling = new Vector3(1.03, 1.03, 1.03);
      pedestalMat.emissiveColor = pedestalMat.emissiveColor.add(new Color3(0.14, 0.18, 0.07));
      scoreZoneMat.emissiveColor = scoreZoneMat.emissiveColor.add(new Color3(0.1, 0.08, 0.03));
      if (turnMarker) {
        turnMarker.isVisible = true;
      }
    }

    if (!isOccupied) {
      this.hideSeatChatBubble(seatIndex);
    }
  }

  private drawNamePlate(
    namePlate: Mesh,
    seatIndex: number,
    state: SeatState,
    isOccupied: boolean,
    isCurrentPlayer: boolean,
    isBot: boolean,
    isComplete: boolean
  ): void {
    const texture = (namePlate.material as StandardMaterial).diffuseTexture as DynamicTexture;
    const material = namePlate.material as StandardMaterial;
    if (!texture || !material) {
      return;
    }

    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const nameText =
      typeof state.playerName === "string" && state.playerName.trim().length > 0
        ? state.playerName.trim().slice(0, 20)
        : isCurrentPlayer
          ? "YOU"
          : isOccupied
            ? `Seat ${seatIndex + 1}`
            : "Empty";

    ctx.clearRect(0, 0, 512, 128);

    if (!isOccupied && !isCurrentPlayer) {
      ctx.fillStyle = "#2a2a2c";
    } else if (isComplete) {
      ctx.fillStyle = "#7b6322";
    } else if (isCurrentPlayer) {
      ctx.fillStyle = "#2a8f3a";
    } else if (isBot) {
      ctx.fillStyle = "#7a4f2a";
    } else {
      ctx.fillStyle = "#4a5a7a";
    }
    ctx.fillRect(0, 0, 512, 128);

    ctx.fillStyle = isOccupied || isCurrentPlayer ? "#ffffff" : "#666666";
    ctx.font = "bold 48px Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(nameText, 256, 64);
    texture.update();

    material.alpha = isOccupied || isCurrentPlayer ? 1.0 : 0.45;
  }

  private drawScoreBadge(
    scoreBadge: Mesh,
    state: SeatState,
    isOccupied: boolean,
    isCurrentPlayer: boolean,
    isBot: boolean,
    isComplete: boolean
  ): void {
    const texture = (scoreBadge.material as StandardMaterial).diffuseTexture as DynamicTexture;
    const material = scoreBadge.material as StandardMaterial;
    if (!texture || !material) {
      return;
    }

    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const scoreValue = Number.isFinite(state.score) ? Math.max(0, Math.floor(state.score as number)) : 0;

    ctx.clearRect(0, 0, 384, 128);

    if (!isOccupied && !isCurrentPlayer) {
      ctx.fillStyle = "#252529";
    } else if (isComplete) {
      ctx.fillStyle = "#7f6222";
    } else if (isCurrentPlayer) {
      ctx.fillStyle = "#2f8851";
    } else if (isBot) {
      ctx.fillStyle = "#815132";
    } else {
      ctx.fillStyle = "#3f5c88";
    }
    ctx.fillRect(0, 0, 384, 128);

    ctx.fillStyle = isOccupied || isCurrentPlayer ? "#ffffff" : "#8b8b90";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (isComplete) {
      ctx.font = "bold 42px Arial";
      ctx.fillText(`DONE ${scoreValue}`, 192, 66);
    } else {
      ctx.font = "bold 40px Arial";
      ctx.fillText(`${scoreValue}`, 192, 58);
      ctx.font = "bold 18px Arial";
      ctx.fillText("SCORE", 192, 100);
    }

    texture.update();
    material.alpha = isOccupied || isCurrentPlayer ? 0.95 : 0.32;
  }

  private drawChatBubble(
    bubble: Mesh,
    message: string,
    tone: SeatChatBubbleTone,
    isBot: boolean
  ): void {
    const texture = (bubble.material as StandardMaterial).diffuseTexture as DynamicTexture;
    if (!texture) {
      return;
    }

    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const width = 640;
    const height = 224;
    const palette = this.resolveChatBubblePalette(tone, isBot);

    ctx.clearRect(0, 0, width, height);

    this.drawRoundedRect(ctx, 18, 14, width - 36, 156, 20);
    ctx.fillStyle = palette.fill;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = palette.stroke;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(width / 2 - 24, 168);
    ctx.lineTo(width / 2 + 24, 168);
    ctx.lineTo(width / 2, 208);
    ctx.closePath();
    ctx.fillStyle = palette.fill;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = palette.stroke;
    ctx.stroke();

    const lines = this.wrapChatBubbleText(message, 2, 31);
    ctx.fillStyle = palette.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 36px Arial";
    lines.forEach((line, lineIndex) => {
      const y = lines.length > 1 ? 74 + lineIndex * 44 : 86;
      ctx.fillText(line, width / 2, y);
    });

    texture.update();
  }

  private wrapChatBubbleText(text: string, maxLines: number, maxCharsPerLine: number): string[] {
    const words = text.trim().split(/\s+/);
    if (words.length === 0) {
      return [""];
    }

    const lines: string[] = [];
    let currentLine = "";

    words.forEach((word) => {
      const candidate = currentLine ? `${currentLine} ${word}` : word;
      if (candidate.length <= maxCharsPerLine || !currentLine) {
        currentLine = candidate;
        return;
      }
      lines.push(currentLine);
      currentLine = word;
    });

    if (currentLine) {
      lines.push(currentLine);
    }

    if (lines.length <= maxLines) {
      return lines;
    }

    const capped = lines.slice(0, maxLines);
    const overflow = lines.slice(maxLines - 1).join(" ");
    const trimmedOverflow =
      overflow.length > maxCharsPerLine
        ? `${overflow.slice(0, maxCharsPerLine - 3).trim()}...`
        : overflow;
    capped[maxLines - 1] = trimmedOverflow;
    return capped;
  }

  private resolveChatBubblePalette(
    tone: SeatChatBubbleTone,
    isBot: boolean
  ): { fill: string; stroke: string; text: string } {
    if (tone === "error") {
      return { fill: "#822c2c", stroke: "#eaa8a8", text: "#ffffff" };
    }
    if (tone === "warning") {
      return { fill: "#7d5921", stroke: "#f3d188", text: "#ffffff" };
    }
    if (tone === "success") {
      return { fill: "#246f3b", stroke: "#a9f0c0", text: "#ffffff" };
    }
    if (isBot) {
      return { fill: "#6a4023", stroke: "#e3b88f", text: "#ffffff" };
    }
    return { fill: "#2f4f76", stroke: "#a8c8f0", text: "#ffffff" };
  }

  private drawRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number
  ): void {
    const r = Math.max(2, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + width - r, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r);
    ctx.lineTo(x + width, y + height - r);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
    ctx.lineTo(x + r, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /**
   * Highlight current player's seat with stronger marker/effect.
   */
  highlightSeat(seatIndex: number): void {
    this.clearHighlights();
    this.highlightedSeatIndex = seatIndex;
    const state = this.seatStates.get(seatIndex);
    if (state) {
      this.applySeatVisuals(seatIndex, state);
    }
  }

  /**
   * Remove highlight from all seats.
   */
  clearHighlights(): void {
    this.highlightedSeatIndex = null;
    this.seatStates.forEach((state, seatIndex) => {
      this.applySeatVisuals(seatIndex, state);
    });
  }

  /**
   * Dispose all seat meshes.
   */
  dispose(): void {
    this.scorePulseTimers.forEach((timer) => clearTimeout(timer));
    this.chatBubbleHideTimers.forEach((timer) => clearTimeout(timer));
    this.seatMeshes.forEach((mesh) => mesh.dispose());
    this.namePlateMeshes.forEach((mesh) => mesh.dispose());
    this.scoreBadgeMeshes.forEach((mesh) => mesh.dispose());
    this.chatBubbleMeshes.forEach((mesh) => mesh.dispose());
    this.scoreZoneMeshes.forEach((mesh) => mesh.dispose());
    this.turnMarkerMeshes.forEach((mesh) => mesh.dispose());
    this.seatMeshes.clear();
    this.namePlateMeshes.clear();
    this.scoreBadgeMeshes.clear();
    this.chatBubbleMeshes.clear();
    this.scoreZoneMeshes.clear();
    this.turnMarkerMeshes.clear();
    this.scorePulseTimers.clear();
    this.chatBubbleHideTimers.clear();
    this.seatStates.clear();
  }
}
