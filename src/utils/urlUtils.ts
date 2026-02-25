/**
 * URL Utilities
 * Handles URL parsing and seed management
 */

/**
 * Generates a unique seed for a new game
 * Format: timestamp-random
 */
export function generateSeed(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Parses game parameters from current URL
 * Returns seed and encoded action log if present
 */
export function parseGameURL(): { seed: string | null; logEncoded: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    seed: params.get("seed"),
    logEncoded: params.get("log")
  };
}
