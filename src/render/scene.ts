import {
  Engine,
  Scene,
  ArcRotateCamera,
  Animation,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  Light,
  SpotLight,
  ShadowGenerator,
  MeshBuilder,
  StandardMaterial,
  Color3,
  DynamicTexture,
  Texture,
  Color4,
  Layer,
} from "@babylonjs/core";
import { CubicEase } from '@babylonjs/core/Animations/easing';
import { registerCustomShaders } from "./shaders.js";
import { createOctagonMesh, calculatePlayerSeats, type PlayerSeat } from "./octagonGeometry.js";
import { PlayerSeatRenderer } from "./playerSeats.js";
import { cameraService, type CameraPosition } from "../services/cameraService.js";
import { settingsService } from "../services/settings.js";
import { particleService } from "../services/particleService.js";
import { resolveAssetUrl } from "../services/assetUrl.js";
import { logger } from "../utils/logger.js";

// Register custom shaders once at module load
registerCustomShaders();
const log = logger.create("GameScene");
const PLAYER_SEAT_DISTANCE_FROM_TABLE = 1.0;
const PLAYER_SEAT_ANGLE_OFFSET = Math.PI / 4; // Shift by one octagon segment
const ACTIVE_PLAYER_LIGHT_HEIGHT = 10.8;
const ACTIVE_PLAYER_LIGHT_OUTWARD_OFFSET = 2.6;
const ACTIVE_PLAYER_LIGHT_TRACKING_SMOOTHING = 0.14;
const ACTIVE_PLAYER_LIGHT_PULSE_SPEED = 0.0042;
const PLAY_SPOT_INNER_ANGLE_RATIO = 0.4;
const SCORE_SPOT_INNER_ANGLE_RATIO = 0.36;
const DICE_SPOT_INNER_ANGLE_RATIO = 0.33;
const ACTIVE_PLAYER_SPOT_INNER_ANGLE_RATIO = 0.28;
const CAMERA_MIN_RADIUS = 7;
const CAMERA_MAX_RADIUS = 85;
const CAMERA_MAX_BETA = Math.PI / 1.95;
const DIE_FOCUS_CAMERA_RADIUS = 9.2;
const DIE_FOCUS_CAMERA_BETA = 0.16;
const DIE_FOCUS_TARGET_Y_OFFSET = 0.2;
const DIE_FOCUS_CAMERA_TRANSITION_SECONDS = 0.38;
const DIE_FOCUS_CAMERA_SPEED_RATIO = 0.98; // 2% slower for a less abrupt assist move
const PLAYER_FOCUS_CAMERA_RADIUS = 24;
const PLAYER_FOCUS_CAMERA_BETA = 0.6;
const PLAYER_FOCUS_TARGET_Y_OFFSET = 0.4;
const PLAYER_FOCUS_CAMERA_TRANSITION_SECONDS = 0.48;
const CAMERA_RETURN_TRANSITION_SECONDS = 0.52;

type GameplayLightingScenario = "default" | "suspense" | "special_move" | "victory";

export class GameScene {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  shadowGenerator: ShadowGenerator;
  private defaultCameraState: { alpha: number; beta: number; radius: number };
  private ambientLight!: HemisphericLight;
  private sunLight!: DirectionalLight;
  private playSpotLight!: SpotLight;
  private scoreSpotLight!: SpotLight;
  private rimLight!: DirectionalLight;
  private diceSpotLights: SpotLight[] = [];
  private activePlayerSpotLight!: SpotLight;
  private activeTurnSeatForLighting: number | null = null;
  private activeLightPosition = new Vector3(0, 0, 0);
  private activeLightInitialized = false;
  private activeSpotBaseIntensity = 2.2;
  private lightingScenario: GameplayLightingScenario = "suspense";
  private scenarioResetTimer: ReturnType<typeof setTimeout> | null = null;
  private backgroundLayer: Layer | null = null;
  private backgroundGradientTexture: DynamicTexture | null = null;
  private readonly activeSeatLightingAnimator: () => void;

