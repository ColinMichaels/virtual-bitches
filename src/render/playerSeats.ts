/**
 * Player seat visualization system for octagon table
 * Creates placeholder avatar objects for 8-player multiplayer
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

/**
 * Player seat state
 */
export interface SeatState {
  index: number;
  occupied: boolean;
  isCurrentPlayer: boolean;
  playerName?: string;
  avatarColor?: Color3;
}

/**
 * Player seat renderer for octagon table
 */
export class PlayerSeatRenderer {
  private scene: Scene;
  private seatMeshes: Map<number, Mesh> = new Map();
  private namePlateMeshes: Map<number, Mesh> = new Map();
  private onSeatClickCallback?: (seatIndex: number) => void;

  constructor(scene: Scene) {
    this.scene = scene;
  }

  /**
   * Set callback for when a player seat is clicked
   * @param callback - Function to call with seat index when clicked
   */
  onSeatClick(callback: (seatIndex: number) => void): void {
    this.onSeatClickCallback = callback;
  }

  /**
   * Create all 8 player seats around the octagon table
   * @param seats - Array of player seat positions from octagonGeometry
   * @param currentPlayerSeat - Index of the current player's seat (0-7)
   */
  createPlayerSeats(seats: PlayerSeat[], currentPlayerSeat: number = 0): void {
    seats.forEach((seat) => {
      const isCurrentPlayer = seat.index === currentPlayerSeat;
      this.createSeatAvatar(seat, isCurrentPlayer);
      this.createNamePlate(seat, isCurrentPlayer);
    });
  }

  /**
   * Create a simple avatar placeholder at the seat position
   * @param seat - Player seat position data
   * @param isCurrentPlayer - Whether this is the current player's seat
   */
  private createSeatAvatar(seat: PlayerSeat, isCurrentPlayer: boolean): void {
    // Avatar pedestal/base (root/parent object)
    const pedestal = MeshBuilder.CreateCylinder(
      `seat-pedestal-${seat.index}`,
      { height: 0.5, diameter: 1.5 },
      this.scene
    );
    pedestal.position = seat.position.clone();
    pedestal.position.y -= 0.5;

    // Avatar placeholder (body) - position relative to parent
    const avatar = MeshBuilder.CreateCylinder(
      `seat-avatar-${seat.index}`,
      { height: 2.5, diameterTop: 0.8, diameterBottom: 1.2 },
      this.scene
    );
    avatar.position = new Vector3(0, 1.5, 0); // Relative to pedestal
    avatar.parent = pedestal;

    // Head sphere - position relative to parent
    const head = MeshBuilder.CreateSphere(
      `seat-head-${seat.index}`,
      { diameter: 1.0 },
      this.scene
    );
    head.position = new Vector3(0, 3.0, 0); // Relative to pedestal
    head.parent = pedestal;

    // Material setup
    const pedestalMat = new StandardMaterial(`pedestal-mat-${seat.index}`, this.scene);
    const avatarMat = new StandardMaterial(`avatar-mat-${seat.index}`, this.scene);
    const headMat = new StandardMaterial(`head-mat-${seat.index}`, this.scene);

    if (isCurrentPlayer) {
      // Current player - highlight with bright color
      pedestalMat.diffuseColor = new Color3(0.2, 0.8, 0.3); // Bright green
      pedestalMat.emissiveColor = new Color3(0.1, 0.4, 0.15);
      avatarMat.diffuseColor = new Color3(0.3, 0.9, 0.4);
      avatarMat.emissiveColor = new Color3(0.15, 0.5, 0.2);
      headMat.diffuseColor = new Color3(0.9, 0.7, 0.5); // Skin tone
    } else {
      // Empty seat - very muted/grayed out to entice multiplayer
      pedestalMat.diffuseColor = new Color3(0.15, 0.15, 0.17);
      pedestalMat.emissiveColor = new Color3(0, 0, 0);
      avatarMat.diffuseColor = new Color3(0.2, 0.2, 0.22);
      avatarMat.emissiveColor = new Color3(0, 0, 0);
      headMat.diffuseColor = new Color3(0.25, 0.25, 0.27);
      pedestalMat.alpha = 0.5; // Semi-transparent
      avatarMat.alpha = 0.5;
      headMat.alpha = 0.5;
    }

    pedestal.material = pedestalMat;
    avatar.material = avatarMat;
    head.material = headMat;

    // Add click interaction for empty seats
    if (!isCurrentPlayer) {
      this.addClickInteraction(pedestal, seat.index);
      this.addClickInteraction(avatar, seat.index);
      this.addClickInteraction(head, seat.index);
    }

    // Rotate to face table center
    pedestal.rotation.y = seat.angle + Math.PI; // Face inward

    this.seatMeshes.set(seat.index, pedestal);
  }

