/**
 * Geometry loader for dice-box smooth-pip theme
 * Loads 3D models and collision data for improved dice rendering
 *
 * @see https://github.com/3d-dice/dice-themes
 * @license CC0 (Creative Commons Zero)
 */

import { Scene, Mesh, VertexData, Quaternion, Vector3 } from "@babylonjs/core";
import { DieKind } from "../engine/types.js";
import { ThemeConfig } from "../services/themeManager.js";
import { logger } from "../utils/logger.js";

const log = logger.create('GeometryLoader');

interface BabylonMeshData {
  name: string;
  id: string;
  position?: [number, number, number];
  rotationQuaternion?: [number, number, number, number];
  scaling?: [number, number, number];
  positions: number[];
  indices: number[];
  normals: number[];
  uvs?: number[];
  tangents?: number[];
}

interface DiceGeometryFile {
  meshes: BabylonMeshData[];
  colliderFaceMap: {
    d4: Record<string, number>;
    d6: Record<string, number>;
    d8: Record<string, number>;
    d10: Record<string, number>;
    d12: Record<string, number>;
    d20: Record<string, number>;
  };
}

let geometryData: DiceGeometryFile | null = null;

/**
 * Load dice geometry data from smoothDice.json
 */
export async function loadDiceGeometry(): Promise<DiceGeometryFile> {
  if (geometryData) {
    return geometryData;
  }

  const basePath = import.meta.env.BASE_URL || './';
  const response = await fetch(`${basePath}assets/themes/diceOfRolling/smoothDice.json`);
  if (!response.ok) {
    throw new Error(`Failed to load geometry: ${response.statusText}`);
  }

  geometryData = await response.json();
  return geometryData!;
}

/**
 * Create a mesh from imported geometry data
 * @param name - Mesh name
 * @param dieKind - Type of die (d4, d6, etc.)
 * @param scene - Babylon scene
 * @param geometryData - Loaded geometry file data
 * @param themeConfig - Optional theme config with per-die overrides
 */
export function createMeshFromGeometry(
  name: string,
  dieKind: DieKind,
  scene: Scene,
  geometryData: DiceGeometryFile,
  themeConfig?: ThemeConfig
): Mesh | null {
  // Find the visual mesh (not the collider)
  const meshData = geometryData.meshes.find(
    (m) => m.name === dieKind && !m.id.includes("collider")
  );

  if (!meshData) {
    log.warn(`No geometry data found for ${dieKind}`);
    return null;
  }

  // Validate mesh data
  if (!meshData.positions || !meshData.indices || !meshData.normals) {
    log.warn(`Invalid geometry data for ${dieKind}`);
    return null;
  }

  log.debug(`Creating mesh for ${dieKind} with ${meshData.positions.length / 3} vertices, UVs: ${meshData.uvs ? meshData.uvs.length / 2 : 0}`);

  // Create mesh
  const mesh = new Mesh(name, scene);

  // Create vertex data
  const vertexData = new VertexData();
  vertexData.positions = meshData.positions;
  vertexData.indices = meshData.indices;
  vertexData.normals = meshData.normals;

  if (meshData.uvs && meshData.uvs.length > 0) {
    vertexData.uvs = meshData.uvs;
  }

  // Apply vertex data to mesh
  vertexData.applyToMesh(mesh);

  // Get per-die settings from theme config if available
  const perDieSettings = themeConfig?.perDieSettings?.[dieKind];

  // Apply position (theme config overrides geometry data)
  if (perDieSettings?.positionOffset) {
    mesh.position.set(
      perDieSettings.positionOffset[0],
      perDieSettings.positionOffset[1],
      perDieSettings.positionOffset[2]
    );
  } else if (meshData.position) {
    mesh.position.set(meshData.position[0], meshData.position[1], meshData.position[2]);
  }

  // Apply rotation (theme config overrides geometry data)
  if (perDieSettings?.rotationQuaternion) {
    mesh.rotationQuaternion = new Quaternion(
      perDieSettings.rotationQuaternion[0],
      perDieSettings.rotationQuaternion[1],
      perDieSettings.rotationQuaternion[2],
      perDieSettings.rotationQuaternion[3]
    );
  } else if (meshData.rotationQuaternion) {
    mesh.rotationQuaternion = new Quaternion(
      meshData.rotationQuaternion[0],
      meshData.rotationQuaternion[1],
      meshData.rotationQuaternion[2],
      meshData.rotationQuaternion[3]
    );
  }

  // Apply scaling (theme config overrides geometry data)
  if (perDieSettings?.scaling) {
    mesh.scaling.set(
      perDieSettings.scaling[0],
      perDieSettings.scaling[1],
      perDieSettings.scaling[2]
    );
  } else if (meshData.scaling) {
    mesh.scaling.set(meshData.scaling[0], meshData.scaling[1], meshData.scaling[2]);
  }

  return mesh;
}

/**
 * Get the collider face map for a specific die type
 */
export function getColliderFaceMap(
  dieKind: DieKind,
  geometryData: DiceGeometryFile
): Record<string, number> | null {
  return geometryData.colliderFaceMap[dieKind] || null;
}
