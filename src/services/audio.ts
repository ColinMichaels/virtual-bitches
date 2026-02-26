/**
 * Audio Service
 * Manages sound effects and background music using Web Audio API
 */

import { settingsService } from "./settings.js";
import { logger } from "../utils/logger.js";
import { getGameMusicUrl } from "./assetUrl.js";

const log = logger.create('AudioService');

export type SoundEffect = "roll" | "select" | "score" | "click" | "gameOver";

export class AudioService {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;

  private soundBuffers = new Map<SoundEffect, AudioBuffer>();
  private musicSource: AudioBufferSourceNode | null = null;
  private musicBuffer: AudioBuffer | null = null;
  private musicBufferPromise: Promise<AudioBuffer | null> | null = null;
  private musicPlaying = false;

  constructor() {
    // Subscribe to settings changes
    settingsService.onChange((settings) => {
      this.updateVolumes();
    });
  }

  /**
   * Initialize audio context (must be called after user interaction)
   */
  async initialize(): Promise<void> {
    if (this.context) return;

    try {
      this.context = new AudioContext();

      // Create gain nodes for volume control
      this.masterGain = this.context.createGain();
      this.musicGain = this.context.createGain();
      this.sfxGain = this.context.createGain();

      // Connect gain nodes
      this.musicGain.connect(this.masterGain);
      this.sfxGain.connect(this.masterGain);
      this.masterGain.connect(this.context.destination);

      // Set initial volumes
      this.updateVolumes();

      // Generate procedural sound effects
      await this.generateSoundEffects();

      log.info("Audio system initialized");
    } catch (error) {
      log.error("Failed to initialize audio:", error);
    }
  }

  /**
   * Generate procedural sound effects using Web Audio API
   * This avoids needing external audio files
   */
  private async generateSoundEffects(): Promise<void> {
    if (!this.context) return;

    // Roll sound - multiple short impacts
    this.soundBuffers.set("roll", this.createRollSound());

    // Select sound - short click
    this.soundBuffers.set("select", this.createClickSound(800, 0.1));

    // Score sound - success chime
    this.soundBuffers.set("score", this.createScoreSound());

    // Click sound - UI feedback
    this.soundBuffers.set("click", this.createClickSound(1200, 0.05));

    // Game over sound - completion fanfare
    this.soundBuffers.set("gameOver", this.createGameOverSound());
  }

  /**
   * Create dice rolling sound (multiple impacts)
   */
  private createRollSound(): AudioBuffer {
    const sampleRate = this.context!.sampleRate;
    const duration = 0.6;
    const buffer = this.context!.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);

    // Multiple impacts with decay
    const impacts = [0, 0.15, 0.25, 0.35, 0.45];
    for (const time of impacts) {
      const start = Math.floor(time * sampleRate);
      const decay = 0.1;
      const impactLength = Math.floor(decay * sampleRate);

      for (let i = 0; i < impactLength && start + i < data.length; i++) {
        const t = i / sampleRate;
        const envelope = Math.exp(-t * 30);
        data[start + i] += (Math.random() * 2 - 1) * envelope * 0.3;
      }
    }