  // Octagon table properties for multiplayer future-proofing
  public playerSeats: PlayerSeat[]; // 8 player positions around octagon
  public readonly tableRadius: number = 22; // Octagon outer radius - increased for better dice scale
  public playerSeatRenderer: PlayerSeatRenderer; // Visual representation of player seats
  public readonly currentPlayerSeat: number = 0; // Current player's seat index (0-7)

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });

    this.scene = new Scene(this.engine);
    this.activeSeatLightingAnimator = () => {
      this.updateActiveSeatLighting();
    };

    // Create gradient background with atmospheric depth
    // Lighter at top (ceiling), darker at bottom (floor)
    this.scene.clearColor = new Color4(0, 0, 0, 0); // Transparent for gradient
    this.createGradientBackground();

    // Camera - optimized for larger octagon table view
    // Alpha: -Math.PI / 2 centers view on front edge
    // Beta: Math.PI / 3 provides good overhead angle
    // Radius: 38 gives full octagon visibility with proper dice scale
    this.camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      Math.PI / 3,
      38,
      new Vector3(0, 0, 0),
      this.scene
    );
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = CAMERA_MIN_RADIUS;
    this.camera.upperRadiusLimit = CAMERA_MAX_RADIUS;
    this.camera.lowerBetaLimit = 0.1;
    this.camera.upperBetaLimit = CAMERA_MAX_BETA;

    // Save default camera state
    this.defaultCameraState = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
    };

    // Lighting setup - brighter casino-style lighting with depth

    // Ambient base lighting - brighter overall illumination
    this.ambientLight = new HemisphericLight(
      "ambient",
      new Vector3(0, 1, 0),
      this.scene
    );
    this.ambientLight.intensity = 1.0; // Increased for brighter scene
    this.ambientLight.groundColor = new Color3(0.2, 0.2, 0.25); // Brighter ground reflection
    this.ambientLight.specular = new Color3(0.1, 0.1, 0.1); // Slight specular

    // Main directional light (overhead) - brighter
    this.sunLight = new DirectionalLight(
      "sun",
      new Vector3(-1, -2, -1),
      this.scene
    );
    this.sunLight.position = new Vector3(10, 25, 10);
    this.sunLight.intensity = 1.2; // Increased for better visibility
    this.sunLight.diffuse = new Color3(1.0, 0.98, 0.95); // Warm white
    this.sunLight.specular = new Color3(0.3, 0.3, 0.3); // Brighter specular highlights

    // Spotlight on play area - much brighter center focus
    this.playSpotLight = new SpotLight(
      "playSpot",
      new Vector3(0, 20, 0), // Higher position
      new Vector3(0, -1, 0),
      Math.PI / 2.35, // Wider cone + softer edge
      1.0,
      this.scene
    );
    this.playSpotLight.intensity = 1.2; // Doubled intensity
    this.playSpotLight.diffuse = new Color3(1, 0.98, 0.93); // Warm casino lighting
    this.playSpotLight.specular = new Color3(0.2, 0.2, 0.2);
    this.playSpotLight.falloffType = Light.FALLOFF_GLTF;
    this.playSpotLight.innerAngle = this.playSpotLight.angle * PLAY_SPOT_INNER_ANGLE_RATIO;

    // Spotlight on scored area - brighter
    this.scoreSpotLight = new SpotLight(
      "scoreSpot",
      new Vector3(9, 15, 0), // Adjusted for new score position
      new Vector3(0, -1, 0),
      Math.PI / 2.9, // Slightly wider cone for less hard cutoff
      1.05,
      this.scene
    );
    this.scoreSpotLight.intensity = 0.8; // Doubled
    this.scoreSpotLight.diffuse = new Color3(1, 0.98, 0.95); // Match main lighting
    this.scoreSpotLight.specular = new Color3(0.2, 0.2, 0.2);
    this.scoreSpotLight.falloffType = Light.FALLOFF_GLTF;
    this.scoreSpotLight.innerAngle = this.scoreSpotLight.angle * SCORE_SPOT_INNER_ANGLE_RATIO;

    // Rim light for depth (from behind/side) - brighter
    this.rimLight = new DirectionalLight(
      "rimLight",
      new Vector3(1, -1, 1),
      this.scene
    );
    this.rimLight.position = new Vector3(-15, 12, -10);
    this.rimLight.intensity = 0.6; // Doubled for better edge definition
    this.rimLight.diffuse = new Color3(0.9, 0.95, 1); // Cool rim light
    this.rimLight.specular = new Color3(0.2, 0.2, 0.25);

    // Dedicated dice spotlights - enhance dice readability on dark table
    const diceSpot1 = new SpotLight(
      "diceSpot1",
      new Vector3(-3, 18, -3), // Left-front elevated position
      new Vector3(0, -1, 0.1), // Slight forward tilt
      Math.PI / 3.1, // Slightly wider cone
      1.1, // Softer decay
      this.scene
    );
    diceSpot1.intensity = 1.5; // Strong, focused light
    diceSpot1.diffuse = new Color3(1.0, 0.98, 0.95); // Neutral white
    diceSpot1.specular = new Color3(0.4, 0.4, 0.4); // Strong specular for dice pips
    diceSpot1.falloffType = Light.FALLOFF_GLTF;
    diceSpot1.innerAngle = diceSpot1.angle * DICE_SPOT_INNER_ANGLE_RATIO;

    const diceSpot2 = new SpotLight(
      "diceSpot2",
      new Vector3(3, 18, 3), // Right-back elevated position
      new Vector3(0, -1, -0.1), // Slight backward tilt
      Math.PI / 3.1, // Slightly wider cone
      1.1, // Softer decay
      this.scene
    );
    diceSpot2.intensity = 1.5; // Strong, focused light
    diceSpot2.diffuse = new Color3(1.0, 0.98, 0.95); // Neutral white
    diceSpot2.specular = new Color3(0.4, 0.4, 0.4); // Strong specular for dice pips
    diceSpot2.falloffType = Light.FALLOFF_GLTF;
    diceSpot2.innerAngle = diceSpot2.angle * DICE_SPOT_INNER_ANGLE_RATIO;
    this.diceSpotLights = [diceSpot1, diceSpot2];

    // Focused spotlight that tracks the active player seat.
    this.activePlayerSpotLight = new SpotLight(
      "activePlayerSpot",
      new Vector3(0, ACTIVE_PLAYER_LIGHT_HEIGHT, 0),
      new Vector3(0, -1, 0),
      Math.PI / 5.8, // Wider cone to avoid harsh edge ring
      1.15,
      this.scene
    );
    this.activePlayerSpotLight.intensity = this.activeSpotBaseIntensity;
    this.activePlayerSpotLight.diffuse = new Color3(0.58, 1.0, 0.74);
    this.activePlayerSpotLight.specular = new Color3(0.26, 0.36, 0.26);
    this.activePlayerSpotLight.falloffType = Light.FALLOFF_GLTF;
    this.activePlayerSpotLight.innerAngle =
      this.activePlayerSpotLight.angle * ACTIVE_PLAYER_SPOT_INNER_ANGLE_RATIO;

    // Shadows - enhanced for better definition
    this.shadowGenerator = new ShadowGenerator(2048, this.sunLight); // Increased resolution
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurScale = 1.5; // Sharper edges (was 2)
    this.shadowGenerator.darkness = 0.5; // Darker shadows for better contrast

    // Calculate player seat positions (for future multiplayer)
    this.playerSeats = calculatePlayerSeats(
      this.tableRadius,
      PLAYER_SEAT_DISTANCE_FROM_TABLE,
      2,
      PLAYER_SEAT_ANGLE_OFFSET
    );

    // Create table/surface
    this.createTable();

    // Create player seat visualizations
    this.playerSeatRenderer = new PlayerSeatRenderer(this.scene);
    this.playerSeatRenderer.createPlayerSeats(this.playerSeats, this.currentPlayerSeat);
    this.playerSeatRenderer.highlightSeat(this.currentPlayerSeat);
    this.setActiveTurnSeat(this.currentPlayerSeat);
    this.setGameplayLightingScenario("suspense");
    this.scene.registerBeforeRender(this.activeSeatLightingAnimator);

    // Set up click handler for empty seats (will be passed from main.ts)
    // Callback will show "Multiplayer Coming Soon" notification

    // Render loop
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  private createTable() {
    // ============================================
    // OCTAGON TABLE - Future-proofed for 8-player multiplayer
    // ============================================

    // Create octagon base/frame (leather border)
    const table = createOctagonMesh(
      "table",
      { radius: this.tableRadius, height: 1.5 },
      this.scene
    );
    table.position.y = -1;
    table.receiveShadows = true;

    const mat = new StandardMaterial("tableMat", this.scene);

    // Load leather texture for table border
    const tableTexture = new Texture(
      resolveAssetUrl("assets/game-textures/leatherwrap_texture.jpg"),
      this.scene,
      undefined,
      true, // invertY for proper orientation
      undefined,
      () => {
        log.debug("Leather border texture loaded successfully");
      },
      (message, exception) => {
        log.warn("Failed to load leather border texture, using procedural fallback");
        log.warn("Leather border load error", message, exception);
        this.createFallbackBorderTexture(mat);
      }
    );

    // Configure UV mapping for octagon border
    tableTexture.uScale = 4.0; // Tile texture more to reduce stretching
    tableTexture.vScale = 2.0; // Tile vertically for better proportion
    tableTexture.wrapU = Texture.WRAP_ADDRESSMODE; // Tile around octagon
    tableTexture.wrapV = Texture.WRAP_ADDRESSMODE; // Tile vertically

    mat.diffuseTexture = tableTexture;
    mat.specularColor = new Color3(0.08, 0.06, 0.05); // Leather specular highlights
    mat.roughness = 0.85; // Matte leather finish
    table.material = mat;

    // ============================================
    // OCTAGON PLAY AREA - Center felt surface for dice rolling
    // Supports custom user-provided texture (future feature)
    // ============================================

    // Create octagon play area (slightly smaller than table for border effect)
    const playAreaRadius = this.tableRadius * 0.85; // 85% of table size
    const tray = createOctagonMesh(
      "tray",
      { radius: playAreaRadius, height: 0.5 },
      this.scene
    );
    tray.position = new Vector3(0, -0.25, 0);
    tray.receiveShadows = true;

    const trayMat = new StandardMaterial("trayMat", this.scene);

    // Load custom table felt texture
    // Custom octagon felt texture provided by user
    const trayTexture = new Texture(
      resolveAssetUrl("assets/game-textures/biscuits_felt_table_texture_darker.jpg"),
      this.scene,
      undefined,
      true, // invertY for proper orientation
      undefined,
      () => {
        // onLoad callback
        log.debug("Custom table texture loaded successfully");
      },
      (message, exception) => {
        // onError callback - fallback to procedural texture
        log.warn("Failed to load custom table texture, using procedural fallback");
        log.warn("Custom table texture load error", message, exception);
        this.createProceduralFeltTexture(trayMat);
      }
    );

    // Configure texture mapping
    // Perfect square texture (1024x1024) - no adjustments needed!
    trayTexture.uScale = 1.0;
    trayTexture.vScale = 1.0;
    trayTexture.uOffset = 0.0;
    trayTexture.vOffset = 0.0;
    trayTexture.wrapU = Texture.CLAMP_ADDRESSMODE; // Prevent tiling artifacts
    trayTexture.wrapV = Texture.CLAMP_ADDRESSMODE;

    trayMat.diffuseTexture = trayTexture;
    // Start with neutral "normal" contrast values - will be overridden by user settings
    trayMat.specularColor = new Color3(0.035, 0.035, 0.035);
    trayMat.roughness = 0.96;
    trayMat.diffuseColor = new Color3(1.0, 1.0, 1.0);
    trayMat.emissiveColor = new Color3(0.0, 0.0, 0.0);
    trayMat.ambientColor = new Color3(0.2, 0.2, 0.2);
    tray.material = trayMat;

    // ============================================
    // SCORED AREA - Separate zone for scored dice
    // Positioned to the right side, elevated slightly above play area
    // ============================================

    const scoredArea = MeshBuilder.CreateBox(
      "scoredArea",
      { width: 8, height: 0.4, depth: 10 },
      this.scene
    );
    scoredArea.position = new Vector3(11, -0.3, 0);
    scoredArea.receiveShadows = true;

    const scoredMat = new StandardMaterial("scoredMat", this.scene);

    // Create enhanced felt texture for scored area (darker)
    const scoredTexture = new DynamicTexture("scoredTexture", { width: 1024, height: 1024 }, this.scene, false);
    const scoredCtx = scoredTexture.getContext();

    // Base color with subtle radial gradient (darker than main tray)
    const scoredGradient = scoredCtx.createRadialGradient(512, 512, 200, 512, 512, 700);
    scoredGradient.addColorStop(0, "#18191d");
    scoredGradient.addColorStop(0.7, "#15161A");
    scoredGradient.addColorStop(1, "#121316");

    scoredCtx.fillStyle = scoredGradient;
    scoredCtx.fillRect(0, 0, 1024, 1024);

    // Add realistic felt fiber texture
    const scoredImageData = scoredCtx.getImageData(0, 0, 1024, 1024);
    const scoredData = scoredImageData.data;

    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) {
        const idx = (y * 1024 + x) * 4;

        // Multi-octave noise for felt texture
        const noise1 = Math.sin(x * 0.1 + y * 0.05 + 30) * 0.5 + 0.5;
        const noise2 = Math.sin(x * 0.3 + y * 0.2 + 80) * 0.5 + 0.5;
        const noise3 = Math.sin(x * 0.8 + y * 0.6 + 130) * 0.5 + 0.5;

        const fiberNoise = (Math.random() - 0.5) * 20;
        const combined = (noise1 * 7 + noise2 * 4 + noise3 * 2 + fiberNoise) * 0.5;

        scoredData[idx] += combined;
        scoredData[idx + 1] += combined;
        scoredData[idx + 2] += combined;
      }
    }

    scoredCtx.putImageData(scoredImageData, 0, 0);

    // Add subtle highlights for fabric weave effect
    for (let i = 0; i < 1500; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const size = Math.random() * 2 + 1;
      const brightness = Math.random() * 12 + 8;

      scoredCtx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.12)`;
      scoredCtx.fillRect(x, y, size, size * 0.5);
    }

    scoredTexture.update();

    scoredMat.diffuseTexture = scoredTexture;
    // Start with neutral "normal" contrast values - will be overridden by user settings
    scoredMat.specularColor = new Color3(0.035, 0.035, 0.035);
    scoredMat.roughness = 0.96;
    scoredMat.diffuseColor = new Color3(1.0, 1.0, 1.0);
    scoredMat.emissiveColor = new Color3(0.0, 0.0, 0.0);
    scoredMat.ambientColor = new Color3(0.2, 0.2, 0.2);
    scoredArea.material = scoredMat;
  }

  /**
   * Update table contrast level for better dice visibility
   * @param level - Contrast level: low (brighter table), normal (balanced), high (dark), maximum (darkest)
   */
  updateTableContrast(level: "low" | "normal" | "high" | "maximum"): void {
    // Define material properties for each contrast level
    // Uses emissive color (self-illumination) for dramatic, visible changes
    const contrastLevels = {
      low: {
        specular: 0.05,
        roughness: 0.95,
        diffuse: 1.0,
        emissive: 0.25,  // Bright glow - very visible
        ambient: 0.4     // Strong ambient response
      },
      normal: {
        specular: 0.035,
        roughness: 0.96,
        diffuse: 1.0,
        emissive: 0.0,   // No glow - baseline
        ambient: 0.2     // Normal ambient
      },
      high: {
        specular: 0.02,
        roughness: 0.98,
        diffuse: 0.75,   // Darker texture multiply
        emissive: 0.0,   // No glow
        ambient: 0.1     // Reduced ambient
      },
      maximum: {
        specular: 0.01,
        roughness: 0.99,
        diffuse: 0.5,    // Much darker texture multiply
        emissive: 0.0,   // No glow
        ambient: 0.05    // Minimal ambient
      }
    };

    const props = contrastLevels[level];

    // Update play area felt
    const tray = this.scene.getMeshByName("tray");
    if (tray && tray.material) {
      const trayMat = tray.material as StandardMaterial;
      trayMat.specularColor = new Color3(props.specular, props.specular, props.specular);
      trayMat.roughness = props.roughness;
      trayMat.diffuseColor = new Color3(props.diffuse, props.diffuse, props.diffuse);
      trayMat.emissiveColor = new Color3(props.emissive, props.emissive, props.emissive);
      trayMat.ambientColor = new Color3(props.ambient, props.ambient, props.ambient);
    }

    // Update scored area felt
    const scoredArea = this.scene.getMeshByName("scoredArea");
    if (scoredArea && scoredArea.material) {
      const scoredMat = scoredArea.material as StandardMaterial;
      scoredMat.specularColor = new Color3(props.specular, props.specular, props.specular);
      scoredMat.roughness = props.roughness;
      scoredMat.diffuseColor = new Color3(props.diffuse, props.diffuse, props.diffuse);
      scoredMat.emissiveColor = new Color3(props.emissive, props.emissive, props.emissive);
      scoredMat.ambientColor = new Color3(props.ambient, props.ambient, props.ambient);
    }
  }

  /**
   * Load custom felt texture for octagon play area
   * @param texturePath - Path or URL to custom texture image
   * Future feature: Allow users to upload custom octagon felt designs
   */
  loadCustomFeltTexture(texturePath: string): void {
    const tray = this.scene.getMeshByName("tray");
    if (!tray) return;

    const material = tray.material as StandardMaterial;
    if (!material) return;

    // Load and apply custom texture
    const customTexture = new Texture(texturePath, this.scene);
    material.diffuseTexture = customTexture;
    material.specularColor = new Color3(0.05, 0.05, 0.05);
    material.roughness = 0.95; // Maintain matte felt appearance
  }

  /**
   * Create fallback procedural leather texture for table border
   * Used when leather-border.png fails to load
   * @param material - Material to apply fallback texture to
   */
  private createFallbackBorderTexture(material: StandardMaterial): void {
    const texture = new DynamicTexture(
      "tableFallback",
      { width: 512, height: 512 },
      this.scene,
      false
    );
    const ctx = texture.getContext();

    // Create brown leather-like gradient
    const gradient = ctx.createRadialGradient(256, 256, 100, 256, 256, 400);
    gradient.addColorStop(0, "#3d2817"); // Lighter brown center
    gradient.addColorStop(0.7, "#2d1f12"); // Medium brown
    gradient.addColorStop(1, "#1f150c"); // Dark brown edges

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);

    // Add subtle leather grain noise
    const imageData = ctx.getImageData(0, 0, 512, 512);
    const data = imageData.data;

    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        const idx = (y * 512 + x) * 4;
        const noise = (Math.random() - 0.5) * 15; // Subtle grain
        data[idx] += noise;
        data[idx + 1] += noise;
        data[idx + 2] += noise;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    texture.update();

    material.diffuseTexture = texture;
    log.debug("Fallback leather texture created");
  }

  /**
   * Set active turn seat for both seat visuals and cinematic lighting.
   */
  setActiveTurnSeat(seatIndex: number | null): void {
    this.playerSeatRenderer?.setActiveTurnSeat(seatIndex);
    const normalizedSeat =
      typeof seatIndex === "number" && Number.isFinite(seatIndex)
        ? Math.floor(seatIndex)
        : null;
    const fallbackSeat = this.currentPlayerSeat;
    this.activeTurnSeatForLighting =
      normalizedSeat !== null &&
      normalizedSeat >= 0 &&
      normalizedSeat < this.playerSeats.length
        ? normalizedSeat
        : fallbackSeat;
  }

  /**
   * Apply a lighting scenario for ambience and gameplay feedback.
   */
  setGameplayLightingScenario(
    scenario: GameplayLightingScenario,
    options: { color?: Color3; durationMs?: number } = {}
  ): void {
    this.lightingScenario = scenario;
    if (this.scenarioResetTimer) {
      clearTimeout(this.scenarioResetTimer);
      this.scenarioResetTimer = null;
    }

    const profiles = {
      default: {
        ambient: 0.62,
        sun: 0.82,
        playSpot: 0.82,
        scoreSpot: 0.58,
        rim: 0.46,
        dice: 0.95,
        activeSpot: 2.0,
        activeColor: new Color3(0.52, 0.95, 0.7),
        activeSpecular: new Color3(0.24, 0.33, 0.24),
        bgTop: "#1f2a37",
        bgMid: "#131b25",
        bgBottom: "#06090f",
      },
      suspense: {
        ambient: 0.42,
        sun: 0.62,
        playSpot: 0.58,
        scoreSpot: 0.42,
        rim: 0.32,
        dice: 0.72,
        activeSpot: 2.32,
        activeColor: new Color3(0.56, 1.0, 0.72),
        activeSpecular: new Color3(0.28, 0.37, 0.28),
        bgTop: "#151e2a",
        bgMid: "#0b1018",
        bgBottom: "#020306",
      },
      special_move: {
        ambient: 0.36,
        sun: 0.54,
        playSpot: 0.48,
        scoreSpot: 0.38,
        rim: 0.28,
        dice: 0.62,
        activeSpot: 2.78,
        activeColor: new Color3(0.74, 0.54, 1.0),
        activeSpecular: new Color3(0.36, 0.3, 0.42),
        bgTop: "#1b1428",
        bgMid: "#120d1c",
        bgBottom: "#06040d",
      },
      victory: {
        ambient: 0.54,
        sun: 0.72,
        playSpot: 0.74,
        scoreSpot: 0.52,
        rim: 0.44,
        dice: 0.86,
        activeSpot: 2.92,
        activeColor: new Color3(1.0, 0.78, 0.34),
        activeSpecular: new Color3(0.44, 0.33, 0.2),
        bgTop: "#23190f",
        bgMid: "#151006",
        bgBottom: "#080502",
      },
    } as const;

    const profile = profiles[scenario];
    this.ambientLight.intensity = profile.ambient;
    this.sunLight.intensity = profile.sun;
    this.playSpotLight.intensity = profile.playSpot;
    this.scoreSpotLight.intensity = profile.scoreSpot;
    this.rimLight.intensity = profile.rim;
    this.diceSpotLights.forEach((light) => {
      light.intensity = profile.dice;
    });

    this.activeSpotBaseIntensity = profile.activeSpot;
    this.activePlayerSpotLight.diffuse = options.color ?? profile.activeColor;
    this.activePlayerSpotLight.specular = profile.activeSpecular;
    this.renderBackgroundGradient(profile.bgTop, profile.bgMid, profile.bgBottom);

    const durationMs =
      typeof options.durationMs === "number" && Number.isFinite(options.durationMs)
        ? Math.max(0, Math.floor(options.durationMs))
        : 0;
    if (durationMs > 0 && scenario !== "suspense") {
      this.scenarioResetTimer = setTimeout(() => {
        this.scenarioResetTimer = null;
        this.setGameplayLightingScenario("suspense");
      }, durationMs);
    }
  }

  triggerSpecialMoveLighting(
    color: Color3 = new Color3(0.7, 0.52, 1.0),
    durationMs: number = 1400
  ): void {
    this.setGameplayLightingScenario("special_move", { color, durationMs });
  }

  triggerVictoryLighting(durationMs: number = 2200): void {
    this.setGameplayLightingScenario("victory", { durationMs });
  }

  private updateActiveSeatLighting(): void {
    if (this.playerSeats.length === 0 || !this.activePlayerSpotLight) {
      return;
    }

    const activeSeatIndex =
      typeof this.activeTurnSeatForLighting === "number"
        ? this.activeTurnSeatForLighting
        : this.currentPlayerSeat;
    const seat = this.playerSeats[activeSeatIndex] ?? this.playerSeats[this.currentPlayerSeat];
    if (!seat) {
      return;
    }

    const target = new Vector3(seat.position.x, 1.9, seat.position.z);
    const outward = new Vector3(seat.position.x, 0, seat.position.z);
    if (outward.lengthSquared() < 0.0001) {
      outward.set(0, 0, 1);
    } else {
      outward.normalize();
    }

    const desiredPosition = new Vector3(
      target.x + outward.x * ACTIVE_PLAYER_LIGHT_OUTWARD_OFFSET,
      ACTIVE_PLAYER_LIGHT_HEIGHT,
      target.z + outward.z * ACTIVE_PLAYER_LIGHT_OUTWARD_OFFSET
    );

    if (!this.activeLightInitialized) {
      this.activeLightPosition.copyFrom(desiredPosition);
      this.activeLightInitialized = true;
    } else {
      this.activeLightPosition = Vector3.Lerp(
        this.activeLightPosition,
        desiredPosition,
        ACTIVE_PLAYER_LIGHT_TRACKING_SMOOTHING
      );
    }

    this.activePlayerSpotLight.position.copyFrom(this.activeLightPosition);
    const direction = target.subtract(this.activeLightPosition);
    if (direction.lengthSquared() > 0.0001) {
      this.activePlayerSpotLight.direction = direction.normalize();
    }

    const pulse = (Math.sin(Date.now() * ACTIVE_PLAYER_LIGHT_PULSE_SPEED) + 1) / 2;
    this.activePlayerSpotLight.intensity = this.activeSpotBaseIntensity * (0.9 + pulse * 0.22);
  }

  /**
   * Set callback for when empty player seats are clicked
   * @param callback - Function to call with seat index
   */
  setPlayerSeatClickHandler(callback: (seatIndex: number) => void): void {
    this.playerSeatRenderer?.onSeatClick(callback);
  }

  setCameraView(view: "default" | "top" | "side" | "front" | "debug") {
    switch (view) {
      case "top":
        // Top-down view
        this.camera.alpha = -Math.PI / 2;
        this.camera.beta = 0.1;
        this.camera.radius = 20;
        break;
      case "side":
        // Side view
        this.camera.alpha = 0;
        this.camera.beta = Math.PI / 2.5;
        this.camera.radius = 25;
        break;
      case "front":
        // Front view
        this.camera.alpha = -Math.PI / 2;
        this.camera.beta = Math.PI / 2.5;
        this.camera.radius = 25;
        break;
      case "debug":
        // Debug view - wide view to see all dice types
        this.camera.alpha = -Math.PI / 2;
        this.camera.beta = Math.PI / 4;
        this.camera.radius = 35;
        this.camera.target = new Vector3(0, 2, 0);
        break;
      case "default":
      default:
        // Reset to default view
        this.camera.alpha = this.defaultCameraState.alpha;
        this.camera.beta = this.defaultCameraState.beta;
        this.camera.radius = this.defaultCameraState.radius;
        this.camera.target = new Vector3(0, 0, 0);
        break;
    }
  }

  /**
   * Focus camera on a specific world point using a close top-down angle for reading die values.
   */
  focusCameraOnWorldPointTopDown(target: Vector3, animate: boolean = true): void {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) {
      return;
    }

    const clampedLowerRadius =
      typeof this.camera.lowerRadiusLimit === "number" && Number.isFinite(this.camera.lowerRadiusLimit)
        ? this.camera.lowerRadiusLimit
        : CAMERA_MIN_RADIUS;
    const targetRadius = Math.max(clampedLowerRadius, DIE_FOCUS_CAMERA_RADIUS);
    const targetBeta = Math.max(this.camera.lowerBetaLimit ?? 0.1, DIE_FOCUS_CAMERA_BETA);
    const focusTarget = target.clone();
    focusTarget.y += DIE_FOCUS_TARGET_Y_OFFSET;

    const focusPosition: CameraPosition = {
      id: "runtime-focus",
      name: "Runtime Focus",
      alpha: -Math.PI / 2,
      beta: targetBeta,
      radius: targetRadius,
      target: {
        x: focusTarget.x,
        y: focusTarget.y,
        z: focusTarget.z,
      },
      createdAt: Date.now(),
      isFavorite: false,
    };

    if (!animate) {
      this.camera.alpha = focusPosition.alpha;
      this.camera.beta = focusPosition.beta;
      this.camera.radius = focusPosition.radius;
      this.camera.target = new Vector3(
        focusPosition.target.x,
        focusPosition.target.y,
        focusPosition.target.z
      );
      return;
    }

    // Always animate die-focus camera moves so panning/zooming feels intentional,
    // even when saved-camera smooth transitions are disabled in settings.
    this.animateCameraTo(
      focusPosition,
      DIE_FOCUS_CAMERA_TRANSITION_SECONDS,
      DIE_FOCUS_CAMERA_SPEED_RATIO
    );
  }

  /**
   * Focus camera on a player seat with a wider, less top-down view.
   */
  focusCameraOnPlayerSeat(target: Vector3, animate: boolean = true): void {
    if (!target || !Number.isFinite(target.x) || !Number.isFinite(target.y) || !Number.isFinite(target.z)) {
      return;
    }

    const lowerRadius =
      typeof this.camera.lowerRadiusLimit === "number" && Number.isFinite(this.camera.lowerRadiusLimit)
        ? this.camera.lowerRadiusLimit
        : CAMERA_MIN_RADIUS;
    const upperRadius =
      typeof this.camera.upperRadiusLimit === "number" && Number.isFinite(this.camera.upperRadiusLimit)
        ? this.camera.upperRadiusLimit
        : CAMERA_MAX_RADIUS;
    const lowerBeta =
      typeof this.camera.lowerBetaLimit === "number" && Number.isFinite(this.camera.lowerBetaLimit)
        ? this.camera.lowerBetaLimit
        : 0.1;
    const upperBeta =
      typeof this.camera.upperBetaLimit === "number" && Number.isFinite(this.camera.upperBetaLimit)
        ? this.camera.upperBetaLimit
        : CAMERA_MAX_BETA;

    const targetRadius = Math.min(upperRadius, Math.max(lowerRadius, PLAYER_FOCUS_CAMERA_RADIUS));
    const targetBeta = Math.min(upperBeta, Math.max(lowerBeta, PLAYER_FOCUS_CAMERA_BETA));
    const focusTarget = target.clone();
    focusTarget.y += PLAYER_FOCUS_TARGET_Y_OFFSET;

    // Position the camera outside the seat ring so the table remains in-frame.
    const radial = new Vector3(focusTarget.x, 0, focusTarget.z);
    let alpha = this.camera.alpha;
    if (radial.lengthSquared() > 0.0001) {
      radial.normalize();
      alpha = Math.atan2(radial.z, radial.x);
    }

    const focusPosition: CameraPosition = {
      id: "runtime-seat-focus",
      name: "Runtime Seat Focus",
      alpha,
      beta: targetBeta,
      radius: targetRadius,
      target: {
        x: focusTarget.x,
        y: focusTarget.y,
        z: focusTarget.z,
      },
      createdAt: Date.now(),
      isFavorite: false,
    };

    if (!animate) {
      this.camera.alpha = focusPosition.alpha;
      this.camera.beta = focusPosition.beta;
      this.camera.radius = focusPosition.radius;
      this.camera.target = new Vector3(
        focusPosition.target.x,
        focusPosition.target.y,
        focusPosition.target.z
      );
      return;
    }

    this.animateCameraTo(focusPosition, PLAYER_FOCUS_CAMERA_TRANSITION_SECONDS);
  }

  /**
   * Return camera to the gameplay default overview position.
   */
  returnCameraToDefaultOverview(animate: boolean = true): void {
    const defaultPosition: CameraPosition = {
      id: "runtime-default-overview",
      name: "Runtime Default Overview",
      alpha: this.defaultCameraState.alpha,
      beta: this.defaultCameraState.beta,
      radius: this.defaultCameraState.radius,
      target: {
        x: 0,
        y: 0,
        z: 0,
      },
      createdAt: Date.now(),
      isFavorite: false,
    };

    if (!animate) {
      this.camera.alpha = defaultPosition.alpha;
      this.camera.beta = defaultPosition.beta;
      this.camera.radius = defaultPosition.radius;
      this.camera.target = new Vector3(
        defaultPosition.target.x,
        defaultPosition.target.y,
        defaultPosition.target.z
      );
      return;
    }

    // Use dedicated easing even when saved-camera smooth transitions are disabled.
    this.animateCameraTo(defaultPosition, CAMERA_RETURN_TRANSITION_SECONDS);
  }

  /**
   * Get current camera position
   * @returns Current camera state
   */
  getCameraPosition(): Omit<CameraPosition, 'id' | 'name' | 'createdAt' | 'isFavorite'> {
    return {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
      target: {
        x: this.camera.target.x,
        y: this.camera.target.y,
        z: this.camera.target.z,
      },
    };
  }

  /**
   * Set camera to a saved position
   * @param position Camera position to load
   * @param animate Whether to animate the transition (future feature)
   */
  setCameraPosition(position: CameraPosition, animate: boolean = false): void {
    const settings = settingsService.getSettings();
    const useSmooth = animate && settings.camera?.smoothTransitions;

    if (useSmooth) {
      // Animate alpha, beta, radius and target separately
      try {
        const durationSeconds = settings.camera?.transitionDuration ?? 0.75;
        this.animateCameraTo(position, durationSeconds);
        return;
      } catch (error) {
        // Fallback to instant assignment on any error
        log.warn("Camera animation failed, falling back to instant set", error);
      }
    }

    // Instant assignment
    this.camera.alpha = position.alpha;
    this.camera.beta = position.beta;
    this.camera.radius = position.radius;
    this.camera.target = new Vector3(position.target.x, position.target.y, position.target.z);
  }

  /**
   * Animate camera properties to target position using Babylon Animations
   */
  private animateCameraTo(
    position: CameraPosition,
    durationSeconds: number = 0.75,
    speedRatio: number = 1
  ) {
    const fps = 60;
    const frameCount = Math.max(1, Math.round(durationSeconds * fps));
    const safeSpeedRatio = Number.isFinite(speedRatio) && speedRatio > 0 ? speedRatio : 1;

    // Helper to create animation
    const createAnim = (property: string) => {
      const anim = new Animation(`camera_${property}_anim`, property, fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
      const keys = [
        { frame: 0, value: (this.camera as any)[property] },
        { frame: frameCount, value: (position as any)[property] },
      ];
      anim.setKeys(keys);
      const easing = new CubicEase();
      easing.setEasingMode(2); // EASEINOUT
      anim.setEasingFunction(easing);
      return anim;
    };

    // Alpha, beta, radius
    const alphaAnim = createAnim('alpha');
    const betaAnim = createAnim('beta');
    const radiusAnim = createAnim('radius');

    // Target (Vector3) animation - animate each component
    const targetX = new Animation('camera_target_x', 'target.x', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    targetX.setKeys([
      { frame: 0, value: this.camera.target.x },
      { frame: frameCount, value: position.target.x },
    ]);
    const targetY = new Animation('camera_target_y', 'target.y', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    targetY.setKeys([
      { frame: 0, value: this.camera.target.y },
      { frame: frameCount, value: position.target.y },
    ]);
    const targetZ = new Animation('camera_target_z', 'target.z', fps, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CONSTANT);
    targetZ.setKeys([
      { frame: 0, value: this.camera.target.z },
      { frame: frameCount, value: position.target.z },
    ]);

    // Apply animations
    try {
      this.camera.animations = [alphaAnim, betaAnim, radiusAnim, targetX, targetY, targetZ];
      this.scene.stopAnimation(this.camera);
      this.scene.beginAnimation(this.camera, 0, frameCount, false, safeSpeedRatio);
    } catch (error) {
      // Re-throw for upstream fallback
      throw error;
    }
  }

  /**
   * Save current camera position via Camera Service
   * @param name Name for the saved position
   * @returns Position ID or null if limit reached
   */
  saveCameraPosition(name: string): string | null {
    const current = this.getCameraPosition();
    return cameraService.savePosition(name, current);
  }

  /**
   * Load saved camera position by ID
   * @param id Position ID
   * @param animate Whether to animate (future feature)
   */
  loadCameraPosition(id: string, animate: boolean = false): void {
    const position = cameraService.loadPosition(id);
    if (position) {
      this.setCameraPosition(position, animate);
    }
  }

  /**
   * Create particle burst effect at a specific position
   * @deprecated Use particleService.emit() instead
   */
  createParticleBurst(position: Vector3, color: Color4 = new Color4(1, 0.8, 0, 1), count: number = 50) {
    // Determine effect based on color
    let effectId = "burst-gold"; // Default to gold

    if (color.g > 0.8) {
      effectId = "burst-white"; // Greenish = complete/perfect
    } else if (color.r > 0.9 && color.g < 0.3) {
      effectId = "burst-red"; // Red = bust/error
    }

    // Emit using ParticleService
    particleService.emit({
      effectId: effectId,
      position: position,
      options: {
        scale: count / 50, // Scale based on requested count
        networkSync: false,
      },
    });
  }

  /**
   * Create celebration effect for perfect roll or game complete
   */
  celebrateSuccess(type: "perfect" | "complete") {
    if (type === "complete") {
      this.triggerVictoryLighting(2400);
    } else {
      this.triggerSpecialMoveLighting(new Color3(0.88, 0.66, 1.0), 1600);
    }

    const intensity = particleService.getIntensity();

    // Minimal intensity: skip celebrations
    if (intensity === "minimal") {
      return;
    }

    const effectId = type === "perfect" ? "burst-white" : "burst-confetti";
    // Reduced base scales: perfect 1.2 (was 2.0), complete 1.0 (was 1.6)
    const baseScale = type === "complete" ? 1.0 : 1.2;

    // All positions for enthusiastic mode
    const allPositions = [
      new Vector3(-4, 1, 0),
      new Vector3(4, 1, 0),
      new Vector3(0, 1, -3),
      new Vector3(0, 1, 3),
    ];

    // Adjust burst count based on intensity
    let positions: Vector3[];
    if (intensity === "normal") {
      // Normal: 2 bursts for perfect, 3 for complete
      positions = type === "perfect"
        ? [allPositions[0], allPositions[1]] // Left and right
        : [allPositions[0], allPositions[1], allPositions[2]]; // Left, right, front
    } else {
      // Enthusiastic: all 4 bursts
      positions = allPositions;
    }

    positions.forEach((pos, i) => {
      setTimeout(() => {
        particleService.emit({
          effectId: effectId,
          position: pos,
          options: {
            scale: baseScale,
            networkSync: false,
          },
        });
      }, i * 100);
    });
  }

  /**
   * Create procedural felt texture as fallback if custom texture fails to load
   * Generates a realistic felt pattern with noise and highlights
   */
  private createProceduralFeltTexture(material: StandardMaterial): void {
    const trayTexture = new DynamicTexture("trayTextureFallback", { width: 1024, height: 1024 }, this.scene, false);
    const trayCtx = trayTexture.getContext();

    // Base color with subtle radial gradient
    const trayGradient = trayCtx.createRadialGradient(512, 512, 200, 512, 512, 700);
    trayGradient.addColorStop(0, "#1d1e22");
    trayGradient.addColorStop(0.7, "#1A1B1E");
    trayGradient.addColorStop(1, "#16171b");

    trayCtx.fillStyle = trayGradient;
    trayCtx.fillRect(0, 0, 1024, 1024);

    // Add realistic felt fiber texture with directional streaks
    const imageData = trayCtx.getImageData(0, 0, 1024, 1024);
    const data = imageData.data;

    // Create felt fiber pattern using Perlin-like noise
    for (let y = 0; y < 1024; y++) {
      for (let x = 0; x < 1024; x++) {
        const idx = (y * 1024 + x) * 4;

        // Multi-octave noise for felt texture
        const noise1 = Math.sin(x * 0.1 + y * 0.05) * 0.5 + 0.5;
        const noise2 = Math.sin(x * 0.3 + y * 0.2 + 50) * 0.5 + 0.5;
        const noise3 = Math.sin(x * 0.8 + y * 0.6 + 100) * 0.5 + 0.5;

        // Random fiber noise
        const fiberNoise = (Math.random() - 0.5) * 25;

        // Combine noise layers
        const combined = (noise1 * 8 + noise2 * 5 + noise3 * 3 + fiberNoise) * 0.5;

        // Apply to existing color
        data[idx] += combined;
        data[idx + 1] += combined;
        data[idx + 2] += combined;
      }
    }

    trayCtx.putImageData(imageData, 0, 0);

    // Add subtle highlights for fabric weave effect
    for (let i = 0; i < 2000; i++) {
      const x = Math.random() * 1024;
      const y = Math.random() * 1024;
      const size = Math.random() * 2 + 1;
      const brightness = Math.random() * 15 + 10;

      trayCtx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.15)`;
      trayCtx.fillRect(x, y, size, size * 0.5);
    }

    trayTexture.update();

    material.diffuseTexture = trayTexture;
    log.debug("Procedural felt texture applied as fallback");
  }

  private renderBackgroundGradient(top: string, middle: string, bottom: string): void {
    if (!this.backgroundGradientTexture) {
      return;
    }

    const ctx = this.backgroundGradientTexture.getContext() as CanvasRenderingContext2D;
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, top);
    gradient.addColorStop(0.45, middle);
    gradient.addColorStop(1, bottom);

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    this.backgroundGradientTexture.update();
  }

  /**
   * Create gradient background with atmospheric depth
   * Creates light-to-dark gradient from top to bottom
   */
  private createGradientBackground(): void {
    // Create dynamic texture for gradient
    this.backgroundGradientTexture = new DynamicTexture(
      "backgroundGradient",
      { width: 512, height: 512 },
      this.scene,
      false
    );

    // Create background layer
    this.backgroundLayer = new Layer(
      "backgroundLayer",
      null, // Pass null for imgUrl, assign texture directly instead
      this.scene,
      true
    );

    // Assign DynamicTexture to Layer's texture property
    this.backgroundLayer.texture = this.backgroundGradientTexture;
    this.backgroundLayer.isBackground = true;
    this.renderBackgroundGradient("#2a3545", "#1f2935", "#0a0f16");
  }

  dispose() {
    if (this.scenarioResetTimer) {
      clearTimeout(this.scenarioResetTimer);
      this.scenarioResetTimer = null;
    }
    this.scene.unregisterBeforeRender(this.activeSeatLightingAnimator);
    this.backgroundLayer?.dispose();
    this.backgroundLayer = null;
    this.backgroundGradientTexture?.dispose();
    this.backgroundGradientTexture = null;
    this.playerSeatRenderer?.dispose();
    this.engine.dispose();
  }
}
