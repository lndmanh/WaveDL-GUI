import assert from "node:assert/strict";
import { test } from "node:test";
import {
  clickAuthenticationControlOnce,
  RETIRED_CONTROL_ERROR,
} from "./browser_auth_retirement.mjs";

function proof(credentialPresent = false) {
  return {
    faults: [{
      mode: "401",
      endpoint: "/api/health",
      realStatus: 200,
      faultStatus: 401,
      daemonId: "daemon-fixture-id",
    }],
    revoked: {
      authMessage: true,
      reconnectPrompt: true,
      stalePlan: false,
      staleHistory: false,
      staleSelectedRun: false,
      mutationControls: 0,
      storage: {
        session: 0,
        credential: { present: credentialPresent },
        cookies: "",
        valid: true,
      },
    },
  };
}

test("a delivered 401 retires the envelope after exactly one click", async () => {
  let clicks = 0;
  const result = await clickAuthenticationControlOnce({
    click: async () => { clicks += 1; },
    proveRetirement: async () => proof(),
  });

  assert.equal(clicks, 1);
  assert.equal(result.revoked.storage.credential.present, false);
});

test("401 does not retry a control whose acknowledgement was retired", async () => {
  let clicks = 0;
  const result = await clickAuthenticationControlOnce({
    click: async () => {
      clicks += 1;
      throw new Error(RETIRED_CONTROL_ERROR);
    },
    proveRetirement: async () => proof(),
  });

  assert.equal(clicks, 1);
  assert.equal(result.acknowledgementLost, true);
});

test("401 rejection fails if the persisted session envelope survives", async () => {
  await assert.rejects(clickAuthenticationControlOnce({
    click: async () => {},
    proveRetirement: async () => proof(true),
  }), /401 must wipe the persisted session envelope/);
});
