import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  DirectionalLight,
  SpotLight,
  ShadowGenerator,
  MeshBuilder,
  StandardMaterial,
  Color3,
  DynamicTexture,
  ParticleSystem,
  Texture,
  Color4,
  Layer,
} from "@babylonjs/core";
import { registerCustomShaders } from "./shaders.js";
import { createOctagonMesh, calculatePlayerSeats, type PlayerSeat } from "./octagonGeometry.js";
import { PlayerSeatRenderer } from "./playerSeats.js";
import { cameraService, type CameraPosition } from "../services/cameraService.js";

// Register custom shaders once at module load
registerCustomShaders();

export class GameScene {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  shadowGenerator: ShadowGenerator;
  private defaultCameraState: { alpha: number; beta: number; radius: number };

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
    this.camera.lowerRadiusLimit = 25;
    this.camera.upperRadiusLimit = 60;
    this.camera.lowerBetaLimit = 0.1;
    this.camera.upperBetaLimit = Math.PI / 2.2;

    // Save default camera state
    this.defaultCameraState = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
    };

    // Lighting setup - brighter casino-style lighting with depth

    // Ambient base lighting - brighter overall illumination
    const ambient = new HemisphericLight(
      "ambient",
      new Vector3(0, 1, 0),
      this.scene
    );
    ambient.intensity = 1.0; // Increased for brighter scene
    ambient.groundColor = new Color3(0.2, 0.2, 0.25); // Brighter ground reflection
    ambient.specular = new Color3(0.1, 0.1, 0.1); // Slight specular

    // Main directional light (overhead) - brighter
    const sun = new DirectionalLight(
      "sun",
      new Vector3(-1, -2, -1),
      this.scene
    );
    sun.position = new Vector3(10, 25, 10);
    sun.intensity = 1.2; // Increased for better visibility
    sun.diffuse = new Color3(1.0, 0.98, 0.95); // Warm white
    sun.specular = new Color3(0.3, 0.3, 0.3); // Brighter specular highlights

    // Spotlight on play area - much brighter center focus
    const playSpot = new SpotLight(
      "playSpot",
      new Vector3(0, 20, 0), // Higher position
      new Vector3(0, -1, 0),
      Math.PI / 2.5, // Wider cone
      1.5,
      this.scene
    );
    playSpot.intensity = 1.2; // Doubled intensity
    playSpot.diffuse = new Color3(1, 0.98, 0.93); // Warm casino lighting
    playSpot.specular = new Color3(0.2, 0.2, 0.2);

    // Spotlight on scored area - brighter
    const scoreSpot = new SpotLight(
      "scoreSpot",
      new Vector3(9, 15, 0), // Adjusted for new score position
      new Vector3(0, -1, 0),
      Math.PI / 3,
      2,
      this.scene
    );
    scoreSpot.intensity = 0.8; // Doubled
    scoreSpot.diffuse = new Color3(1, 0.98, 0.95); // Match main lighting
    scoreSpot.specular = new Color3(0.2, 0.2, 0.2);

    // Rim light for depth (from behind/side) - brighter
    const rimLight = new DirectionalLight(
      "rimLight",
      new Vector3(1, -1, 1),
      this.scene
    );
    rimLight.position = new Vector3(-15, 12, -10);
    rimLight.intensity = 0.6; // Doubled for better edge definition
    rimLight.diffuse = new Color3(0.9, 0.95, 1); // Cool rim light
    rimLight.specular = new Color3(0.2, 0.2, 0.25);

    // Shadows
    this.shadowGenerator = new ShadowGenerator(1024, sun);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurScale = 2;

    // Calculate player seat positions (for future multiplayer)
    this.playerSeats = calculatePlayerSeats(this.tableRadius);

    // Create table/surface
    this.createTable();

    // Create player seat visualizations
    this.playerSeatRenderer = new PlayerSeatRenderer(this.scene);
    this.playerSeatRenderer.createPlayerSeats(this.playerSeats, this.currentPlayerSeat);
    this.playerSeatRenderer.highlightSeat(this.currentPlayerSeat);

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

    // Create octagon base/frame (wood outer ring)
    const table = createOctagonMesh(
      "table",
      { radius: this.tableRadius, height: 1 },
      this.scene
    );
    table.position.y = -1;
    table.receiveShadows = true;

    const mat = new StandardMaterial("tableMat", this.scene);

    // Create gradient texture for wooden table frame
    const tableTexture = new DynamicTexture("tableTexture", { width: 512, height: 512 }, this.scene, false);
    const ctx = tableTexture.getContext();

    // Create subtle radial gradient for wood table effect
    const gradient = ctx.createRadialGradient(256, 256, 100, 256, 256, 400);
    gradient.addColorStop(0, "#12301d"); // Slightly lighter center
    gradient.addColorStop(0.7, "#0E2A1A"); // Medium
    gradient.addColorStop(1, "#0c2416"); // Slightly darker edges

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    tableTexture.update();

    mat.diffuseTexture = tableTexture;
    mat.specularColor = new Color3(0.15, 0.15, 0.15);
    mat.roughness = 0.7;
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
      "/assets/textures/table-felt.png",
      this.scene,
      undefined,
      true, // invertY for proper orientation
      undefined,
      () => {
        // onLoad callback
        console.log("[Scene] Custom table texture loaded successfully");
      },
      (message, exception) => {
        // onError callback - fallback to procedural texture
        console.warn("[Scene] Failed to load custom table texture, using procedural fallback");
        console.warn("[Scene] Error:", message, exception);
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
    trayMat.specularColor = new Color3(0.05, 0.05, 0.05);
    trayMat.roughness = 0.95; // Matte felt
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
    scoredMat.specularColor = new Color3(0.05, 0.05, 0.05);
    scoredMat.roughness = 0.95;
    scoredArea.material = scoredMat;
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
    // TODO: Add smooth animation in Phase 2
    if (animate) {
      // Future: Implement smooth interpolation
      // For now, just instant transition
    }

    this.camera.alpha = position.alpha;
    this.camera.beta = position.beta;
    this.camera.radius = position.radius;
    this.camera.target = new Vector3(position.target.x, position.target.y, position.target.z);
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
   */
  createParticleBurst(position: Vector3, color: Color4 = new Color4(1, 0.8, 0, 1), count: number = 50) {
    const particles = new ParticleSystem("particles", count, this.scene);

    // Create a simple sphere for particle texture (procedural)
    particles.particleTexture = new Texture("https://assets.babylonjs.com/textures/flare.png", this.scene);

    // Emission
    particles.emitter = position;
    particles.minEmitBox = new Vector3(-0.2, 0, -0.2);
    particles.maxEmitBox = new Vector3(0.2, 0, 0.2);

    // Colors
    particles.color1 = color;
    particles.color2 = new Color4(color.r * 0.5, color.g * 0.5, color.b * 0.5, 1);
    particles.colorDead = new Color4(color.r * 0.2, color.g * 0.2, color.b * 0.2, 0);

    // Size
    particles.minSize = 0.3;
    particles.maxSize = 0.8;

    // Life time
    particles.minLifeTime = 0.5;
    particles.maxLifeTime = 1.0;

    // Emission rate
    particles.emitRate = count;
    particles.manualEmitCount = count;

    // Speed
    particles.minEmitPower = 3;
    particles.maxEmitPower = 6;
    particles.updateSpeed = 0.01;

    // Direction
    particles.direction1 = new Vector3(-1, 2, -1);
    particles.direction2 = new Vector3(1, 4, 1);

    // Gravity
    particles.gravity = new Vector3(0, -9.8, 0);

    // Start and stop
    particles.start();

    // Auto-dispose after 2 seconds
    setTimeout(() => {
      particles.stop();
      setTimeout(() => particles.dispose(), 1000);
    }, 100);
  }

  /**
   * Create celebration effect for perfect roll or game complete
   */
  celebrateSuccess(type: "perfect" | "complete") {
    const colors = {
      perfect: new Color4(1, 0.84, 0, 1), // Gold
      complete: new Color4(0.2, 1, 0.3, 1), // Green
    };

    const positions = [
      new Vector3(-4, 1, 0),
      new Vector3(4, 1, 0),
      new Vector3(0, 1, -3),
      new Vector3(0, 1, 3),
    ];

    positions.forEach((pos, i) => {
      setTimeout(() => {
        this.createParticleBurst(pos, colors[type], type === "complete" ? 80 : 50);
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
    console.log("[Scene] Procedural felt texture applied as fallback");
  }

  /**
   * Create gradient background with atmospheric depth
   * Creates light-to-dark gradient from top to bottom
   */
  private createGradientBackground(): void {
    // Create dynamic texture for gradient
    const gradientTexture = new DynamicTexture(
      "backgroundGradient",
      { width: 512, height: 512 },
      this.scene,
      false
    );

    const ctx = gradientTexture.getContext() as CanvasRenderingContext2D;

    // Create vertical gradient (top to bottom)
    const gradient = ctx.createLinearGradient(0, 0, 0, 512);

    // Top: Lighter atmospheric blue-gray (ceiling/sky)
    gradient.addColorStop(0, "#2a3545"); // Medium blue-gray
    gradient.addColorStop(0.3, "#1f2935"); // Darker
    gradient.addColorStop(0.6, "#151c26"); // Even darker
    gradient.addColorStop(1, "#0a0f16"); // Very dark at bottom (floor)

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 512, 512);
    gradientTexture.update();

    // Create background layer
    const backgroundLayer = new Layer(
      "backgroundLayer",
      null, // Pass null for imgUrl, assign texture directly instead
      this.scene,
      true
    );

    // Assign DynamicTexture to Layer's texture property
    backgroundLayer.texture = gradientTexture;
    backgroundLayer.isBackground = true;
  }

  dispose() {
    this.playerSeatRenderer?.dispose();
    this.engine.dispose();
  }
}
