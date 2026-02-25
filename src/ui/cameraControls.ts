/**
 * Camera Controls Panel
 * UI for managing camera positions, saving/loading, and accessing camera features
 */

import { cameraService, type CameraPosition, type CameraTier } from "../services/cameraService.js";
import { logger } from "../utils/logger.js";

const log = logger.create('CameraControls');

export class CameraControlsPanel {
  private container!: HTMLElement;
  private isVisible = false;
  private onLoadCallback?: (position: CameraPosition) => void;

  constructor() {
    this.createUI();
    this.setupEventListeners();
  }

  /**
   * Create the camera controls UI
   */
  private createUI(): void {
    this.container = document.createElement('div');
    this.container.id = 'camera-controls';
    this.container.className = 'camera-controls-panel';
    this.container.style.display = 'none';

    this.container.innerHTML = `
      <div class="camera-panel">
        <div class="camera-header">
          <h2>📷 Camera Controls</h2>
          <button id="camera-close-btn" class="camera-close-btn" title="Close">✕</button>
        </div>

        <div class="camera-info">
          <div class="camera-tier-badge" id="camera-tier-badge">Free Tier</div>
          <div class="camera-stats" id="camera-stats">0/3 positions saved</div>
        </div>

        <div class="camera-section">
          <h3>Saved Positions</h3>
          <div class="camera-positions-list" id="camera-positions-list">
            <p class="camera-empty-message">No saved positions yet</p>
          </div>
        </div>

        <div class="camera-section">
          <h3>Current View</h3>
          <div class="camera-current-info" id="camera-current-info">
            <div class="camera-coord">α: <span id="camera-alpha">-1.57</span></div>
            <div class="camera-coord">β: <span id="camera-beta">1.05</span></div>
            <div class="camera-coord">r: <span id="camera-radius">38.0</span></div>
          </div>
          <div class="camera-actions">
            <input
              type="text"
              id="camera-name-input"
              class="camera-name-input"
              placeholder="Position name..."
              maxlength="30"
            />
            <button id="camera-save-btn" class="camera-action-btn camera-save-btn">
              💾 Save Current
            </button>
            <button id="camera-reset-btn" class="camera-action-btn">
              🔄 Reset to Default
            </button>
          </div>
        </div>

        <div class="camera-section">
          <h3>Import / Export</h3>
          <div class="camera-actions">
            <button id="camera-export-btn" class="camera-action-btn">
              📤 Export All
            </button>
            <button id="camera-import-btn" class="camera-action-btn">
              📥 Import
            </button>
            <input
              type="file"
              id="camera-import-file"
              accept=".json"
              style="display: none;"
            />
          </div>
        </div>

        <div class="camera-section camera-locked-section">
          <h3>🔒 Advanced Features</h3>
          <div class="camera-locked-features">
            <div class="camera-locked-item" data-feature="enhanced">
              <span class="camera-locked-icon">🎬</span>
              <div class="camera-locked-content">
                <strong>Enhanced Camera</strong>
                <p>10 slots • Smooth transitions • Replay</p>
                <small>🏆 Complete 10 games to unlock</small>
              </div>
            </div>
            <div class="camera-locked-item" data-feature="flying">
              <span class="camera-locked-icon">✈️</span>
              <div class="camera-locked-content">
                <strong>Flying Mode</strong>
                <p>Free camera • WASD controls • No-clip</p>
                <small>🎯 Achievement or Premium unlock</small>
              </div>
            </div>
            <div class="camera-locked-item" data-feature="machinima">
              <span class="camera-locked-icon">🎥</span>
              <div class="camera-locked-content">
                <strong>Machinima Pro</strong>
                <p>Camera paths • Director mode • Export</p>
                <small>⭐ Premium feature • Coming soon!</small>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(this.container);
    log.debug('Camera controls UI created');
  }

  /**
   * Setup event listeners
   */
  private setupEventListeners(): void {
    // Close button
    const closeBtn = document.getElementById('camera-close-btn');
    closeBtn?.addEventListener('click', () => this.hide());

    // Save button
    const saveBtn = document.getElementById('camera-save-btn');
    saveBtn?.addEventListener('click', () => this.handleSave());

    // Reset button
    const resetBtn = document.getElementById('camera-reset-btn');
    resetBtn?.addEventListener('click', () => this.handleReset());

    // Export button
    const exportBtn = document.getElementById('camera-export-btn');
    exportBtn?.addEventListener('click', () => this.handleExport());

    // Import button
    const importBtn = document.getElementById('camera-import-btn');
    const importFile = document.getElementById('camera-import-file') as HTMLInputElement;
    importBtn?.addEventListener('click', () => importFile?.click());
    importFile?.addEventListener('change', (e) => this.handleImport(e));

    // Listen to camera service events
    cameraService.on('positionAdded', () => this.refreshPositions());
    cameraService.on('positionDeleted', () => this.refreshPositions());
    cameraService.on('positionUpdated', () => this.refreshPositions());
    cameraService.on('tierChanged', () => this.updateTierDisplay());

    log.debug('Event listeners setup complete');
  }

  /**
   * Show the panel
   */
  show(): void {
    this.container.style.display = 'flex';
    this.isVisible = true;
    this.refreshPositions();
    this.updateTierDisplay();
    log.debug('Camera controls panel shown');
  }

  /**
   * Hide the panel
   */
  hide(): void {
    this.container.style.display = 'none';
    this.isVisible = false;
    log.debug('Camera controls panel hidden');
  }

  /**
   * Toggle panel visibility
   */
  toggle(): void {
    if (this.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Update current camera position display
   */
  updateCurrentPosition(alpha: number, beta: number, radius: number): void {
    const alphaEl = document.getElementById('camera-alpha');
    const betaEl = document.getElementById('camera-beta');
    const radiusEl = document.getElementById('camera-radius');

    if (alphaEl) alphaEl.textContent = alpha.toFixed(2);
    if (betaEl) betaEl.textContent = beta.toFixed(2);
    if (radiusEl) radiusEl.textContent = radius.toFixed(1);
  }

  /**
   * Set callback for when a position is loaded
   */
  onLoad(callback: (position: CameraPosition) => void): void {
    this.onLoadCallback = callback;
  }

  /**
   * Handle save button click
   */
  private handleSave(): void {
    if (!this.onLoadCallback) {
      log.warn('Cannot save: no scene callback registered');
      return;
    }

    const nameInput = document.getElementById('camera-name-input') as HTMLInputElement;
    const name = nameInput?.value.trim() || `Position ${cameraService.listPositions().length + 1}`;

    // Get current camera position from scene
    // This will be called via the callback mechanism
    const event = new CustomEvent('camera:requestSave', { detail: { name } });
    document.dispatchEvent(event);

    // Clear input
    if (nameInput) nameInput.value = '';
  }

  /**
   * Save position (called from external code with current camera state)
   */
  savePosition(name: string, alpha: number, beta: number, radius: number, target: { x: number; y: number; z: number }): void {
    const id = cameraService.savePosition(name, {
      alpha,
      beta,
      radius,
      target,
    });

    if (id) {
      this.showNotification(`✅ Saved: ${name}`, 'success');
      this.refreshPositions();
    } else {
      const stats = cameraService.getStats();
      this.showNotification(
        `❌ Limit reached: ${stats.tier} tier allows only ${stats.maxSlots} positions`,
        'error'
      );
    }
  }

  /**
   * Handle reset button click
   */
  private handleReset(): void {
    const event = new CustomEvent('camera:requestReset');
    document.dispatchEvent(event);
    this.showNotification('🔄 Reset to default view', 'info');
  }

  /**
   * Handle export button click
   */
  private handleExport(): void {
    const json = cameraService.exportAll();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = `biscuits-camera-positions-${Date.now()}.json`;
    a.click();

    URL.revokeObjectURL(url);

    const count = cameraService.listPositions().length;
    this.showNotification(`📤 Exported ${count} position${count !== 1 ? 's' : ''}`, 'success');
    log.info(`Exported ${count} camera positions`);
  }

  /**
   * Handle import file selection
   */
  private handleImport(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const json = e.target?.result as string;
        const imported = cameraService.importAll(json);

        if (imported.length > 0) {
          this.showNotification(`📥 Imported ${imported.length} position${imported.length !== 1 ? 's' : ''}`, 'success');
          this.refreshPositions();
          log.info(`Imported ${imported.length} camera positions`);
        } else {
          this.showNotification('❌ Import failed: invalid file or tier limit reached', 'error');
        }
      } catch (error) {
        this.showNotification('❌ Import failed: invalid JSON file', 'error');
        log.error('Import error:', error);
      }

      // Reset file input
      input.value = '';
    };

    reader.readAsText(file);
  }

  /**
   * Refresh the positions list
   */
  refreshPositions(): void {
    const listEl = document.getElementById('camera-positions-list');
    if (!listEl) return;

    const positions = cameraService.listPositions();

    if (positions.length === 0) {
      listEl.innerHTML = '<p class="camera-empty-message">No saved positions yet</p>';
      return;
    }

    listEl.innerHTML = positions.map(pos => `
      <div class="camera-position-item" data-id="${pos.id}">
        <div class="camera-position-info">
          <div class="camera-position-name">
            ${pos.isFavorite ? '⭐ ' : ''}${this.escapeHtml(pos.name)}
          </div>
          <div class="camera-position-details">
            α:${pos.alpha.toFixed(2)} β:${pos.beta.toFixed(2)} r:${pos.radius.toFixed(1)}
          </div>
        </div>
        <div class="camera-position-actions">
          <button class="camera-position-btn camera-load-btn" data-id="${pos.id}" title="Load">
            ▶️
          </button>
          <button class="camera-position-btn camera-favorite-btn" data-id="${pos.id}" title="Toggle favorite">
            ${pos.isFavorite ? '⭐' : '☆'}
          </button>
          <button class="camera-position-btn camera-delete-btn" data-id="${pos.id}" title="Delete">
            🗑️
          </button>
        </div>
      </div>
    `).join('');

    // Add event listeners to position buttons
    listEl.querySelectorAll('.camera-load-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).dataset.id;
        if (id) this.loadPosition(id);
      });
    });

    listEl.querySelectorAll('.camera-favorite-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).dataset.id;
        if (id) {
          cameraService.toggleFavorite(id);
          this.refreshPositions();
        }
      });
    });

    listEl.querySelectorAll('.camera-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = (e.target as HTMLElement).dataset.id;
        if (id) this.deletePosition(id);
      });
    });

    // Update stats
    this.updateStats();
  }

  /**
   * Load a camera position
   */
  private loadPosition(id: string): void {
    const position = cameraService.loadPosition(id);

    if (position && this.onLoadCallback) {
      this.onLoadCallback(position);
      this.showNotification(`📷 Loaded: ${position.name}`, 'success');
    }
  }

  /**
   * Delete a camera position
   */
  private deletePosition(id: string): void {
    const position = cameraService.listPositions().find(p => p.id === id);

    if (!position) return;

    if (confirm(`Delete "${position.name}"?`)) {
      cameraService.deletePosition(id);
      this.showNotification(`🗑️ Deleted: ${position.name}`, 'info');
      this.refreshPositions();
    }
  }

  /**
   * Update tier display and stats
   */
  private updateTierDisplay(): void {
    const stats = cameraService.getStats();
    const badgeEl = document.getElementById('camera-tier-badge');

    if (badgeEl) {
      const tierLabels: Record<CameraTier, string> = {
        free: 'Free Tier',
        unlocked: 'Enhanced',
        premium: 'Premium',
      };

      badgeEl.textContent = tierLabels[stats.tier];
      badgeEl.className = `camera-tier-badge camera-tier-${stats.tier}`;
    }

    this.updateStats();

    // Update locked features display
    const lockedSection = this.container.querySelector('.camera-locked-section');
    if (lockedSection && stats.tier === 'premium') {
      // Hide locked features if premium
      (lockedSection as HTMLElement).style.display = 'none';
    }
  }

  /**
   * Update position count stats
   */
  private updateStats(): void {
    const stats = cameraService.getStats();
    const statsEl = document.getElementById('camera-stats');

    if (statsEl) {
      const maxSlots = stats.maxSlots === Infinity ? '∞' : stats.maxSlots;
      statsEl.textContent = `${stats.positionCount}/${maxSlots} positions saved`;

      if (stats.favoriteCount > 0) {
        statsEl.textContent += ` (${stats.favoriteCount} ⭐)`;
      }
    }
  }

  /**
   * Show notification toast
   */
  private showNotification(message: string, type: 'success' | 'error' | 'info'): void {
    // Use existing notification system if available
    const event = new CustomEvent('notification:show', {
      detail: { message, type, duration: 3000 }
    });
    document.dispatchEvent(event);
  }

  /**
   * Escape HTML for safe rendering
   */
  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Dispose of the panel
   */
  dispose(): void {
    this.container.remove();
    log.debug('Camera controls panel disposed');
  }
}
