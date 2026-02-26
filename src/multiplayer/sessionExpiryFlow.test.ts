import {
  resolveSessionExpiryOutcome,
  type SessionExpiryChoice,
} from "./sessionExpiryFlow.js";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} (expected: ${expected}, actual: ${actual})`);
  }
}

function test(name: string, fn: () => Promise<void> | void): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      console.log(`✓ ${name}`);
    })
    .catch((error) => {
      console.error(`✗ ${name}`);
      throw error;
    });
}

await test("returns recovered and skips prompt when recovery succeeds", async () => {
  const calls: string[] = [];
  const outcome = await resolveSessionExpiryOutcome({
    reason: "session_expired",
    preferredSessionId: "room-1",
    attemptRecovery: async (reason, preferredSessionId) => {
      calls.push(`recovery:${reason}:${preferredSessionId ?? ""}`);
      return true;
    },
    promptChoice: async () => {
      calls.push("prompt");
      return "solo";
    },
  });

  assertEqual(outcome, "recovered", "Expected recovered outcome");
  assertEqual(calls.length, 1, "Expected prompt to be skipped after successful recovery");
  assertEqual(calls[0], "recovery:session_expired:room-1", "Expected recovery call details");
});

await test("returns lobby when recovery fails and prompt selects lobby", async () => {
  let promptedReason = "";
  const outcome = await resolveSessionExpiryOutcome({
    reason: "session_expired",
    preferredSessionId: "room-2",
    attemptRecovery: async () => false,
    promptChoice: async (reason): Promise<SessionExpiryChoice> => {
      promptedReason = reason;
      return "lobby";
    },
  });

  assertEqual(promptedReason, "session_expired", "Expected prompt reason");
  assertEqual(outcome, "lobby", "Expected lobby outcome");
});

await test("returns solo when recovery fails and prompt selects solo", async () => {
  const outcome = await resolveSessionExpiryOutcome({
    reason: "auth_session_expired",
    attemptRecovery: async () => false,
    promptChoice: async () => "solo",
  });

  assertEqual(outcome, "solo", "Expected solo outcome");
});

await test("treats unexpected prompt value as solo fallback", async () => {
  const outcome = await resolveSessionExpiryOutcome({
    reason: "unknown",
    attemptRecovery: async () => false,
    promptChoice: async () => "anything_else" as SessionExpiryChoice,
  });

  assert(outcome === "solo", "Expected solo fallback for invalid prompt choice");
});

console.log("\nSession expiry flow tests passed! ✓");
