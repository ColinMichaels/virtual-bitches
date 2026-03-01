export const SESSION_RECOVERY_RETRY_PROFILES = Object.freeze({
  sessionStandard: Object.freeze({ attempts: 6, baseDelayMs: 150 }),
  sessionFast: Object.freeze({ attempts: 4, baseDelayMs: 120 }),
  sessionRefreshAuth: Object.freeze({ attempts: 7, baseDelayMs: 200 }),
  authRecovery: Object.freeze({ attempts: 5, baseDelayMs: 160 }),
  sessionLeave: Object.freeze({ attempts: 3, baseDelayMs: 100 }),
});

function normalizeRetryOption(value, fallback, { min = 0 } = {}) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.floor(value));
}

export function resolveSessionRecoveryRetryOptions(profileKey, overrides = {}) {
  const baseProfile =
    SESSION_RECOVERY_RETRY_PROFILES[profileKey] ??
    SESSION_RECOVERY_RETRY_PROFILES.sessionStandard;

  return {
    attempts: normalizeRetryOption(overrides.attempts, baseProfile.attempts, { min: 1 }),
    baseDelayMs: normalizeRetryOption(overrides.baseDelayMs, baseProfile.baseDelayMs, { min: 0 }),
  };
}
