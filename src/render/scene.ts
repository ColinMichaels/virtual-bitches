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
} from "@babylonjs/core";

export class GameScene {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  shadowGenerator: ShadowGenerator;
  private defaultCameraState: { alpha: number; beta: number; radius: number };

  constructor(canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });

    this.scene = new Scene(this.engine);
    this.scene.clearColor = new Color3(0.1, 0.1, 0.18).toColor4();

    // Camera
    this.camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      Math.PI / 3,
      25,
      new Vector3(0, 0, 0),
      this.scene
    );
    this.camera.attachControl(canvas, true);
    this.camera.lowerRadiusLimit = 15;
    this.camera.upperRadiusLimit = 40;
    this.camera.lowerBetaLimit = 0.1;
    this.camera.upperBetaLimit = Math.PI / 2.2;

    // Save default camera state
    this.defaultCameraState = {
      alpha: this.camera.alpha,
      beta: this.camera.beta,
      radius: this.camera.radius,
    };

    // Lighting setup for better depth and dimension

    // Ambient base lighting
    const ambient = new HemisphericLight(
      "ambient",
      new Vector3(0, 1, 0),
      this.scene
    );
    ambient.intensity = 0.6; // Reduced for more dramatic lighting
    ambient.groundColor = new Color3(0.1, 0.1, 0.15); // Slight blue tint from below
    ambient.specular = new Color3(0, 0, 0); // No specular from ambient

    // Main directional light (sun/overhead)
    const sun = new DirectionalLight(
      "sun",
      new Vector3(-1, -2, -1),
      this.scene
    );
    sun.position = new Vector3(10, 20, 10);
    sun.intensity = 0.8; // Reduced to make spots more visible
    sun.specular = new Color3(0.2, 0.2, 0.2); // Reduced specular

    // Spotlight on play area - center focus
    const playSpot = new SpotLight(
      "playSpot",
      new Vector3(0, 15, 0),
      new Vector3(0, -1, 0),
      Math.PI / 3,
      2,
      this.scene
    );
    playSpot.intensity = 0.6;
    playSpot.diffuse = new Color3(1, 0.98, 0.95); // Warm white
    playSpot.specular = new Color3(0.1, 0.1, 0.1); // Minimal specular

    // Spotlight on scored area
    const scoreSpot = new SpotLight(
      "scoreSpot",
      new Vector3(11, 12, 0),
      new Vector3(0, -1, 0),
      Math.PI / 4,
      3,
      this.scene
    );
    scoreSpot.intensity = 0.4;
    scoreSpot.diffuse = new Color3(0.9, 0.95, 1); // Cool white
    scoreSpot.specular = new Color3(0.1, 0.1, 0.1); // Minimal specular

    // Rim light for depth (from behind/side)
    const rimLight = new DirectionalLight(
      "rimLight",
      new Vector3(1, -1, 1),
      this.scene
    );
    rimLight.position = new Vector3(-15, 10, -10);
    rimLight.intensity = 0.3;
    rimLight.specular = new Color3(0.15, 0.15, 0.2); // Reduced specular

    // Shadows
    this.shadowGenerator = new ShadowGenerator(1024, sun);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurScale = 2;

    // Create table/surface
    this.createTable();

    // Render loop
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }

  private createTable() {
    const table = MeshBuilder.CreateBox(
      "table",
      { width: 30, height: 1, depth: 20 },
      this.scene
    );
    table.position.y = -1;
    table.receiveShadows = true;

    const mat = new StandardMaterial("tableMat", this.scene);

    // Create gradient texture for table
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

    // Dice tray (play area) - dark charcoal felt with gradient
    const tray = MeshBuilder.CreateBox(
      "tray",
      { width: 18, height: 0.5, depth: 12 },
      this.scene
    );
    tray.position = new Vector3(0, -0.25, 0);
    tray.receiveShadows = true;

    const trayMat = new StandardMaterial("trayMat", this.scene);

    // Create enhanced felt texture
    const trayTexture = new DynamicTexture("trayTexture", { width: 1024, height: 1024 }, this.scene, false);
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

    trayMat.diffuseTexture = trayTexture;
    trayMat.specularColor = new Color3(0.05, 0.05, 0.05);
    trayMat.roughness = 0.95; // Matte felt
    tray.material = trayMat;

    // Scored area (right side) - darker felt with gradient
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

  setCameraView(view: "default" | "top" | "side" | "front") {
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
      case "default":
      default:
        // Reset to default view
        this.camera.alpha = this.defaultCameraState.alpha;
        this.camera.beta = this.defaultCameraState.beta;
        this.camera.radius = this.defaultCameraState.radius;
        break;
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

  dispose() {
    this.engine.dispose();
  }
}
