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
import { settingsService } from "./services/settings.js";

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
  private selectedDieIndex = 0; // For keyboard navigation

  private actionBtn: HTMLButtonElement;
  private deselectBtn: HTMLButtonElement;
  private gameOverEl: HTMLElement;
  private finalScoreEl: HTMLElement;
  private shareLinkEl: HTMLElement;
  private newGameBtn: HTMLButtonElement;
  private viewLeaderboardBtn: HTMLButtonElement;
  private settingsGearBtn: HTMLButtonElement;
  private leaderboardBtn: HTMLButtonElement;

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
    this.deselectBtn = document.getElementById("deselect-btn") as HTMLButtonElement;
    this.gameOverEl = document.getElementById("game-over")!;
    this.finalScoreEl = document.getElementById("final-score")!;
    this.shareLinkEl = document.getElementById("share-link")!;
    this.newGameBtn = document.getElementById("new-game-btn") as HTMLButtonElement;
    this.viewLeaderboardBtn = document.getElementById("view-leaderboard-btn") as HTMLButtonElement;
    this.settingsGearBtn = document.getElementById("settings-gear-btn") as HTMLButtonElement;

    this.leaderboardBtn = document.getElementById("leaderboard-btn") as HTMLButtonElement;

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

    // Handle How to Play button in settings
    this.settingsModal.setOnHowToPlay(() => {
      rulesModal.show();
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

    // Deselect all button
    this.deselectBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      this.handleDeselectAll();
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

    // Leaderboard button
    this.leaderboardBtn.addEventListener("click", () => {
      audioService.playSfx("click");
      this.leaderboardModal.show();
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
      // ESC key - close modals or toggle pause/settings
      if (e.code === "Escape") {
        e.preventDefault();

        // Check if any modal is open and close it first
        if (rulesModal.isVisible()) {
          rulesModal.hide();
        } else if (this.leaderboardModal.isVisible()) {
          this.leaderboardModal.hide();
        } else {
          // No other modals open, toggle settings/pause
          this.togglePause();
        }
      }

      // Space key - multipurpose action (roll or score)
      if (e.code === "Space" && !this.animating && !this.paused) {
        e.preventDefault();
        this.handleAction();
      }

      // Arrow key navigation for dice selection (only when ROLLED)
      if (this.state.status === "ROLLED" && !this.animating && !this.paused) {
        const activeDice = this.state.dice.filter((d) => d.inPlay && !d.scored);

        if (activeDice.length === 0) return;

        if (e.code === "ArrowLeft" || e.code === "ArrowRight") {
          e.preventDefault();

          if (e.code === "ArrowLeft") {
            this.selectedDieIndex = (this.selectedDieIndex - 1 + activeDice.length) % activeDice.length;
          } else {
            this.selectedDieIndex = (this.selectedDieIndex + 1) % activeDice.length;
          }

          // Highlight the focused die
          this.highlightFocusedDie(activeDice[this.selectedDieIndex].id);
        }

        // Enter key - toggle selection of focused die
        if (e.code === "Enter") {
          e.preventDefault();
          const focusedDie = activeDice[this.selectedDieIndex];
          if (focusedDie) {
            this.handleDieClick(focusedDie.id);
          }
        }
      }

      // 'D' key - deselect all (when dice are selected)
      if (e.code === "KeyD" && this.state.status === "ROLLED" && this.state.selected.size > 0 && !this.animating && !this.paused) {
        e.preventDefault();
        this.handleDeselectAll();
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

  private handleDeselectAll() {
    if (this.paused || this.animating || this.state.status !== "ROLLED") return;

    // Deselect all dice
    const selectedIds = Array.from(this.state.selected);
    selectedIds.forEach((dieId) => {
      this.dispatch({ t: "TOGGLE_SELECT", dieId });
      this.diceRenderer.setSelected(dieId, false);
    });

    notificationService.show("Deselected All", "info");
  }

  private highlightFocusedDie(dieId: string) {
    // Remove focus from all dice
    const allDiceElements = document.querySelectorAll(".die-wrapper");
    allDiceElements.forEach((el) => el.classList.remove("focused"));

    // Add focus to the selected die
    const dieElement = document.querySelector(`[data-die-id="${dieId}"]`);
    if (dieElement) {
      dieElement.classList.add("focused");
      // Show notification about keyboard controls on first use
      const hasSeenKeyboardHint = sessionStorage.getItem("keyboardHintShown");
      if (!hasSeenKeyboardHint) {
        notificationService.show("← → to navigate, Enter to select, D to deselect all", "info");
        sessionStorage.setItem("keyboardHintShown", "true");
      }
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
      this.selectedDieIndex = 0; // Reset keyboard navigation index
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
      if (points === 0) {
        notificationService.show("🎉 Perfect Roll! +0 Points!", "success");
        // Celebrate perfect roll with particles
        this.scene.celebrateSuccess("perfect");
      } else {
        notificationService.show(`+${points} Points!`, "success");
      }
    });

    this.dispatch({ t: "SCORE_SELECTED" });
  }

  private handleNewGame() {
    // Hide game over screen
    this.gameOverEl.classList.remove("show");

    // Create new game state with new seed and game variants from settings
    const seed = this.generateSeed();
    const settings = settingsService.getSettings();
    const config = {
      addD20: settings.game.addD20,
      addD4: settings.game.addD4,
      add2ndD10: settings.game.add2ndD10,
      d100Mode: settings.game.d100Mode,
    };
    this.state = createGame(seed, config);

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

    // Create new game state with new seed and game variants from settings
    const seed = this.generateSeed();
    const settings = settingsService.getSettings();
    const config = {
      addD20: settings.game.addD20,
      addD4: settings.game.addD4,
      add2ndD10: settings.game.add2ndD10,
      d100Mode: settings.game.d100Mode,
    };
    this.state = createGame(seed, config);

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
      this.deselectBtn.style.display = "none";
    } else if (this.state.status === "ROLLED") {
      const hasSelection = this.state.selected.size > 0;
      if (hasSelection) {
        // Calculate points for button text
        const scoredDice = this.state.dice.filter((d) => this.state.selected.has(d.id));
        const points = scoredDice.reduce((sum, die) => sum + (die.def.sides - die.value), 0);
        this.actionBtn.textContent = `Score +${points} (Space)`;
        this.actionBtn.disabled = this.animating || this.paused;
        this.actionBtn.className = "primary";
        this.deselectBtn.style.display = "inline-block";
      } else {
        this.actionBtn.textContent = "Select Dice to Score";
        this.actionBtn.disabled = true;
        this.actionBtn.className = "";
        this.deselectBtn.style.display = "none";
      }
    } else {
      this.actionBtn.disabled = true;
      this.deselectBtn.style.display = "none";
    }
  }

  private showGameOver() {
    // Play game over sound
    audioService.playSfx("gameOver");

    // Celebrate game completion with particles
    this.scene.celebrateSuccess("complete");

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
    notificationService.show(`🎮 Game Complete! Final Score: ${this.state.score}`, "success");

    this.finalScoreEl.textContent = this.state.score.toString();
    // Display player's rank
    const rankEl = document.getElementById("rank-display")!;
    const stats = scoreHistoryService.getStats();
    if (rank) {
      const totalGames = stats.totalGames;
      const rankEmoji = rank === 1 ? "🏆" : rank <= 3 ? "🥉" : "📊";
      rankEl.innerHTML = `<p style="font-size: 1.2em; opacity: 0.8; margin: 10px 0;">${rankEmoji} Rank #${rank} of ${totalGames} games</p>`;

      // Add special message for personal best
      if (this.state.score === stats.bestScore) {
        rankEl.innerHTML += `<p style="color: gold; font-weight: bold; margin: 5px 0;">🎉 NEW PERSONAL BEST!</p>`;
      }
    } else {
      rankEl.innerHTML = `<p style="opacity: 0.8; margin: 10px 0;">🎮 First game!</p>`;
    }

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
