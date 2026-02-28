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
  Texture,
} from "@babylonjs/core";
import { PlayerSeat } from "./octagonGeometry.js";

const SCORE_ZONE_DISTANCE_FACTOR = 0.46;
const CHAT_BUBBLE_DEFAULT_DURATION_MS = 2400;
const CHAT_BUBBLE_MIN_DURATION_MS = 900;
const CHAT_BUBBLE_MAX_DURATION_MS = 10000;
const AVATAR_PANEL_SIZE = 1.92;
const AVATAR_PANEL_HEIGHT = 2.36;
const AVATAR_HEAD_ANCHOR_OFFSET = 0.96;
const TURN_MARKER_BASE_HEIGHT = 4.52;
const ACTIVE_SEAT_FLOAT_AMPLITUDE = 0.16;
const ACTIVE_SEAT_FLOAT_SPEED = 0.0048;
const ACTIVE_SEAT_PULSE_SPEED = 0.0072;
const ACTIVE_SEAT_SURGE_SPEED = 0.0106;
const AVATAR_TEXTURE_RETRY_BASE_MS = 20000;
const AVATAR_TEXTURE_RETRY_MAX_MS = 5 * 60 * 1000;
const LOUNGE_OFFSET_DISTANCE = 3.2;

type SeatChatBubbleTone = "info" | "success" | "warning" | "error";

export interface SeatChatBubbleOptions {
  tone?: SeatChatBubbleTone;
  durationMs?: number;
  isBot?: boolean;
}

interface SeatChatBubbleVisual {
  root: Mesh;
  textTexture: DynamicTexture;
}

interface SeatAvatarTextureState {
  url?: string;
  texture: Texture | null;
}

interface AvatarTextureFailureState {
  failures: number;
  nextRetryAt: number;
}

/**
 * Player seat state.
 */
export interface SeatState {
  index: number;
  occupied: boolean;
  isCurrentPlayer: boolean;
  isInLounge?: boolean;
  isBot?: boolean;
  playerName?: string;
  avatarUrl?: string;
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
  private seatBasePositions: Map<number, Vector3> = new Map();
  private seatAvatarMeshes: Map<number, Mesh> = new Map();
  private seatHeadMeshes: Map<number, Mesh> = new Map();
  private namePlateMeshes: Map<number, Mesh> = new Map();
  private scoreBadgeMeshes: Map<number, Mesh> = new Map();
  private chatBubbleMeshes: Map<number, SeatChatBubbleVisual> = new Map();
  private scoreZoneMeshes: Map<number, Mesh> = new Map();
  private turnMarkerMeshes: Map<number, Mesh> = new Map();
  private seatStates: Map<number, SeatState> = new Map();
  private seatAvatarTextures: Map<number, SeatAvatarTextureState> = new Map();
  private avatarTextureFailuresByUrl: Map<string, AvatarTextureFailureState> = new Map();
  private scorePulseTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private chatBubbleHideTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private highlightedSeatIndex: number | null = null;
  private activeTurnSeatIndex: number | null = null;
  private readonly turnMarkerAnimator: () => void;
  private onSeatClickCallback?: (seatIndex: number) => void;

  constructor(scene: Scene) {
    this.scene = scene;
    this.turnMarkerAnimator = () => {
      this.animateActiveTurnMarker();
    };
    this.scene.registerBeforeRender(this.turnMarkerAnimator);
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
    this.setActiveTurnSeat(currentPlayerSeat);
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

    const avatar = MeshBuilder.CreatePlane(
      `seat-avatar-${seat.index}`,
      { width: AVATAR_PANEL_SIZE, height: AVATAR_PANEL_SIZE },
      this.scene
    );
    avatar.position = new Vector3(0, AVATAR_PANEL_HEIGHT, 0);
    avatar.billboardMode = Mesh.BILLBOARDMODE_Y;
    avatar.parent = pedestal;

    const pedestalMat = new StandardMaterial(`pedestal-mat-${seat.index}`, this.scene);
    const avatarMat = new StandardMaterial(`avatar-mat-${seat.index}`, this.scene);
    avatarMat.backFaceCulling = true; // Show profile image on front face only.
    pedestal.material = pedestalMat;
    avatar.material = avatarMat;

    this.addClickInteraction(pedestal, seat.index);
    this.addClickInteraction(avatar, seat.index);

    pedestal.rotation.y = seat.angle + Math.PI;
    this.seatMeshes.set(seat.index, pedestal);
    this.seatBasePositions.set(seat.index, pedestal.position.clone());
    this.seatAvatarMeshes.set(seat.index, avatar);
    this.seatHeadMeshes.set(seat.index, avatar);
    this.seatAvatarTextures.set(seat.index, { url: undefined, texture: null });
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
      { width: 3.8, height: 1.25 },
      this.scene
    );
    bubble.position = new Vector3(0, 5.92, 0);
    if (pedestal) {
      bubble.parent = pedestal;
    }
    bubble.isPickable = false;
    bubble.billboardMode = Mesh.BILLBOARDMODE_ALL;
    bubble.isVisible = false;

