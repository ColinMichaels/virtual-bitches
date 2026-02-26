import { environment } from "@env";
import { logger } from "../utils/logger.js";

const log = logger.create("PlayerIdentity");
const PLAYER_ID_KEY = `${environment.storage.prefix}-player-id`;

let cachedPlayerId: string | null = null;

export function getLocalPlayerId(): string {
  if (cachedPlayerId) {
    return cachedPlayerId;
  }

  try {
    const existing = localStorage.getItem(PLAYER_ID_KEY);
    if (existing && existing.trim().length > 0) {
      cachedPlayerId = existing;
      return existing;
    }
  } catch (error) {
    log.warn("Failed to read local player id from storage", error);
  }

  const generated = generatePlayerId();
  cachedPlayerId = generated;

  try {
    localStorage.setItem(PLAYER_ID_KEY, generated);
  } catch (error) {
    log.warn("Failed to persist local player id", error);
  }

  return generated;
}

export function setLocalPlayerId(playerId: string): void {
  const normalized = playerId.trim();
  if (!normalized) return;

  cachedPlayerId = normalized;
  try {
    localStorage.setItem(PLAYER_ID_KEY, normalized);
  } catch (error) {
    log.warn("Failed to persist provided local player id", error);
  }
}

function generatePlayerId(): string {
  return `player-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