  /**
   * Add click interaction to a mesh
   * @param mesh - Mesh to make clickable
   * @param seatIndex - Seat index for callback
   */
  private addClickInteraction(mesh: Mesh, seatIndex: number): void {
    mesh.actionManager = new ActionManager(this.scene);

    // Click/tap action
    mesh.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPickTrigger, () => {
        if (this.onSeatClickCallback) {
          this.onSeatClickCallback(seatIndex);
        }
      })
    );

    // Hover effect - brighten on hover
    mesh.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
        const material = mesh.material as StandardMaterial;
        if (material) {
          material.emissiveColor = new Color3(0.1, 0.1, 0.15);
        }
      })
    );

    mesh.actionManager.registerAction(
      new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
        const material = mesh.material as StandardMaterial;
        if (material) {
          material.emissiveColor = new Color3(0, 0, 0);
        }
      })
    );
  }

  /**
   * Create a name plate above the seat
   * @param seat - Player seat position data
   * @param isCurrentPlayer - Whether this is the current player's seat
   */
  private createNamePlate(seat: PlayerSeat, isCurrentPlayer: boolean): void {
    // Get the pedestal parent to attach nameplate
    const pedestal = this.seatMeshes.get(seat.index);

    const namePlate = MeshBuilder.CreatePlane(
      `nameplate-${seat.index}`,
      { width: 3, height: 0.8 },
      this.scene
    );

    // Position above the avatar (relative to pedestal)
    namePlate.position = new Vector3(0, 4.5, 0);

    // Parent to pedestal so it moves with the avatar
    if (pedestal) {
      namePlate.parent = pedestal;
    }

    // Create texture for name plate
    const texture = new DynamicTexture(
      `nameplate-texture-${seat.index}`,
      { width: 512, height: 128 },
      this.scene,
      false
    );
    const ctx = texture.getContext() as CanvasRenderingContext2D;

    // Background
    if (isCurrentPlayer) {
      ctx.fillStyle = "#2a8f3a";
    } else {
      ctx.fillStyle = "#2a2a2c"; // Very dark gray for empty seats
    }
    ctx.fillRect(0, 0, 512, 128);

    // Text
    if (isCurrentPlayer) {
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 60px Arial";
    } else {
      ctx.fillStyle = "#555555"; // Dim text for empty seats
      ctx.font = "bold 48px Arial"; // Slightly smaller
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const text = isCurrentPlayer ? "YOU (Seat " + (seat.index + 1) + ")" : "Empty";
    ctx.fillText(text, 256, 64);

    texture.update();

    const material = new StandardMaterial(`nameplate-mat-${seat.index}`, this.scene);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;

    if (isCurrentPlayer) {
      material.emissiveColor = new Color3(0.3, 0.3, 0.3);
      material.alpha = 1.0;
    } else {
      material.emissiveColor = new Color3(0, 0, 0); // No glow for empty
      material.alpha = 0.4; // Semi-transparent
    }

    material.backFaceCulling = false; // Visible from both sides

    namePlate.material = material;
    this.namePlateMeshes.set(seat.index, namePlate);
  }

  /**
   * Update a seat's state (occupied, player name, etc.)
   * @param seatIndex - Seat number (0-7)
   * @param state - New seat state
   */
  updateSeat(seatIndex: number, state: Partial<SeatState>): void {
    const pedestal = this.seatMeshes.get(seatIndex);
    const namePlate = this.namePlateMeshes.get(seatIndex);

    if (!pedestal || !namePlate) return;

    // Update materials based on state
    const avatarMat = pedestal.getChildMeshes()[0].material as StandardMaterial;
    const headMat = pedestal.getChildMeshes()[1].material as StandardMaterial;
    const pedestalMat = pedestal.material as StandardMaterial;

    if (state.occupied) {
      // Occupied seat - use custom color or default
      const color = state.avatarColor || new Color3(0.5, 0.6, 0.8);
      avatarMat.diffuseColor = color;
      avatarMat.emissiveColor = color.scale(0.3);
      headMat.diffuseColor = new Color3(0.9, 0.7, 0.5);
    } else if (!state.isCurrentPlayer) {
      // Empty seat - muted
      avatarMat.diffuseColor = new Color3(0.4, 0.4, 0.45);
      avatarMat.emissiveColor = new Color3(0.08, 0.08, 0.1);
      headMat.diffuseColor = new Color3(0.5, 0.5, 0.55);
    }

    // Update name plate text
    if (state.playerName) {
      const texture = (namePlate.material as StandardMaterial).diffuseTexture as DynamicTexture;
      const ctx = texture.getContext() as CanvasRenderingContext2D;

      ctx.clearRect(0, 0, 512, 128);

      // Background
      if (state.isCurrentPlayer) {
        ctx.fillStyle = "#2a8f3a";
      } else if (state.occupied) {
        ctx.fillStyle = "#4a5a7a";
      } else {
        ctx.fillStyle = "#3a3a4a";
      }
      ctx.fillRect(0, 0, 512, 128);

      // Text
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 60px Arial";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      ctx.fillText(state.playerName, 256, 64);
      texture.update();
    }
  }

  /**
   * Highlight the current player's seat with animation/effect
   * @param seatIndex - Seat number to highlight
   */
  highlightSeat(seatIndex: number): void {
    const pedestal = this.seatMeshes.get(seatIndex);
    if (!pedestal) return;

    const pedestalMat = pedestal.material as StandardMaterial;

    // Add pulsing emissive effect
    pedestalMat.emissiveColor = new Color3(0.2, 0.6, 0.3);

    // Slight scale pulse (could animate this with scene.registerBeforeRender)
    pedestal.scaling = new Vector3(1.1, 1.1, 1.1);
  }

  /**
   * Remove highlight from all seats
   */
  clearHighlights(): void {
    this.seatMeshes.forEach((pedestal) => {
      pedestal.scaling = new Vector3(1, 1, 1);
    });
  }

  /**
   * Dispose all seat meshes
   */
  dispose(): void {
    this.seatMeshes.forEach((mesh) => mesh.dispose());
    this.namePlateMeshes.forEach((mesh) => mesh.dispose());
    this.seatMeshes.clear();
    this.namePlateMeshes.clear();
  }
}