    return buffer;
  }

  /**
   * Create click sound (short tone)
   */
  private createClickSound(frequency: number, duration: number): AudioBuffer {
    const sampleRate = this.context!.sampleRate;
    const buffer = this.context!.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * 40);
      data[i] = Math.sin(2 * Math.PI * frequency * t) * envelope * 0.2;
    }

    return buffer;
  }

  /**
   * Create score sound (ascending chime)
   */
  private createScoreSound(): AudioBuffer {
    const sampleRate = this.context!.sampleRate;
    const duration = 0.3;
    const buffer = this.context!.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);

    const frequencies = [440, 554, 659]; // A, C#, E (A major chord)

    for (let i = 0; i < data.length; i++) {
      const t = i / sampleRate;
      const envelope = Math.exp(-t * 8);

      let sample = 0;
      frequencies.forEach((freq) => {
        sample += Math.sin(2 * Math.PI * freq * t) * envelope;
      });

      data[i] = sample * 0.15;
    }

    return buffer;
  }

  /**
   * Create game over sound (fanfare)
   */
  private createGameOverSound(): AudioBuffer {
    const sampleRate = this.context!.sampleRate;
    const duration = 0.8;
    const buffer = this.context!.createBuffer(1, sampleRate * duration, sampleRate);
    const data = buffer.getChannelData(0);

    const notes = [
      { freq: 523, start: 0, duration: 0.15 },     // C
      { freq: 659, start: 0.15, duration: 0.15 },  // E
      { freq: 784, start: 0.3, duration: 0.15 },   // G
      { freq: 1047, start: 0.45, duration: 0.35 }, // C (octave up)
    ];

    for (const note of notes) {
      const startSample = Math.floor(note.start * sampleRate);
      const noteDuration = Math.floor(note.duration * sampleRate);

      for (let i = 0; i < noteDuration && startSample + i < data.length; i++) {
        const t = i / sampleRate;
        const envelope = Math.exp(-t * 5);
        data[startSample + i] += Math.sin(2 * Math.PI * note.freq * t) * envelope * 0.2;
      }
    }

    return buffer;
  }

  /**
   * Play a sound effect
   */
  playSfx(effect: SoundEffect): void {
    if (!this.context || !this.sfxGain) return;

    const buffer = this.soundBuffers.get(effect);
    if (!buffer) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.sfxGain);
    source.start(0);
  }

  /**
   * Start playing background music
   */
  async playMusic(): Promise<void> {
    if (!this.context || !this.musicGain || this.musicPlaying) return;

    try {
      // Decode bundled music file once and reuse it for loop playback.
      if (!this.musicBuffer) {
        this.musicBuffer = await this.loadMusicBuffer();
      }
      if (!this.musicBuffer) {
        return;
      }

      this.musicSource = this.context.createBufferSource();
      this.musicSource.buffer = this.musicBuffer;
      this.musicSource.loop = true;
      this.musicSource.connect(this.musicGain);
      this.musicSource.start(0);
      this.musicPlaying = true;
    } catch (error) {
      log.error("Failed to play music:", error);
    }
  }

  private async loadMusicBuffer(): Promise<AudioBuffer | null> {
    if (!this.context) {
      return null;
    }

    if (this.musicBufferPromise) {
      return this.musicBufferPromise;
    }

    this.musicBufferPromise = (async () => {
      try {
        // Hardcoded for now. Future media service can supply CDN-backed track URLs.
        const response = await fetch(getGameMusicUrl());
        if (!response.ok) {
          throw new Error(`music_fetch_failed:${response.status}`);
        }
        const fileBuffer = await response.arrayBuffer();
        const decoded = await this.context!.decodeAudioData(fileBuffer);
        return decoded;
      } catch (error) {
        log.error("Failed to load bundled music track, using fallback loop:", error);
        return this.createAmbientMusic();
      }
    })();

    const loaded = await this.musicBufferPromise;
    this.musicBufferPromise = null;
    return loaded;
  }

  /**
   * Stop background music
   */
  stopMusic(): void {
    if (this.musicSource) {
      this.musicSource.stop();
      this.musicSource = null;
      this.musicPlaying = false;
    }
  }

  /**
   * Procedural fallback when bundled track fails to load.
   */
  private createAmbientMusic(): AudioBuffer {
    const sampleRate = this.context!.sampleRate;
    const duration = 8; // 8 second loop
    const buffer = this.context!.createBuffer(2, sampleRate * duration, sampleRate);

    // Base frequencies for ambient pad (A minor chord)
    const frequencies = [110, 165, 220]; // A2, E3, A3

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);

      for (let i = 0; i < data.length; i++) {
        const t = i / sampleRate;
        let sample = 0;

        frequencies.forEach((freq, index) => {
          // Add fundamental and harmonics
          sample += Math.sin(2 * Math.PI * freq * t) * 0.15;
          sample += Math.sin(2 * Math.PI * freq * 2 * t) * 0.05; // 2nd harmonic

          // Slow LFO for movement
          const lfo = Math.sin(2 * Math.PI * 0.1 * t + index) * 0.1 + 0.9;
          sample *= lfo;
        });

        data[i] = sample * 0.3;
      }
    }

    return buffer;
  }

  /**
   * Update volumes based on settings
   */
  private updateVolumes(): void {
    if (!this.masterGain || !this.musicGain || !this.sfxGain) return;

    const settings = settingsService.getSettings();
    this.masterGain.gain.value = settings.audio.masterVolume;
    this.musicGain.gain.value = settings.audio.musicEnabled ? settings.audio.musicVolume : 0;
    this.sfxGain.gain.value = settings.audio.sfxEnabled ? settings.audio.sfxVolume : 0;
  }

  /**
   * Check if audio is initialized
   */
  isInitialized(): boolean {
    return this.context !== null;
  }
}

// Singleton instance
export const audioService = new AudioService();
