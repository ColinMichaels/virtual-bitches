import {
  Scene,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  Vector4,
  Animation,
  CubicEase,
  EasingFunction,
  DynamicTexture,
  ShadowGenerator,
  HighlightLayer,
} from "@babylonjs/core";
import { DieState, DieKind } from "../engine/types.js";
import { scoreDie } from "../engine/rules.js";

const DIE_SIZES: Record<DieKind, number> = {
  d4: 1.2,
  d6: 1.0,
  d8: 1.1,
  d10: 1.1,
  d12: 1.3,
  d20: 1.4,
};

// Individual die colors - glossy plastic dice
// Individual die colors - muted palette for better pip/text visibility
const DIE_COLORS: Color3[] = [
  Color3.FromHexString("#2a2a2a"), // Dark gray d6 (was black)
  Color3.FromHexString("#3d5a4a"), // Muted green d6
  Color3.FromHexString("#4a5c7a"), // Muted blue d6
  Color3.FromHexString("#b8a062"), // Muted gold d6 (was bright yellow)
  Color3.FromHexString("#8f6f7e"), // Muted pink d6
  Color3.FromHexString("#7a3d3d"), // Muted red d6
  Color3.FromHexString("#8a4a4a"), // Muted red d6 #2
  Color3.FromHexString("#c4b399"), // Muted cream d6
  Color3.FromHexString("#c8c8c8"), // Light gray d6 (was white)
  Color3.FromHexString("#2a2a2a"), // Dark gray d6 #2 (was black)
  Color3.FromHexString("#6b5139"), // Muted brown d6
  Color3.FromHexString("#2a2a2a"), // Dark gray d6 #3 (was black)
  Color3.FromHexString("#5a6470"), // Muted blue-gray d10
  Color3.FromHexString("#7a3d3d"), // Muted red d12
  Color3.FromHexString("#6b5688"), // Muted purple d20
];

export class DiceRenderer {
  private meshes = new Map<string, Mesh>();
  private selectedMeshes = new Set<string>();
  private shadowGenerator: ShadowGenerator | null = null;
  private highlightLayer: HighlightLayer;
  private colorIndex = 0;
  private dieColors = new Map<string, string>(); // Track hex color per die ID

  constructor(private scene: Scene) {
    const generators = this.scene.lights
      .map((light) => light.getShadowGenerator())
      .filter((gen): gen is ShadowGenerator => gen !== null);
    this.shadowGenerator = generators[0] || null;

    // Create highlight layer for selection glow
    this.highlightLayer = new HighlightLayer("highlight", this.scene);
    this.highlightLayer.blurHorizontalSize = 1.0;
    this.highlightLayer.blurVerticalSize = 1.0;
  }

