import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clickAuthenticationControlOnce,
  redactAuthenticationClickError,
  RETIRED_CONTROL_ERROR,
} from "./browser_auth_retirement.mjs";
import { boundedCommand } from "./browser_process.mjs";

test("native missing-element stderr crosses the real bounded command redactor", async () => {
  const click = () => boundedCommand(process.execPath, ["-e",
    "process.stderr.write('Element not found: private selector'); process.exitCode = 1;"],
  { redact: (stderr) => redactAuthenticationClickError("click", stderr) });
  const result = await clickAuthenticationControlOnce({
    click, proveRetirement: async () => retirementProof(),
  });
  assert.equal(result.acknowledgementLost, true);
});

test("redaction does not expose selectors or classify unrelated failures", () => {
  assert.equal(redactAuthenticationClickError("click", "Element not found: private"),
    "driver-element-not-found");
  assert.equal(redactAuthenticationClickError("fill", "Element not found: private"),
    "[suppressed]");
  assert.equal(redactAuthenticationClickError("click", "private file not found"),
    "[suppressed]");
});

function retirementProof() {
  return {
    faults: [{ mode: "401", endpoint: "/api/health", realStatus: 200,
      faultStatus: 401, daemonId: "owned-daemon" }],
    revoked: { authMessage: true, reconnectPrompt: true, stalePlan: false,
      staleHistory: false, staleSelectedRun: false, mutationControls: 0,
      storage: { session: 0, cookies: "", valid: true } },
  };
}

for (const acknowledgementLost of [false, true]) {
  test(`one click requires independently delivered retirement (lost ACK=${acknowledgementLost})`, async () => {
    let clicks = 0;
    const result = await clickAuthenticationControlOnce({
      click: async () => {
        clicks += 1;
        if (acknowledgementLost) throw new Error(RETIRED_CONTROL_ERROR);
      },
      proveRetirement: async () => retirementProof(),
    });
    assert.equal(clicks, 1);
    assert.equal(result.acknowledgementLost, acknowledgementLost);
  });
}

for (const message of [
  "arbitrary failure",
  "Owned command failed (timeout): driver-element-not-found",
  "Owned command failed (exit=2, signal=null): driver-element-not-found",
  "Owned command failed (exit=1, signal=null): [suppressed]",
]) {
  test(`does not mask unrelated click failure: ${message}`, async () => {
    const error = new Error(message);
    let observations = 0;
    await assert.rejects(clickAuthenticationControlOnce({
      click: async () => { throw error; },
      proveRetirement: async () => { observations += 1; return retirementProof(); },
    }), (actual) => actual === error);
    assert.equal(observations, 0);
  });
}

const invalidProofs = {
  "no delivered fault": (proof) => { proof.faults = []; },
  "multiple delivered faults": (proof) => { proof.faults.push({ ...proof.faults[0] }); },
  "wrong mode": (proof) => { proof.faults[0].mode = "build"; },
  "wrong endpoint": (proof) => { proof.faults[0].endpoint = "/api/runs"; },
  "handler rejected request": (proof) => { proof.faults[0].realStatus = 401; },
  "no fault response": (proof) => { proof.faults[0].faultStatus = 200; },
  "missing daemon identity": (proof) => { proof.faults[0].daemonId = ""; },
  "no auth notice": (proof) => { proof.revoked.authMessage = false; },
  "no credential prompt": (proof) => { proof.revoked.reconnectPrompt = false; },
  "stale plan": (proof) => { proof.revoked.stalePlan = true; },
  "stale history": (proof) => { proof.revoked.staleHistory = true; },
  "stale selected run": (proof) => { proof.revoked.staleSelectedRun = true; },
  "stale mutation control": (proof) => { proof.revoked.mutationControls = 1; },
  "persisted session": (proof) => { proof.revoked.storage.session = 1; },
  "persisted cookie": (proof) => { proof.revoked.storage.cookies = "forbidden"; },
  "invalid cursor storage": (proof) => { proof.revoked.storage.valid = false; },
};
for (const [name, mutate] of Object.entries(invalidProofs)) {
  test(`lost click ACK fails closed with ${name}`, async () => {
    const proof = retirementProof();
    mutate(proof);
    let clicks = 0;
    await assert.rejects(clickAuthenticationControlOnce({
      click: async () => { clicks += 1; throw new Error(RETIRED_CONTROL_ERROR); },
      proveRetirement: async () => proof,
    }));
    assert.equal(clicks, 1);
  });
}

test("failure to observe retirement is not converted to success", async () => {
  const error = new Error("bounded observation expired");
  await assert.rejects(clickAuthenticationControlOnce({
    click: async () => { throw new Error(RETIRED_CONTROL_ERROR); },
    proveRetirement: async () => { throw error; },
  }), (actual) => actual === error);
});