    const texture = new DynamicTexture(
      `seat-chat-bubble-texture-${seat.index}`,
      { width: 768, height: 256 },
      this.scene,
      false
    );
    const material = new StandardMaterial(`seat-chat-bubble-mat-${seat.index}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.backFaceCulling = false;
    material.useAlphaFromDiffuseTexture = true;
    bubble.material = material;

    this.chatBubbleMeshes.set(seat.index, {
      root: bubble,
      textTexture: texture,
    });
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
   * Get avatar head anchor for this seat.
   * Used by particles and callouts that should originate from player avatars.
   */
  getSeatHeadAnchorPosition(seatIndex: number): Vector3 | null {
    const head = this.seatHeadMeshes.get(seatIndex);
    if (!head) {
      return null;
    }
    const headPosition = head.getAbsolutePosition();
    return new Vector3(headPosition.x, headPosition.y + AVATAR_HEAD_ANCHOR_OFFSET, headPosition.z);
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
    const bubbleVisual = this.chatBubbleMeshes.get(seatIndex);
    if (!bubbleVisual) {
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
    this.drawChatBubble(bubbleVisual, normalizedMessage, tone, isBot);
    bubbleVisual.root.isVisible = true;

    const existingTimer = this.chatBubbleHideTimers.get(seatIndex);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const durationRaw = Number.isFinite(options.durationMs)
      ? Math.floor(options.durationMs as number)
      : CHAT_BUBBLE_DEFAULT_DURATION_MS;
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

    const bubbleVisual = this.chatBubbleMeshes.get(seatIndex);
    if (bubbleVisual) {
      bubbleVisual.root.isVisible = false;
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

    const marker = MeshBuilder.CreateSphere(
      `seat-turn-marker-${seat.index}`,
      { diameter: 0.92, segments: 20 },
      this.scene
    );
    marker.position = new Vector3(0, TURN_MARKER_BASE_HEIGHT, 0);
    marker.parent = pedestal;
    marker.isPickable = false;

    const markerMat = new StandardMaterial(`seat-turn-marker-mat-${seat.index}`, this.scene);
    markerMat.diffuseColor = new Color3(0.34, 1.0, 0.5);
    markerMat.emissiveColor = new Color3(0.2, 0.76, 0.32);
    markerMat.specularColor = new Color3(0.2, 0.35, 0.2);
    markerMat.alpha = 0.58;
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
      avatarUrl: undefined,
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
    if (merged.occupied !== true) {
      merged.isInLounge = false;
    }
    if (!Number.isFinite(merged.score) || (merged.score as number) < 0) {
      merged.score = 0;
    }
    merged.avatarUrl =
      typeof merged.avatarUrl === "string" && merged.avatarUrl.trim().length > 0
        ? merged.avatarUrl.trim()
        : undefined;
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

    const avatarMesh = this.seatAvatarMeshes.get(seatIndex);
    const headMesh = this.seatHeadMeshes.get(seatIndex);
    if (!avatarMesh || !headMesh) {
      return;
    }

    const avatarMat = avatarMesh.material as StandardMaterial;
    const headMat = headMesh.material as StandardMaterial;
    const pedestalMat = pedestal.material as StandardMaterial;
    const scoreZoneMat = scoreZone.material as StandardMaterial;
    const basePosition = this.seatBasePositions.get(seatIndex);

    const isCurrentPlayer = state.isCurrentPlayer === true;
    const isOccupied = state.occupied === true || isCurrentPlayer;
    const isInLounge = state.isInLounge === true && isOccupied;
    const isBot = state.isBot === true;
    const isComplete = state.isComplete === true;
    const hasAvatarTexture = this.applySeatAvatarTexture(
      seatIndex,
      headMat,
      isOccupied ? state.avatarUrl : undefined
    );

    pedestal.scaling = new Vector3(1, 1, 1);
    avatarMesh.scaling = new Vector3(1, 1, 1);
    avatarMesh.position.y = AVATAR_PANEL_HEIGHT;
    if (basePosition) {
      pedestal.position.copyFrom(basePosition);
      if (isInLounge) {
        const outward = new Vector3(basePosition.x, 0, basePosition.z);
        if (outward.lengthSquared() > 0.0001) {
          outward.normalize().scaleInPlace(LOUNGE_OFFSET_DISTANCE);
          pedestal.position.x = basePosition.x + outward.x;
          pedestal.position.z = basePosition.z + outward.z;
        }
      }
    }
    scoreZone.scaling = new Vector3(1, 1, 1);
    scoreZone.isVisible = !isInLounge;
    namePlate.scaling = new Vector3(1, 1, 1);
    namePlate.position.y = 4.5;
    scoreBadge.position.y = 5.4;
    if (turnMarker) {
      turnMarker.isVisible = false;
      turnMarker.scaling = new Vector3(1, 1, 1);
      turnMarker.position.y = TURN_MARKER_BASE_HEIGHT;
      const markerMat = turnMarker.material as StandardMaterial | null;
      if (markerMat) {
        markerMat.emissiveColor = new Color3(0.2, 0.76, 0.32);
        markerMat.alpha = 0.58;
      }
    }

    if (isCurrentPlayer && !isInLounge) {
      const color = state.avatarColor || new Color3(0.24, 0.84, 0.36);
      pedestalMat.diffuseColor = new Color3(0.2, 0.8, 0.3);
      pedestalMat.emissiveColor = new Color3(0.1, 0.38, 0.15);
      pedestalMat.alpha = 1;
      avatarMat.diffuseColor = color;
      avatarMat.emissiveColor = color.scale(0.3);
      headMat.diffuseColor = hasAvatarTexture ? new Color3(1, 1, 1) : new Color3(0.9, 0.7, 0.5);
      headMat.emissiveColor = hasAvatarTexture ? new Color3(0.06, 0.06, 0.06) : new Color3(0, 0, 0);
      avatarMat.alpha = 1;
      headMat.alpha = 1;
    } else if (isOccupied && !isInLounge) {
      const color =
        state.avatarColor || (isBot ? new Color3(0.84, 0.52, 0.24) : new Color3(0.4, 0.62, 0.9));
      pedestalMat.diffuseColor = isBot ? new Color3(0.44, 0.3, 0.2) : new Color3(0.24, 0.3, 0.42);
      pedestalMat.emissiveColor = new Color3(0.05, 0.05, 0.08);
      pedestalMat.alpha = 1;
      avatarMat.diffuseColor = color;
      avatarMat.emissiveColor = color.scale(0.24);
      headMat.diffuseColor = hasAvatarTexture
        ? new Color3(1, 1, 1)
        : isBot
          ? new Color3(0.76, 0.62, 0.52)
          : new Color3(0.9, 0.7, 0.5);
      headMat.emissiveColor = hasAvatarTexture ? new Color3(0.06, 0.06, 0.06) : new Color3(0, 0, 0);
      avatarMat.alpha = 1;
      headMat.alpha = 1;
    } else if (isInLounge) {
      const color = state.avatarColor || new Color3(0.44, 0.48, 0.56);
      pedestalMat.diffuseColor = new Color3(0.2, 0.21, 0.24);
      pedestalMat.emissiveColor = new Color3(0.02, 0.02, 0.03);
      pedestalMat.alpha = 0.8;
      avatarMat.diffuseColor = color;
      avatarMat.emissiveColor = new Color3(0.03, 0.03, 0.05);
      headMat.diffuseColor = hasAvatarTexture ? new Color3(1, 1, 1) : new Color3(0.68, 0.69, 0.74);
      headMat.emissiveColor = hasAvatarTexture ? new Color3(0.04, 0.04, 0.05) : new Color3(0, 0, 0);
      avatarMat.alpha = 0.82;
      headMat.alpha = 0.84;
    } else {
      pedestalMat.diffuseColor = new Color3(0.15, 0.15, 0.17);
      pedestalMat.emissiveColor = new Color3(0, 0, 0);
      pedestalMat.alpha = 0.5;
      avatarMat.diffuseColor = new Color3(0.2, 0.2, 0.22);
      avatarMat.emissiveColor = new Color3(0, 0, 0);
      headMat.diffuseColor = new Color3(0.5, 0.5, 0.55);
      headMat.emissiveColor = new Color3(0, 0, 0);
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
    } else if (isInLounge) {
      scoreZoneMat.diffuseColor = new Color3(0.09, 0.09, 0.11);
      scoreZoneMat.emissiveColor = new Color3(0, 0, 0);
      scoreZoneMat.alpha = 0.2;
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

    const isHighlightedSeat = this.highlightedSeatIndex === seatIndex;
    const isActiveTurnSeat = this.activeTurnSeatIndex === seatIndex && isOccupied && !isInLounge;

    if (isHighlightedSeat) {
      pedestal.scaling = new Vector3(1.1, 1.1, 1.1);
      scoreZone.scaling = new Vector3(1.05, 1.05, 1.05);
      namePlate.scaling = new Vector3(1.03, 1.03, 1.03);
      pedestalMat.emissiveColor = pedestalMat.emissiveColor.add(new Color3(0.14, 0.18, 0.07));
      scoreZoneMat.emissiveColor = scoreZoneMat.emissiveColor.add(new Color3(0.1, 0.08, 0.03));
    }

    if (isActiveTurnSeat) {
      pedestal.scaling = new Vector3(1.14, 1.14, 1.14);
      scoreZone.scaling = new Vector3(1.1, 1.1, 1.1);
      namePlate.scaling = new Vector3(1.06, 1.06, 1.06);
      pedestalMat.emissiveColor = pedestalMat.emissiveColor.add(new Color3(0.2, 0.2, 0.09));
      scoreZoneMat.emissiveColor = scoreZoneMat.emissiveColor.add(new Color3(0.14, 0.1, 0.04));
      if (turnMarker) {
        turnMarker.isVisible = true;
      }
    }

    if (!isOccupied) {
      this.hideSeatChatBubble(seatIndex);
    }

  }

  private applySeatAvatarTexture(
    seatIndex: number,
    headMaterial: StandardMaterial,
    avatarUrl: string | undefined
  ): boolean {
    const normalizedUrl =
      typeof avatarUrl === "string" && avatarUrl.trim().length > 0 ? avatarUrl.trim() : undefined;
    const existing = this.seatAvatarTextures.get(seatIndex) ?? { url: undefined, texture: null };
    if (existing.url === normalizedUrl && existing.texture) {
      headMaterial.diffuseTexture = existing.texture ?? null;
      return Boolean(existing.texture);
    }

    const now = Date.now();
    if (normalizedUrl) {
      const failureState = this.avatarTextureFailuresByUrl.get(normalizedUrl);
      if (failureState && failureState.nextRetryAt > now) {
        this.seatAvatarTextures.set(seatIndex, { url: normalizedUrl, texture: null });
        headMaterial.diffuseTexture = null;
        return false;
      }
    }

    if (existing.texture) {
      existing.texture.dispose();
    }

    if (!normalizedUrl) {
      this.seatAvatarTextures.set(seatIndex, { url: undefined, texture: null });
      headMaterial.diffuseTexture = null;
      return false;
    }

    this.seatAvatarTextures.set(seatIndex, { url: normalizedUrl, texture: null });
    let texture: Texture | null = null;
    try {
      texture = new Texture(
        normalizedUrl,
        this.scene,
        true,
        false,
        Texture.TRILINEAR_SAMPLINGMODE,
        () => {
          const latest = this.seatAvatarTextures.get(seatIndex);
          if (!latest || latest.url !== normalizedUrl) {
            texture?.dispose();
            return;
          }
          if (!texture) {
            return;
          }
          this.fitTextureToAvatarSurface(texture);
          this.avatarTextureFailuresByUrl.delete(normalizedUrl);
          headMaterial.diffuseTexture = texture;
          headMaterial.useAlphaFromDiffuseTexture = false;
        },
        () => {
          const latestFailure = this.avatarTextureFailuresByUrl.get(normalizedUrl);
          const failureCount = (latestFailure?.failures ?? 0) + 1;
          const retryDelayMs = Math.min(
            AVATAR_TEXTURE_RETRY_MAX_MS,
            AVATAR_TEXTURE_RETRY_BASE_MS * Math.max(1, failureCount)
          );
          this.avatarTextureFailuresByUrl.set(normalizedUrl, {
            failures: failureCount,
            nextRetryAt: Date.now() + retryDelayMs,
          });
          this.seatAvatarTextures.set(seatIndex, { url: normalizedUrl, texture: null });
          if (texture) {
            texture.dispose();
          }
          headMaterial.diffuseTexture = null;
        }
      );
      texture.wrapU = Texture.CLAMP_ADDRESSMODE;
      texture.wrapV = Texture.CLAMP_ADDRESSMODE;
      if (texture) {
        this.fitTextureToAvatarSurface(texture);
      }
    } catch {
      this.seatAvatarTextures.set(seatIndex, { url: undefined, texture: null });
      headMaterial.diffuseTexture = null;
      return false;
    }

    this.seatAvatarTextures.set(seatIndex, { url: normalizedUrl, texture });
    headMaterial.diffuseTexture = texture;
    headMaterial.useAlphaFromDiffuseTexture = false;
    return true;
  }

  /**
   * Fit a profile image to a square avatar panel using centered crop.
   */
  private fitTextureToAvatarSurface(texture: Texture): void {
    const textureSize = texture.getSize();
    const width = textureSize.width;
    const height = textureSize.height;
    if (!width || !height) {
      texture.uScale = 1;
      texture.vScale = 1;
      texture.uOffset = 0;
      texture.vOffset = 0;
      return;
    }

    const textureAspect = width / height;
    const targetAspect = 1; // square panel

    if (textureAspect > targetAspect) {
      texture.uScale = targetAspect / textureAspect;
      texture.vScale = 1;
    } else {
      texture.uScale = 1;
      texture.vScale = textureAspect / targetAspect;
    }
    texture.uOffset = 0.5 - texture.uScale * 0.5;
    texture.vOffset = 0.5 - texture.vScale * 0.5;
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

  setActiveTurnSeat(seatIndex: number | null): void {
    const normalizedSeat =
      typeof seatIndex === "number" && Number.isFinite(seatIndex)
        ? Math.floor(seatIndex)
        : null;
    const nextSeat =
      normalizedSeat !== null && this.seatMeshes.has(normalizedSeat) ? normalizedSeat : null;
    if (nextSeat === this.activeTurnSeatIndex) {
      return;
    }

    const previousSeat = this.activeTurnSeatIndex;
    this.activeTurnSeatIndex = nextSeat;
    if (previousSeat !== null) {
      const previousState = this.seatStates.get(previousSeat);
      if (previousState) {
        this.applySeatVisuals(previousSeat, previousState);
      }
    }
    if (nextSeat !== null) {
      const nextState = this.seatStates.get(nextSeat);
      if (nextState) {
        this.applySeatVisuals(nextSeat, nextState);
      }
    }
  }

  private animateActiveTurnMarker(): void {
    if (this.activeTurnSeatIndex === null) {
      return;
    }

    const state = this.seatStates.get(this.activeTurnSeatIndex);
    if (!state || !(state.occupied || state.isCurrentPlayer)) {
      return;
    }

    const now = Date.now();
    const pulse = (Math.sin(now * ACTIVE_SEAT_PULSE_SPEED) + 1) / 2;
    const surge = Math.max(
      0,
      Math.sin(now * ACTIVE_SEAT_SURGE_SPEED + this.activeTurnSeatIndex * 0.65)
    );
    const floatOffset =
      Math.sin(now * ACTIVE_SEAT_FLOAT_SPEED + this.activeTurnSeatIndex * 0.5) *
      ACTIVE_SEAT_FLOAT_AMPLITUDE;

    const pedestal = this.seatMeshes.get(this.activeTurnSeatIndex);
    if (pedestal) {
      const baseScale = 1.14;
      const scaleBoost = pulse * 0.06 + surge * 0.06;
      const scale = baseScale + scaleBoost;
      pedestal.scaling.set(scale, scale + scaleBoost * 0.35, scale);

      const pedestalMat = pedestal.material as StandardMaterial | null;
      if (pedestalMat) {
        const power = 0.26 + pulse * 0.22 + surge * 0.2;
        pedestalMat.emissiveColor = pedestalMat.diffuseColor.scale(power);
      }
    }

    const avatar = this.seatAvatarMeshes.get(this.activeTurnSeatIndex);
    if (avatar) {
      avatar.position.y = AVATAR_PANEL_HEIGHT + floatOffset;
      const avatarScale = 1 + pulse * 0.1 + surge * 0.08;
      avatar.scaling.set(avatarScale, avatarScale, avatarScale);

      const avatarMat = avatar.material as StandardMaterial | null;
      if (avatarMat) {
        const power = 0.34 + pulse * 0.24 + surge * 0.24;
        avatarMat.emissiveColor = avatarMat.diffuseColor.scale(power);
      }
    }

    const namePlate = this.namePlateMeshes.get(this.activeTurnSeatIndex);
    if (namePlate) {
      namePlate.position.y = 4.5 + floatOffset * 0.42;
    }
    const scoreBadge = this.scoreBadgeMeshes.get(this.activeTurnSeatIndex);
    if (scoreBadge) {
      scoreBadge.position.y = 5.4 + floatOffset * 0.52;
    }

    const marker = this.turnMarkerMeshes.get(this.activeTurnSeatIndex);
    if (!marker || !marker.isVisible) {
      return;
    }
    const markerScale = 1 + pulse * 0.24 + surge * 0.14;
    marker.scaling.set(markerScale, markerScale, markerScale);
    marker.position.y = TURN_MARKER_BASE_HEIGHT + floatOffset * 0.75 + pulse * 0.22;

    const markerMat = marker.material as StandardMaterial | null;
    if (markerMat) {
      markerMat.emissiveColor.r = 0.2 + pulse * 0.2 + surge * 0.16;
      markerMat.emissiveColor.g = 0.76 + pulse * 0.2 + surge * 0.2;
      markerMat.emissiveColor.b = 0.32 + pulse * 0.16 + surge * 0.12;
      markerMat.alpha = 0.46 + pulse * 0.24 + surge * 0.16;
    }
  }

  private drawChatBubble(
    bubbleVisual: SeatChatBubbleVisual,
    message: string,
    tone: SeatChatBubbleTone,
    isBot: boolean
  ): void {
    const texture = bubbleVisual.textTexture;
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    const width = 768;
    const height = 256;
    const palette = this.resolveChatBubblePalette(tone, isBot);

    ctx.clearRect(0, 0, width, height);

    this.drawRoundedRect(ctx, 24, 20, width - 48, height - 40, 24);
    ctx.fillStyle = palette.fill;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = 5;
    ctx.strokeStyle = palette.stroke;
    ctx.stroke();

    const lines = this.wrapChatBubbleText(message, 2, 30);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 44px Arial";
    ctx.lineWidth = 7;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.48)";
    ctx.fillStyle = palette.text;
    lines.forEach((line, lineIndex) => {
      const y = height / 2 - ((lines.length - 1) * 44) / 2 + lineIndex * 44;
      ctx.strokeText(line, width / 2, y);
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
    this.scene.unregisterBeforeRender(this.turnMarkerAnimator);
    this.scorePulseTimers.forEach((timer) => clearTimeout(timer));
    this.chatBubbleHideTimers.forEach((timer) => clearTimeout(timer));
    this.seatMeshes.forEach((mesh) => mesh.dispose());
    this.namePlateMeshes.forEach((mesh) => mesh.dispose());
    this.scoreBadgeMeshes.forEach((mesh) => mesh.dispose());
    this.chatBubbleMeshes.forEach((bubbleVisual) => bubbleVisual.root.dispose());
    this.scoreZoneMeshes.forEach((mesh) => mesh.dispose());
    this.turnMarkerMeshes.forEach((mesh) => mesh.dispose());
    this.seatAvatarTextures.forEach((entry) => {
      entry.texture?.dispose();
    });
    this.seatMeshes.clear();
    this.seatAvatarMeshes.clear();
    this.seatHeadMeshes.clear();
    this.namePlateMeshes.clear();
    this.scoreBadgeMeshes.clear();
    this.chatBubbleMeshes.clear();
    this.scoreZoneMeshes.clear();
    this.turnMarkerMeshes.clear();
    this.seatAvatarTextures.clear();
    this.seatBasePositions.clear();
    this.avatarTextureFailuresByUrl.clear();
    this.scorePulseTimers.clear();
    this.chatBubbleHideTimers.clear();
    this.seatStates.clear();
  }
}
