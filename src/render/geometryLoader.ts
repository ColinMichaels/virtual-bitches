/**
 * Geometry loader for dice-box smooth-pip theme
 * Loads 3D models and collision data for improved dice rendering
 *
 * @see https://github.com/3d-dice/dice-themes
 * @license CC0 (Creative Commons Zero)
 */

import { Scene, Mesh, VertexData } from "@babylonjs/core";
import { DieKind } from "../engine/types.js";
import { logger } from "../utils/logger.js";

const log = logger.create('GeometryLoader');

interface BabylonMeshData {
  name: string;
  id: string;
  positions: number[];
  indices: number[];
  normals: number[];
  uvs?: number[];
  tangents?: number[];
  scaling?: [number, number, number];
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

  const response = await fetch("./src/assets/textures/smooth-pip/smoothDice.json");
  if (!response.ok) {
    throw new Error(`Failed to load dice geometry: ${response.statusText}`);
  }

  geometryData = await response.json();
  return geometryData!;
}

/**
 * Create a mesh from imported geometry data
 */
export function createMeshFromGeometry(
  name: string,
  dieKind: DieKind,
  scene: Scene,
  geometryData: DiceGeometryFile
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

  // Apply scaling from geometry data if available
  if (meshData.scaling) {
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
