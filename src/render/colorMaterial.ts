/**
 * Custom Color Material for BISCUITS dice themes
 *
 * Solves the color material transparency issue by properly blending:
 * - Solid base color (die body)
 * - Transparent RGBA texture (pips/numbers overlay)
 *
 * The shader mixes the base diffuse color with the texture based on texture alpha:
 * - Where texture alpha = 0 (transparent): show base color
 * - Where texture alpha = 1 (opaque): show texture color
 */

import { ShaderMaterial, Scene, Texture, Color3, Vector3, Effect } from "@babylonjs/core";

export interface ColorMaterialOptions {
  /** Base die color */
  baseColor: Color3;
  /** Diffuse texture (RGBA with pips/numbers) */
  diffuseTexture: Texture;
  /** Normal map texture */
  bumpTexture?: Texture;
  /** Bump/normal map intensity (0-2) */
  bumpLevel?: number;
  /** Specular texture */
  specularTexture?: Texture;
  /** Specular power/shininess (1-128) */
  specularPower?: number;
  /** Specular color */
  specularColor?: Color3;
  /** Ambient color for better visibility */
  ambientColor?: Color3;
  /** Emissive color for subtle glow */
  emissiveColor?: Color3;
}

/**
 * Create a custom shader material for color-based dice themes
 *
 * This material properly blends a solid base color with transparent RGBA textures,
 * allowing dice to have solid colored bodies with overlay pips/numbers.
 */
export function createColorMaterial(
  name: string,
  scene: Scene,
  options: ColorMaterialOptions
): ShaderMaterial {
  // Ensure shader source is registered before creating shader materials.
  // Without this, Babylon may try to fetch .fx files and get index.html in dev.
  ensureColorDiceShadersRegistered();

  // Set defines based on available textures
  const defines: string[] = [];
  if (options.bumpTexture) {
    defines.push("HAS_BUMP");
  }

  const material = new ShaderMaterial(
    name,
    scene,
    {
      vertex: "colorDice",
      fragment: "colorDice",
    },
    {
      attributes: ["position", "normal", "uv"],
      uniforms: [
        "world",
        "worldView",
        "worldViewProjection",
        "view",
        "projection",
        "baseColor",
        "lightPosition",
        "lightColor",
        "cameraPosition",
        "specularPower",
        "specularColor",
        "bumpLevel",
        "ambientColor",
        "emissiveColor",
      ],
      samplers: ["diffuseSampler", "bumpSampler", "specularSampler"],
      defines: defines,
    }
  );

  // Set uniforms
  material.setColor3("baseColor", options.baseColor);
  material.setFloat("specularPower", options.specularPower || 32);
  material.setColor3("specularColor", options.specularColor || new Color3(0.8, 0.8, 0.8));
  material.setFloat("bumpLevel", options.bumpLevel || 0.5);
  material.setColor3("ambientColor", options.ambientColor || new Color3(0.3, 0.3, 0.3));
  material.setColor3("emissiveColor", options.emissiveColor || new Color3(0.08, 0.08, 0.08));

  // Set textures
  material.setTexture("diffuseSampler", options.diffuseTexture);
  if (options.bumpTexture) {
    material.setTexture("bumpSampler", options.bumpTexture);
  }
  if (options.specularTexture) {
    material.setTexture("specularSampler", options.specularTexture);
  }

  // Set lighting from scene (use first light)
  const light = scene.lights[0];
  if (light) {
    // Get light position (different light types have different position properties)
    const lightPos = 'position' in light
      ? (light as any).position
      : new Vector3(0, 10, 0);
    material.setVector3("lightPosition", lightPos);
    material.setColor3("lightColor", light.diffuse);
  }

  // Update camera position each frame
  scene.registerBeforeRender(() => {
    if (scene.activeCamera) {
      material.setVector3("cameraPosition", scene.activeCamera.position);
    }
  });

  material.backFaceCulling = true;
  material.alphaMode = 2; // ALPHA_COMBINE

  return material;
}

/**
 * Define custom vertex shader
 * Standard vertex transformation with UV passthrough
 */
export const colorDiceVertexShader = `
precision highp float;

// Attributes
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;

// Uniforms
uniform mat4 worldViewProjection;
uniform mat4 world;
uniform mat4 worldView;

// Varyings
varying vec2 vUV;
varying vec3 vNormal;
varying vec3 vWorldPos;

void main(void) {
  gl_Position = worldViewProjection * vec4(position, 1.0);
  vUV = uv;
  vNormal = normalize((world * vec4(normal, 0.0)).xyz);
  vWorldPos = (world * vec4(position, 1.0)).xyz;
}
`;

/**
 * Define custom fragment shader
 * Blends base color with texture based on texture alpha
 */
export const colorDiceFragmentShader = `
precision highp float;

// Varyings
varying vec2 vUV;
varying vec3 vNormal;
varying vec3 vWorldPos;

// Uniforms
uniform vec3 baseColor;
uniform vec3 lightPosition;
uniform vec3 lightColor;
uniform vec3 cameraPosition;
uniform vec3 specularColor;
uniform float specularPower;
uniform float bumpLevel;
uniform vec3 ambientColor;
uniform vec3 emissiveColor;

// Samplers
uniform sampler2D diffuseSampler;
uniform sampler2D bumpSampler;
uniform sampler2D specularSampler;

void main(void) {
  // Sample the diffuse texture
  vec4 texColor = texture2D(diffuseSampler, vUV);

  // KEY BLENDING LOGIC:
  // Mix base color with texture color based on texture alpha
  // alpha = 0 (transparent) -> use baseColor (die body)
  // alpha = 1 (opaque) -> use texColor.rgb (pips/numbers)
  vec3 finalColor = mix(baseColor, texColor.rgb, texColor.a);

  // Calculate lighting
  vec3 normal = normalize(vNormal);

  // Apply normal map if available
  #ifdef HAS_BUMP
    vec3 normalMap = texture2D(bumpSampler, vUV).xyz * 2.0 - 1.0;
    normalMap.xy *= bumpLevel;
    normal = normalize(normal + normalMap);
  #endif

  // Diffuse lighting (Lambertian)
  vec3 lightDir = normalize(lightPosition - vWorldPos);
  float diffuse = max(dot(normal, lightDir), 0.0);
  vec3 diffuseLight = lightColor * diffuse;

  // Specular lighting (Blinn-Phong)
  vec3 viewDir = normalize(cameraPosition - vWorldPos);
  vec3 halfDir = normalize(lightDir + viewDir);
  float specular = pow(max(dot(normal, halfDir), 0.0), specularPower);
  vec3 specularLight = specularColor * specular;

  // Combine lighting with ambient and emissive
  vec3 lighting = ambientColor + diffuseLight;
  finalColor = finalColor * lighting + specularLight + emissiveColor;

  // Output final color (fully opaque)
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

let shadersRegistered = false;

function ensureColorDiceShadersRegistered(): void {
  if (shadersRegistered) {
    return;
  }

  Effect.ShadersStore["colorDiceVertexShader"] = colorDiceVertexShader;
  Effect.ShadersStore["colorDiceFragmentShader"] = colorDiceFragmentShader;
  shadersRegistered = true;
}
