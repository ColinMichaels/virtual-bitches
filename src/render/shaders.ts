/**
 * Shader registration for BISCUITS custom materials
 * Registers custom GLSL shaders with BabylonJS
 */

import { Effect } from "@babylonjs/core";
import { colorDiceVertexShader, colorDiceFragmentShader } from "./colorMaterial.js";

/**
 * Register all custom shaders with BabylonJS
 * Call this once at application startup
 */
export function registerCustomShaders(): void {
  // Register color dice vertex shader
  Effect.ShadersStore["colorDiceVertexShader"] = colorDiceVertexShader;

  // Register color dice fragment shader
  Effect.ShadersStore["colorDiceFragmentShader"] = colorDiceFragmentShader;
}