  createDie(die: DieState): Mesh {
    const size = DIE_SIZES[die.def.kind];
    let mesh: Mesh;

    // Create geometry based on die type - using actual polyhedra
    switch (die.def.kind) {
      case "d4":
        // Tetrahedron (4 sides)
        mesh = MeshBuilder.CreatePolyhedron(
          die.id,
          { type: 0, size: size * 0.9 },
          this.scene
        );
        break;
      case "d6":
        // Cube (6 sides) with custom UV mapping for texture atlas
        // faceUV maps each face to a section of our 3x2 texture atlas
        // Atlas layout: [1,2,3 / 4,5,6]
        const faceUV = [];
        // Standard Babylon cube face order: front, back, right, left, top, bottom
        // Map to die faces: 1, 6, 2, 5, 3, 4 (standard opposite convention)
        const faceMap = [1, 6, 2, 5, 3, 4];

        for (const faceValue of faceMap) {
          const col = (faceValue - 1) % 3;
          const row = Math.floor((faceValue - 1) / 3);
          const u1 = col / 3;
          const v1 = row / 2;
          const u2 = (col + 1) / 3;
          const v2 = (row + 1) / 2;
          faceUV.push(new Vector4(u1, v1, u2, v2));
        }

        mesh = MeshBuilder.CreateBox(
          die.id,
          {
            size: size,
            faceUV: faceUV,
            wrap: true
          },
          this.scene
        );
        break;
      case "d8":
        // Octahedron (8 sides)
        mesh = MeshBuilder.CreatePolyhedron(
          die.id,
          { type: 1, size: size * 0.8 },
          this.scene
        );
        break;
      case "d10":
        // Pentagonal trapezohedron approximation using cylinder with 10 faces
        mesh = MeshBuilder.CreateCylinder(
          die.id,
          {
            height: size * 0.8,  // More compact - closer to 1:1 ratio
            diameterTop: size * 0.6,  // Slightly wider for better proportions
            diameterBottom: size * 0.6,
            tessellation: 5
          },
          this.scene
        );
        break;
      case "d12":
        // Dodecahedron (12 sides)
        mesh = MeshBuilder.CreatePolyhedron(
          die.id,
          { type: 3, size: size * 0.7 },
          this.scene
        );
        break;
      case "d20":
        // Icosahedron (20 sides)
        mesh = MeshBuilder.CreatePolyhedron(
          die.id,
          { type: 2, size: size * 0.7 },
          this.scene
        );
        break;
      default:
        mesh = MeshBuilder.CreateBox(
          die.id,
          { size: size },
          this.scene
        );
    }

    // Apply glossy plastic material with individual color
    const mat = new StandardMaterial(`${die.id}-mat`, this.scene);

    // Get color for this die
    const color = DIE_COLORS[this.colorIndex % DIE_COLORS.length];

    // Store the hex color for this die (for HUD matching)
    const hexColor = this.colorToHex(color);
    this.dieColors.set(die.id, hexColor);

    this.colorIndex++;

    mat.diffuseColor = color;
    mat.specularColor = new Color3(1, 1, 1); // Bright specular highlights
    mat.specularPower = 128; // Very glossy plastic

    mesh.material = mat;

    // Add value label (pips for d6, numerals for others)
    this.addValueLabel(mesh, die);

    // Enable shadows
    mesh.receiveShadows = true;
    if (this.shadowGenerator) {
      this.shadowGenerator.addShadowCaster(mesh);
    }

    // Store reference
    this.meshes.set(die.id, mesh);

    return mesh;
  }

  private addValueLabel(mesh: Mesh, die: DieState) {
    if (die.value === 0) return;

    const mat = mesh.material as StandardMaterial;

    if (die.def.kind === "d6") {
      // For d6, create texture atlas with all 6 faces
      // Layout: 3x2 grid (faces 1-6)
      const texture = this.createD6Texture(mat.diffuseColor);
      mat.diffuseTexture = texture;
    } else {
      // For polyhedral dice (d8, d10, d12, d20), show rolled value
      const texture = this.createPolyhedralTexture(die, mat.diffuseColor);
      mat.diffuseTexture = texture;
      mat.emissiveTexture = texture;
      mat.emissiveColor = new Color3(0.2, 0.2, 0.2);
    }
  }

