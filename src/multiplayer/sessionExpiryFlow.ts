export type SessionExpiryChoice = "lobby" | "solo";
export type SessionExpiryOutcome = "recovered" | "lobby" | "solo";

export interface SessionExpiryFlowOptions {
  reason: string;
  preferredSessionId?: string;
  attemptRecovery: (reason: string, preferredSessionId?: string) => Promise<boolean>;
  promptChoice: (reason: string) => Promise<SessionExpiryChoice>;
}

export async function resolveSessionExpiryOutcome(
  options: SessionExpiryFlowOptions
): Promise<SessionExpiryOutcome> {
  const recovered = await options.attemptRecovery(options.reason, options.preferredSessionId);
  if (recovered) {
    return "recovered";
  }

  const choice = await options.promptChoice(options.reason);
  return choice === "lobby" ? "lobby" : "solo";
}
