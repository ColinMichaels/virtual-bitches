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
  Mesh,
  DynamicTexture,
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

    // Create gradient texture for felt
    const trayTexture = new DynamicTexture("trayTexture", { width: 512, height: 512 }, this.scene, false);
    const trayCtx = trayTexture.getContext();

    // Create very subtle radial gradient for felt depth
    const trayGradient = trayCtx.createRadialGradient(256, 256, 150, 256, 256, 400);
    trayGradient.addColorStop(0, "#1d1e22"); // Very slightly lighter center
    trayGradient.addColorStop(0.8, "#1A1B1E"); // Base color
    trayGradient.addColorStop(1, "#17181c"); // Slightly darker edges

    trayCtx.fillStyle = trayGradient;
    trayCtx.fillRect(0, 0, 512, 512);

    // Add subtle noise/texture for felt effect
    for (let i = 0; i < 5000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const brightness = Math.random() * 20 + 10;
      trayCtx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.1)`;
      trayCtx.fillRect(x, y, 1, 1);
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

    // Create gradient texture for scored area
    const scoredTexture = new DynamicTexture("scoredTexture", { width: 512, height: 512 }, this.scene, false);
    const scoredCtx = scoredTexture.getContext();

    // Create very subtle gradient for depth
    const scoredGradient = scoredCtx.createRadialGradient(256, 256, 150, 256, 256, 400);
    scoredGradient.addColorStop(0, "#18191d"); // Very slightly lighter center
    scoredGradient.addColorStop(0.8, "#15161A"); // Base color
    scoredGradient.addColorStop(1, "#131417"); // Slightly darker edges

    scoredCtx.fillStyle = scoredGradient;
    scoredCtx.fillRect(0, 0, 512, 512);

    // Add subtle noise/texture for felt effect
    for (let i = 0; i < 5000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const brightness = Math.random() * 15 + 8;
      scoredCtx.fillStyle = `rgba(${brightness}, ${brightness}, ${brightness}, 0.1)`;
      scoredCtx.fillRect(x, y, 1, 1);
    }

    scoredTexture.update();

    scoredMat.diffuseTexture = scoredTexture;
    scoredMat.specularColor = new Color3(0.05, 0.05, 0.05);
    scoredMat.roughness = 0.95;
    scoredArea.material = scoredMat;
  }

  setCameraView(view: "default" | "top" | "side" | "front") {
    const transitionSpeed = 0.5;

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

  dispose() {
    this.engine.dispose();
  }
}
