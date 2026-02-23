import { GameScene } from "./render/scene.js";
import { DiceRenderer } from "./render/dice.js";
import { HUD } from "./ui/hud.js";
import { DiceRow } from "./ui/diceRow.js";
import { SplashScreen } from "./ui/splash.js";
import { SettingsModal } from "./ui/settings.js";
import { LeaderboardModal } from "./ui/leaderboard.js";
import { RulesModal } from "./ui/rules.js";
import { notificationService } from "./ui/notifications.js";
import { createGame, reduce, generateShareURL, deserializeActions, replay } from "./game/state.js";
import { GameState, Action } from "./engine/types.js";
import { PointerEventTypes } from "@babylonjs/core";
import { audioService } from "./services/audio.js";
import { scoreHistoryService } from "./services/score-history.js";
import { environment } from "@env";

class Game {
  private state: GameState;
  private scene: GameScene;
  private diceRenderer: DiceRenderer;
  private hud: HUD;
  private diceRow: DiceRow;
  private animating = false;
  private paused = false;
  private settingsModal: SettingsModal;
  private leaderboardModal: LeaderboardModal;
  private gameStartTime: number;

  private actionBtn: HTMLButtonElement;
  private gameOverEl: HTMLElement;
  private finalScoreEl: HTMLElement;
  private shareLinkEl: HTMLElement;
  private newGameBtn: HTMLButtonElement;
  private viewLeaderboardBtn: HTMLButtonElement;
  private settingsGearBtn: HTMLButtonElement;

  constructor() {
    // Parse URL for replay
    const params = new URLSearchParams(window.location.search);
    const seed = params.get("seed") || this.generateSeed();
    const logEncoded = params.get("log");

    if (logEncoded) {
      // Replay mode
      const actions = deserializeActions(logEncoded);
      this.state = replay(seed, actions);
    } else {
      // New game
      this.state = createGame(seed);
    }

    // Initialize rendering
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    this.scene = new GameScene(canvas);
    this.diceRenderer = new DiceRenderer(this.scene.scene);
    this.hud = new HUD();
    this.diceRow = new DiceRow((dieId) => this.handleDieClick(dieId), this.diceRenderer);

    // UI elements
    this.actionBtn = document.getElementById("action-btn") as HTMLButtonElement;
    this.gameOverEl = document.getElementById("game-over")!;
    this.finalScoreEl = document.getElementById("final-score")!;
    this.shareLinkEl = document.getElementById("share-link")!;
    this.newGameBtn = document.getElementById("new-game-btn") as HTMLButtonElement;
    this.viewLeaderboardBtn = document.getElementById("view-leaderboard-btn") as HTMLButtonElement;
    this.settingsGearBtn = document.getElementById("settings-gear-btn") as HTMLButtonElement;

    // Initialize modals (shared with splash)
    this.settingsModal = settingsModal;
    this.leaderboardModal = leaderboardModal;

    // Handle settings modal close to unpause game
    this.settingsModal.setOnClose(() => {
      if (this.paused) {
        this.paused = false;
        notificationService.show("Resume!", "info");
        this.updateUI();
      }
    });

    // Handle new game request from settings
    this.settingsModal.setOnNewGame(() => {
      this.startNewGame();
    });

    this.setupControls();
    this.setupDiceSelection();
    this.initializeAudio();
    this.updateUI();

    // Track game start time
    this.gameStartTime = Date.now();
  }

  private async initializeAudio() {
    // Initialize audio on first user interaction
    const initAudio = async () => {
      if (!audioService.isInitialized()) {
        await audioService.initialize();
        // Start background music
        await audioService.playMusic();
      }
    };

    // Listen for any user interaction to initialize audio
    const events = ["click", "keydown", "touchstart"];
    const handler = async () => {
      await initAudio();
      events.forEach((event) => document.removeEventListener(event, handler));
    };

    events.forEach((event) => document.addEventListener(event, handler, { once: true }));
  }

  private generateSeed(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  private setupControls() {
    // Multipurpose action button - handles both roll and score
    this.actionBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      this.handleAction();
    });

