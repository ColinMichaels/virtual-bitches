/**
 * Octagon geometry utilities for multiplayer-ready game board
 * Provides helpers for creating octagon mesh and calculating player seat positions
 */

import { Vector3, VertexData, Mesh, Scene } from "@babylonjs/core";

/**
 * Configuration for octagon table geometry
 */
export interface OctagonConfig {
  /** Radius from center to vertex (outer radius) */
  radius: number;
  /** Height/thickness of the table */
  height: number;
  /** Inner play area radius (for dice rolling zone) */
  playAreaRadius?: number;
}

/**
 * Player seat position around the octagon
 */
export interface PlayerSeat {
  /** Seat number (0-7) */
  index: number;
  /** 3D position of seat (for future avatar placement) */
  position: Vector3;
  /** Rotation angle in radians */
  angle: number;
  /** Forward direction vector (toward table center) */
  forward: Vector3;
}

/**
 * Calculate octagon vertex positions
 * @param radius - Distance from center to vertex
 * @param y - Y coordinate (height)
 * @returns Array of 8 Vector3 positions
 */
export function getOctagonVertices(radius: number, y: number = 0): Vector3[] {
  const vertices: Vector3[] = [];
  const angleStep = (Math.PI * 2) / 8; // 45 degrees

  for (let i = 0; i < 8; i++) {
    const angle = angleStep * i;
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);
    vertices.push(new Vector3(x, y, z));
  }

  return vertices;
}

/**
 * Calculate the 8 player seat positions around the octagon
 * Positions are slightly outside the table radius for avatar placement
 * @param tableRadius - Radius of the octagon table
 * @param seatDistance - Additional distance from table edge (default: 3 units)
 * @param height - Y coordinate for seat position (default: 2 units)
 * @param angleOffset - Rotation offset for the seat ring in radians (default: 0)
 * @returns Array of 8 PlayerSeat objects
 */
export function calculatePlayerSeats(
  tableRadius: number,
  seatDistance: number = 3,
  height: number = 2,
  angleOffset: number = 0
): PlayerSeat[] {
  const seats: PlayerSeat[] = [];
  const angleStep = (Math.PI * 2) / 8; // 45 degrees
  const totalRadius = tableRadius + seatDistance;

  for (let i = 0; i < 8; i++) {
    const angle = angleStep * i + angleOffset;
    const x = totalRadius * Math.cos(angle);
    const z = totalRadius * Math.sin(angle);

    // Forward vector points toward table center
    const forward = new Vector3(-Math.cos(angle), 0, -Math.sin(angle));

    seats.push({
      index: i,
      position: new Vector3(x, height, z),
      angle: angle,
      forward: forward.normalize(),
    });
  }

  return seats;
}

/**
 * Create octagon mesh with proper UV mapping
 * @param name - Mesh name
 * @param config - Octagon configuration
 * @param scene - BabylonJS scene
 * @returns Created mesh
 */
export function createOctagonMesh(
  name: string,
  config: OctagonConfig,
  scene: Scene
): Mesh {
  const { radius, height } = config;

  // Get top and bottom vertices
  const topVertices = getOctagonVertices(radius, height / 2);
  const bottomVertices = getOctagonVertices(radius, -height / 2);

  // Build vertex data
  const positions: number[] = [];
  const indices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  // Top face (octagon)
  const topCenter = new Vector3(0, height / 2, 0);
  positions.push(topCenter.x, topCenter.y, topCenter.z);
  uvs.push(0.5, 0.5); // Center UV

  topVertices.forEach((v, i) => {
    positions.push(v.x, v.y, v.z);
    // Radial UV mapping for top face
    const angle = (Math.PI * 2 * i) / 8;
    uvs.push(0.5 + 0.5 * Math.cos(angle), 0.5 + 0.5 * Math.sin(angle));
  });

  // Top face indices (triangle fan from center)
  for (let i = 1; i <= 8; i++) {
    indices.push(0, i, (i % 8) + 1);
  }

  // Bottom face (octagon)
  const vertexOffset = positions.length / 3;
  const bottomCenter = new Vector3(0, -height / 2, 0);
  positions.push(bottomCenter.x, bottomCenter.y, bottomCenter.z);
  uvs.push(0.5, 0.5);

  bottomVertices.forEach((v, i) => {
    positions.push(v.x, v.y, v.z);
    const angle = (Math.PI * 2 * i) / 8;
    uvs.push(0.5 + 0.5 * Math.cos(angle), 0.5 + 0.5 * Math.sin(angle));
  });

  // Bottom face indices (reversed winding for correct normal)
  for (let i = 1; i <= 8; i++) {
    indices.push(
      vertexOffset,
      vertexOffset + ((i % 8) + 1),
      vertexOffset + i
    );
  }

  // Side faces (8 rectangular faces)
  const sideOffset = positions.length / 3;
  for (let i = 0; i < 8; i++) {
    const topA = topVertices[i];
    const topB = topVertices[(i + 1) % 8];
    const bottomA = bottomVertices[i];
    const bottomB = bottomVertices[(i + 1) % 8];

    const baseIdx = sideOffset + i * 4;

    // Add 4 vertices for this side face
    positions.push(topA.x, topA.y, topA.z);
    positions.push(topB.x, topB.y, topB.z);
    positions.push(bottomB.x, bottomB.y, bottomB.z);
    positions.push(bottomA.x, bottomA.y, bottomA.z);

    // UV mapping for side face
    uvs.push(0, 1, 1, 1, 1, 0, 0, 0);

    // Two triangles per side face
    indices.push(baseIdx, baseIdx + 1, baseIdx + 2);
    indices.push(baseIdx, baseIdx + 2, baseIdx + 3);
  }

  // Create vertex data
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.indices = indices;
  vertexData.uvs = uvs;

  // Calculate normals automatically
  VertexData.ComputeNormals(positions, indices, normals);
  vertexData.normals = normals;

  // Create and apply to mesh
  const mesh = new Mesh(name, scene);
  vertexData.applyToMesh(mesh);

  return mesh;
}

/**
 * Get play area boundary radius for dice collision detection
 * Uses inscribed circle radius (apothem) of the octagon
 * @param octagonRadius - Outer radius of octagon
 * @returns Inner radius safe for dice rolling
 */
export function getPlayAreaRadius(octagonRadius: number): number {
  // Apothem (inner radius) = radius * cos(π/8)
  return octagonRadius * Math.cos(Math.PI / 8) * 0.85; // 85% safety margin
}
