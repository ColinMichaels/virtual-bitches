/**
 * Loading Screen
 * Displays progress during asset loading with gradient background
 * Separate from splash screen - shows transient loading state
 */

export interface LoadingTask {
  name: string;
  weight: number; // Relative weight for progress calculation (0-1)
}

export class LoadingScreen {
  private container: HTMLElement;
  private progressBar: HTMLElement;
  private progressText: HTMLElement;
  private statusText: HTMLElement;
  private tasks: Map<string, { completed: boolean; weight: number }> = new Map();
  private totalWeight: number = 0;
  private completedWeight: number = 0;

  constructor() {
    // Create loading screen container
    this.container = document.createElement("div");
    this.container.id = "loading-screen";
    this.container.className = "loading-screen";
    this.container.innerHTML = `
      <div class="loading-content">
        <div class="loading-spinner">
          <div class="dice-icon">🎲</div>
        </div>
        <h2 class="loading-title">Loading BISCUITS</h2>
        <div class="loading-status">Initializing...</div>
        <div class="loading-progress-container">
          <div class="loading-progress-bar"></div>
        </div>
        <div class="loading-progress-text">0%</div>
      </div>
    `;

    // Get references to elements
    this.progressBar = this.container.querySelector(".loading-progress-bar") as HTMLElement;
    this.progressText = this.container.querySelector(".loading-progress-text") as HTMLElement;
    this.statusText = this.container.querySelector(".loading-status") as HTMLElement;

    // Apply gradient background via inline style (matches splash/game gradient)
    this.container.style.background = `
      linear-gradient(
        to bottom,
        #2a3545 0%,
        #1f2935 30%,
        #151c26 60%,
        #0a0f16 100%
      )
    `;
  }

  /**
   * Show loading screen
   */
  show(): void {
    document.body.appendChild(this.container);
    // Force reflow for animation
    void this.container.offsetWidth;
    this.container.classList.add("visible");
  }

  /**
   * Hide loading screen with fade out
   */
  hide(): void {
    this.container.classList.add("fade-out");
    setTimeout(() => {
      this.container.remove();
    }, 500);
  }

  /**
   * Register loading tasks
   * Call this before starting to load assets
   */
  registerTasks(tasks: LoadingTask[]): void {
    this.tasks.clear();
    this.totalWeight = 0;
    this.completedWeight = 0;

    tasks.forEach((task) => {
      this.tasks.set(task.name, { completed: false, weight: task.weight });
      this.totalWeight += task.weight;
    });

    this.updateProgress();
  }

  /**
   * Mark a task as completed
   */
  completeTask(taskName: string): void {
    const task = this.tasks.get(taskName);
    if (task && !task.completed) {
      task.completed = true;
      this.completedWeight += task.weight;
      this.updateProgress();
    }
  }

  /**
   * Update loading status message
   */
  setStatus(message: string): void {
    this.statusText.textContent = message;
  }

  /**
   * Manually set progress (0-100)
   * Use this if you're not using tasks
   */
  setProgress(percent: number): void {
    const clamped = Math.max(0, Math.min(100, percent));
    this.progressBar.style.width = `${clamped}%`;
    this.progressText.textContent = `${Math.round(clamped)}%`;
  }

  /**
   * Update progress based on completed tasks
   */
  private updateProgress(): void {
    if (this.totalWeight === 0) {
      this.setProgress(0);
      return;
    }

    const percent = (this.completedWeight / this.totalWeight) * 100;
    this.setProgress(percent);
  }

  /**
   * Check if all tasks are completed
   */
  isComplete(): boolean {
    return this.completedWeight >= this.totalWeight && this.totalWeight > 0;
  }
}

/**
 * Helper function to create loading screen with common game assets
 */
export function createGameLoadingScreen(): LoadingScreen {
  const loadingScreen = new LoadingScreen();

  // Register typical game loading tasks
  loadingScreen.registerTasks([
    { name: "engine", weight: 0.1 },        // BabylonJS engine init
    { name: "geometry", weight: 0.3 },      // Dice geometry (largest asset)
    { name: "textures", weight: 0.3 },      // Theme textures
    { name: "audio", weight: 0.1 },         // Audio files
    { name: "services", weight: 0.1 },      // Service initialization
    { name: "scene", weight: 0.1 },         // Scene setup
  ]);

  return loadingScreen;
}