    this.newGameBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      this.handleNewGame();
    });

    this.viewLeaderboardBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      this.leaderboardModal.show();
    });

    // Settings gear button
    this.settingsGearBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      this.togglePause();
    });

    // Camera controls
    const cameraButtons = document.querySelectorAll(".camera-btn");
    cameraButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        audioService.playSfx("click");
        const view = btn.getAttribute("data-view") as "default" | "top" | "side" | "front";
        this.scene.setCameraView(view);
      });
    });

    // Keyboard shortcuts
    window.addEventListener("keydown", (e) => {
      // ESC key - toggle pause/settings
      if (e.code === "Escape") {
        e.preventDefault();
        this.togglePause();
      }

      // Space key - multipurpose action (roll or score)
      if (e.code === "Space" && !this.animating && !this.paused) {
        e.preventDefault();
        this.handleAction();
      }
    });
  }

  private togglePause() {
    this.paused = !this.paused;

    if (this.paused) {
      notificationService.show("Paused", "info");
      this.settingsModal.show();
    } else {
      notificationService.show("Resume!", "info");
      this.settingsModal.hide();
    }

    this.updateUI();
  }

  private setupDiceSelection() {
    this.scene.scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type === PointerEventTypes.POINTERDOWN) {
        const pickInfo = pointerInfo.pickInfo;
        if (pickInfo?.hit && pickInfo.pickedMesh) {
          const dieId = pickInfo.pickedMesh.name;
          this.handleDieClick(dieId);
        }
      }
    });
  }

  private handleDieClick(dieId: string) {
    const die = this.state.dice.find((d) => d.id === dieId);

    // Invalid action reminders
    if (this.state.status === "READY") {
      notificationService.show("Roll First!", "warning");
      audioService.playSfx("click");
      return;
    }

    if (this.state.status === "COMPLETE") {
      notificationService.show("Game Over!", "warning");
      audioService.playSfx("click");
      return;
    }

    if (die && die.inPlay && !die.scored && this.state.status === "ROLLED") {
      audioService.playSfx("select");
      this.dispatch({ t: "TOGGLE_SELECT", dieId });
    }
  }

  private dispatch(action: Action) {
    const prevState = this.state;
    this.state = reduce(this.state, action);

    // Update selection visuals
    if (action.t === "TOGGLE_SELECT") {
      this.diceRenderer.setSelected(
        action.dieId,
        this.state.selected.has(action.dieId)
      );
    }

    this.updateUI();

    // Check for game complete
    if (prevState.status !== "COMPLETE" && this.state.status === "COMPLETE") {
      this.showGameOver();
    }
  }

  private handleAction() {
    if (this.paused || this.animating) return;

    if (this.state.status === "READY") {
      this.handleRoll();
    } else if (this.state.status === "ROLLED" && this.state.selected.size > 0) {
      this.handleScore();
    }
  }

  private handleRoll() {
    if (this.paused) return;

    // Invalid action reminder
    if (this.state.status === "ROLLED") {
      notificationService.show("Score Dice First!", "warning");
      return;
    }

    if (this.animating || this.state.status !== "READY") return;

    this.animating = true;
    this.dispatch({ t: "ROLL" });

    // Play roll sound
    audioService.playSfx("roll");

    this.diceRenderer.animateRoll(this.state.dice, () => {
      this.animating = false;
      this.updateUI();

      // Show notification after roll completes
      notificationService.show("Roll Complete!", "info");
    });
  }

  private handleScore() {
    if (this.paused) return;

    if (this.animating || this.state.status !== "ROLLED" || this.state.selected.size === 0) {
      return;
    }

    this.animating = true;
    const selected = new Set(this.state.selected);

    // Calculate points for notification
    const scoredDice = this.state.dice.filter((d) => selected.has(d.id));
    const points = scoredDice.reduce((sum, die) => sum + (die.def.sides - die.value), 0);

    // Play score sound
    audioService.playSfx("score");

    this.diceRenderer.animateScore(this.state.dice, selected, () => {
      this.animating = false;
      this.updateUI();

      // Show score notification
      notificationService.show(`+${points} Points!`, "success");
    });

    this.dispatch({ t: "SCORE_SELECTED" });
  }

  private handleNewGame() {
    // Hide game over screen
    this.gameOverEl.classList.remove("show");

    // Create new game state with new seed
    const seed = this.generateSeed();
    this.state = createGame(seed);

    // Clear all dice from renderer
    this.diceRenderer.clearDice();

    // Reset animating flag and game start time
    this.animating = false;
    this.gameStartTime = Date.now();

    // Update UI to reflect new game
    this.updateUI();

    // Show notification
    notificationService.show("New Game!", "success");
  }

  private startNewGame() {
    // Unpause if paused
    if (this.paused) {
      this.paused = false;
    }

    // Hide game over screen
    this.gameOverEl.classList.remove("show");

    // Create new game state with new seed
    const seed = this.generateSeed();
    this.state = createGame(seed);

    // Clear all dice from renderer
    this.diceRenderer.clearDice();

    // Reset animating flag and game start time
    this.animating = false;
    this.gameStartTime = Date.now();

    // Update UI to reflect new game
    this.updateUI();

    // Show notification
    notificationService.show("New Game Started!", "success");
  }

  private updateUI() {
    this.hud.update(this.state);
    this.diceRow.update(this.state);

    // Update multipurpose action button
    if (this.state.status === "READY") {
      this.actionBtn.textContent = "Roll Dice (Space)";
      this.actionBtn.disabled = this.animating || this.paused;
      this.actionBtn.className = "primary";
    } else if (this.state.status === "ROLLED") {
      const hasSelection = this.state.selected.size > 0;
      if (hasSelection) {
        // Calculate points for button text
        const scoredDice = this.state.dice.filter((d) => this.state.selected.has(d.id));
        const points = scoredDice.reduce((sum, die) => sum + (die.def.sides - die.value), 0);
        this.actionBtn.textContent = `Score +${points} (Space)`;
        this.actionBtn.disabled = this.animating || this.paused;
        this.actionBtn.className = "primary";
      } else {
        this.actionBtn.textContent = "Select Dice to Score";
        this.actionBtn.disabled = true;
        this.actionBtn.className = "";
      }
    } else {
      this.actionBtn.disabled = true;
    }
  }

  private showGameOver() {
    // Play game over sound
    audioService.playSfx("gameOver");

    // Calculate game duration
    const gameDuration = Date.now() - this.gameStartTime;

    // Save score to history
    const savedScore = scoreHistoryService.saveScore(
      this.state.score,
      this.state.seed,
      this.state.actionLog,
      gameDuration,
      this.state.rollIndex
    );

    // Get rank
    const rank = scoreHistoryService.getRank(this.state.score);

    // Show game over notification
    notificationService.show(`Final Score: ${this.state.score}`, "success");

    this.finalScoreEl.textContent = this.state.score.toString();
    const shareURL = generateShareURL(this.state);
    this.shareLinkEl.textContent = shareURL;

    // Setup seed action buttons
    this.setupSeedActions(shareURL);

    this.gameOverEl.classList.add("show");

    if (environment.debug) {
      console.log("Game Over - Score saved:", savedScore);
      console.log("Your rank:", rank);
    }
  }

  private setupSeedActions(shareURL: string) {
    const copyBtn = document.getElementById("copy-seed-btn");
    const downloadBtn = document.getElementById("download-seed-btn");

    if (copyBtn) {
      copyBtn.onclick = () => {
        audioService.playSfx("click");
        navigator.clipboard.writeText(shareURL).then(() => {
          notificationService.show("Seed copied to clipboard!", "success");
        }).catch(() => {
          notificationService.show("Failed to copy seed", "error");
        });
      };
    }

    if (downloadBtn) {
      downloadBtn.onclick = () => {
        audioService.playSfx("click");
        const blob = new Blob([shareURL], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `biscuits-seed-${this.state.score}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        notificationService.show("Seed downloaded!", "success");
      };
    }
  }
}

// Initialize modals (shared across screens)
const settingsModal = new SettingsModal();
const leaderboardModal = new LeaderboardModal();
const rulesModal = new RulesModal();

// Show splash screen first
const splash = new SplashScreen(
  () => {
    // On start game
    new Game();
  },
  () => {
    // On settings
    settingsModal.show();
  },
  () => {
    // On leaderboard
    leaderboardModal.show();
  },
  () => {
    // On rules
    rulesModal.show();
  }
);
