import assert from "node:assert/strict";

export const RETIRED_CONTROL_ERROR =
  "Owned command failed (exit=1, signal=null): driver-element-not-found";

export function redactAuthenticationClickError(command, stderr) {
  return command === "click" && /\bElement not found\b/i.test(stderr)
    ? "driver-element-not-found"
    : "[suppressed]";
}

// A native click can lose its acknowledgement when the resulting 401 removes
// its target. Never click again: require independent boundary and UI evidence.
export async function clickAuthenticationControlOnce({ click, proveRetirement }) {
  let acknowledgementLost = false;
  try {
    await click();
  } catch (error) {
    if (!(error instanceof Error) || error.message !== RETIRED_CONTROL_ERROR) throw error;
    acknowledgementLost = true;
  }
  const proof = await proveRetirement();
  assert.equal(proof.faults.length, 1, "Expected exactly one delivered authentication fault");
  const [fault] = proof.faults;
  assert.equal(fault.mode, "401");
  assert.equal(fault.endpoint, "/api/health");
  assert.equal(fault.realStatus, 200);
  assert.equal(fault.faultStatus, 401);
  assert(typeof fault.daemonId === "string" && fault.daemonId.length > 0);
  const { revoked } = proof;
  assert(revoked.authMessage && revoked.reconnectPrompt, "401 requires explicit reauthentication");
  assert(!revoked.stalePlan && !revoked.staleHistory && !revoked.staleSelectedRun,
    "401 must retire old plan, history and selected-run authority");
  assert.equal(revoked.mutationControls, 0);
  assert.equal(revoked.storage.session, 0);
  assert.equal(revoked.storage.cookies, "");
  assert(revoked.storage.valid, "Only scoped numeric cursor watermarks may remain");
  return { ...proof, acknowledgementLost };
}