  private createD6Texture(baseColor: Color3): DynamicTexture {
    // Create 3x2 grid for cube faces: standard die layout
    // Top row: 1, 2, 3
    // Bottom row: 4, 5, 6
    const texture = new DynamicTexture("d6-atlas", { width: 1536, height: 1024 }, this.scene, false);
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

  private createPolyhedralTexture(die: DieState, baseColor: Color3): DynamicTexture {
    // Create texture with rolled value displayed on all faces
    const texture = new DynamicTexture(`${die.id}-texture`, { width: 512, height: 512 }, this.scene, false);
    const ctx = texture.getContext() as CanvasRenderingContext2D;

    const r = Math.floor(baseColor.r * 255);
    const g = Math.floor(baseColor.g * 255);
    const b = Math.floor(baseColor.b * 255);
    ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
    ctx.fillRect(0, 0, 512, 512);

    // For d10, display "0" instead of "10" (standard d10 convention)
    const displayValue = die.def.kind === "d10" && die.value === 10 ? 0 : die.value;
    this.drawEngravedNumeral(ctx, displayValue, "#F5F0E8");

    texture.update();
    return texture;
  }

  private drawPipsOnFace(ctx: CanvasRenderingContext2D, value: number, faceSize: number) {
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

    // Draw pips with concave effect
    pips.forEach(([x, y]) => {
      // Draw base bright white pip
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, pipRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private drawPips(ctx: CanvasRenderingContext2D, value: number, color: string) {
    // Legacy function - use drawPipsOnFace instead
    const center = 256;
    const offset = 120;
    const pipRadius = 50;

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
        [center - offset, center - 130],
        [center - offset, center],
        [center - offset, center + 130],
        [center + offset, center - 130],
        [center + offset, center],
        [center + offset, center + 130],
      ],
    };

    const pips = positions[value] || [];

    // Draw each pip (filled circle)
    pips.forEach(([x, y]) => {
      // Main pip in white
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y, pipRadius, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  private drawEngravedNumeral(ctx: CanvasRenderingContext2D, value: number, color: string) {
    // Draw numeral in white for better visibility
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 320px Arial, sans-serif";

    // Main numeral in white
    ctx.fillStyle = "#ffffff";
    ctx.fillText(value.toString(), 256, 256);
  }

  updateDie(die: DieState) {
    const mesh = this.meshes.get(die.id);
    if (!mesh) return;

    this.addValueLabel(mesh, die);

    // Update selection state
    if (mesh.material instanceof StandardMaterial) {
      if (this.selectedMeshes.has(die.id)) {
        mesh.material.emissiveColor = new Color3(1, 1, 0.3);
      } else {
        mesh.material.emissiveColor = new Color3(0.1, 0.1, 0.1);
      }
    }
  }

  setSelected(dieId: string, selected: boolean) {
    if (selected) {
      this.selectedMeshes.add(dieId);
    } else {
      this.selectedMeshes.delete(dieId);
    }

    const mesh = this.meshes.get(dieId);
    if (!mesh) return;

    if (selected) {
      // Add golden glow around selected die
      this.highlightLayer.addMesh(mesh, new Color3(1, 0.8, 0));
    } else {
      // Remove glow from deselected die
      this.highlightLayer.removeMesh(mesh);
    }
  }

  animateRoll(dice: DieState[], onComplete: () => void) {
    const activeDice = dice.filter((d) => d.inPlay && !d.scored);
    if (activeDice.length === 0) {
      onComplete();
      return;
    }

    // Arrange in grid
    const cols = Math.ceil(Math.sqrt(activeDice.length));
    const spacing = 2.5;

    activeDice.forEach((die, i) => {
      let mesh = this.meshes.get(die.id);
      if (!mesh) {
        mesh = this.createDie(die);
      }

      const row = Math.floor(i / cols);
      const col = i % cols;
      const offsetX = (col - cols / 2) * spacing;
      const offsetZ = (row - Math.floor(activeDice.length / cols) / 2) * spacing;

      // Add random position variation
      const randomX = offsetX + (Math.random() - 0.5) * 1.5;
      const randomZ = offsetZ + (Math.random() - 0.5) * 1.5;

      // Animate from above - adjust landing height based on die type
      const startY = 15;
      let endY = 0.6; // Default for d6

      // Raise d8 and d12 so they don't sink into the table
      if (die.def.kind === "d8") {
        endY = 0.8;
      } else if (die.def.kind === "d12") {
        endY = 0.9;
      } else if (die.def.kind === "d4") {
        endY = 0.7;
      } else if (die.def.kind === "d20") {
        endY = 0.95;
      }

      mesh.position = new Vector3(randomX, startY, randomZ);

      // Get correct face-up rotation based on die value
      const faceRotation = this.getFaceUpRotation(die.def.kind, die.value);
      const finalRotation = new Vector3(
        faceRotation.x,
        Math.random() * Math.PI * 2, // Y: random spin for variety
        faceRotation.z
      );

      const startRotation = new Vector3(
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2,
        Math.random() * Math.PI * 2
      );
      mesh.rotation = startRotation;

      // Varying animation speed for more natural look
      const animDuration = 30 + Math.random() * 10; // 30-40 frames

      // Drop animation with bounce
      const dropAnim = new Animation(
        `${die.id}-drop`,
        "position.y",
        60,
        Animation.ANIMATIONTYPE_FLOAT,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      dropAnim.setKeys([
        { frame: 0, value: startY },
        { frame: animDuration * 0.7, value: endY - 0.1 }, // Slight dip below surface
        { frame: animDuration * 0.85, value: endY + 0.3 }, // First bounce
        { frame: animDuration * 0.95, value: endY + 0.1 }, // Small bounce
        { frame: animDuration, value: endY }, // Settle
      ]);

      // Rotation animation - chaotic tumbling then settle
      const rotAnim = new Animation(
        `${die.id}-rotate`,
        "rotation",
        60,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      // Mid-air chaotic rotation
      const midRotation = new Vector3(
        startRotation.x + (Math.random() - 0.5) * Math.PI * 4,
        startRotation.y + (Math.random() - 0.5) * Math.PI * 6,
        startRotation.z + (Math.random() - 0.5) * Math.PI * 4
      );

      rotAnim.setKeys([
        { frame: 0, value: startRotation },
        { frame: animDuration * 0.25, value: midRotation }, // Wild tumbling mid-air
        { frame: animDuration, value: finalRotation }, // Settle to correct face
      ]);

      const ease = new CubicEase();
      ease.setEasingMode(EasingFunction.EASINGMODE_EASEINOUT);
      dropAnim.setEasingFunction(ease);
      rotAnim.setEasingFunction(ease);

      mesh.animations = [dropAnim, rotAnim];
      this.scene.beginAnimation(mesh, 0, animDuration, false, 0.45, () => {
        this.updateDie(die);
      });
    });

    // Increase timeout to account for varying animation durations
    setTimeout(onComplete, 1000);
  }

  animateScore(dice: DieState[], selected: Set<string>, onComplete: () => void) {
    const toScore = dice.filter((d) => selected.has(d.id));
    if (toScore.length === 0) {
      onComplete();
      return;
    }

    // Count how many dice are already scored (not counting the ones we're about to score)
    const alreadyScored = dice.filter((d) => d.scored && !selected.has(d.id)).length;

    // Grid layout configuration for scored area
    const gridCols = 3; // 3 dice per row
    const gridRows = 4; // 4 rows before stacking
    const maxGridDice = gridCols * gridRows; // 12 dice in grid
    const spacingX = 1.5; // Space between dice columns
    const spacingZ = 1.5; // Space between dice rows
    const baseX = 12; // X position of scored area (moved right to scoring section)
    const baseZ = -3; // Starting Z position
    const baseY = 0.6; // Ground level

    toScore.forEach((die, i) => {
      const mesh = this.meshes.get(die.id);
      if (!mesh) return;

      // Remove highlight glow when scoring
      this.highlightLayer.removeMesh(mesh);

      // Calculate position based on total scored count
      const totalIndex = alreadyScored + i;

      let targetX: number, targetY: number, targetZ: number;

      if (totalIndex < maxGridDice) {
        // Grid layout - spread in both X and Z dimensions
        const row = Math.floor(totalIndex / gridCols);
        const col = totalIndex % gridCols;

        // Center the grid by offsetting based on number of columns
        const offsetX = (col - (gridCols - 1) / 2) * spacingX;

        targetX = baseX + offsetX;
        targetY = baseY;
        targetZ = baseZ + (row * spacingZ);
      } else {
        // Stack vertically when grid is full (in center of grid)
        const stackIndex = totalIndex - maxGridDice;
        const stackSpacing = 1.3;

        targetX = baseX;
        targetY = baseY + (stackIndex * stackSpacing);
        targetZ = baseZ + (1.5 * spacingZ); // Center of grid
      }

      // Get face-up rotation for the die's value
      const faceRotation = this.getFaceUpRotation(die.def.kind, die.value);
      const targetRotation = new Vector3(
        faceRotation.x,
        0, // No Y rotation for scored dice
        faceRotation.z
      );

      // Slide to scored area
      const moveAnim = new Animation(
        `${die.id}-score`,
        "position",
        60,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      moveAnim.setKeys([
        { frame: 0, value: mesh.position.clone() },
        { frame: 20, value: new Vector3(targetX, targetY, targetZ) },
      ]);

      // Rotate to face-up position
      const rotateAnim = new Animation(
        `${die.id}-score-rotate`,
        "rotation",
        60,
        Animation.ANIMATIONTYPE_VECTOR3,
        Animation.ANIMATIONLOOPMODE_CONSTANT
      );

      rotateAnim.setKeys([
        { frame: 0, value: mesh.rotation.clone() },
        { frame: 20, value: targetRotation },
      ]);

      mesh.animations = [moveAnim, rotateAnim];
      this.scene.beginAnimation(mesh, 0, 20, false);
    });

    setTimeout(onComplete, 400);
  }

  getMesh(dieId: string): Mesh | undefined {
    return this.meshes.get(dieId);
  }

  getDieColor(dieId: string): string | undefined {
    return this.dieColors.get(dieId);
  }

  clearDice(): void {
    // Dispose all meshes
    this.meshes.forEach((mesh) => {
      mesh.dispose();
    });

    // Clear all maps
    this.meshes.clear();
    this.dieColors.clear();

    // Reset color index
    this.colorIndex = 0;
  }

  /**
   * Calculate rotation needed to show specific face value pointing up
   * For d6: Maps face values 1-6 to rotations that show that face on top
   */
  private getFaceUpRotation(kind: DieKind, value: number): Vector3 {
    switch (kind) {
      case "d6":
        // Babylon.js cube faces with our faceUV mapping:
        // faceMap: [1, 6, 2, 5, 3, 4] maps to cube faces [front, back, right, left, top, bottom]
        // Default orientation: face 3 on top, face 4 on bottom
        // Based on testing: 5 is correct at (0, 0, Math.PI / 2)
        // Working backwards from observed results to find correct rotations
        const d6Rotations: Record<number, Vector3> = {
          1: new Vector3(-Math.PI, 0, 0),            // Correct
          2: new Vector3(0, 0, -Math.PI / 2),        // Right -> top
          3: new Vector3(Math.PI / 2, 0, 0),         // Swapped with 6
          4: new Vector3(-Math.PI / 2, 0, 0),        // Correct
          5: new Vector3(0, 0, Math.PI / 2),         // Correct
          6: new Vector3(0, 0, 0),                    // Swapped with 3
        };
        return d6Rotations[value] || new Vector3(0, 0, 0);

      // For polyhedra, keep flat for now (would need face normal calculations)
        // For d8 and d12, add slight tilt so they look like they landed on a face
      case "d8":
        // Octahedron - tilt to rest on one triangular face
        return new Vector3(
            Math.PI / 8 + (Math.random() - 0.5) * 0.2,
            0,
            Math.PI / 8 + (Math.random() - 0.5) * 0.2
        );

      case "d12":
        // Dodecahedron - tilt to rest on one pentagonal face
        return new Vector3(
            Math.PI / 6 + (Math.random() - 0.5) * 0.3,
            0,
            Math.PI / 7 + (Math.random() - 0.5) * 0.3
        );

      case "d4":
        // Tetrahedron - point up
        return new Vector3(-Math.PI / 3, 0, 0);

      case "d10":
      case "d20":
      default:
        // Keep relatively flat for d10 and d20
        return new Vector3(
            (Math.random() - 0.5) * 0.3,
            0,
            (Math.random() - 0.5) * 0.3
        );
    }
  }

  private colorToHex(color: Color3): string {
    const r = Math.floor(color.r * 255).toString(16).padStart(2, '0');
    const g = Math.floor(color.g * 255).toString(16).padStart(2, '0');
    const b = Math.floor(color.b * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  dispose() {
    this.meshes.forEach((mesh) => mesh.dispose());
    this.meshes.clear();
  }
}
