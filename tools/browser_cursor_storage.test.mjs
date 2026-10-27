import assert from "node:assert/strict";
import { test } from "node:test";
import { observeCursorStorage, SESSION_CREDENTIAL_KEY } from "./browser_cursor_storage.mjs";

const daemonId = "daemon-fixture-id";
const runId = "00000000-0000-4000-8000-000000000001";
const origin = "http://127.0.0.1:43123";
const masterToken = "m".repeat(43);
const sessionToken = "s".repeat(43);

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
  };
}

function envelope(overrides = {}) {
  return JSON.stringify({
    version: 1,
    daemonId,
    origin,
    token: sessionToken,
    expiresAt: Date.now() + 60_000,
    ...overrides,
  });
}

test("accepts one tab-scoped envelope and returns no credential bytes", () => {
  const result = observeCursorStorage(
    storage(),
    storage({ [SESSION_CREDENTIAL_KEY]: envelope() }),
    "",
    daemonId,
    runId,
    { forbiddenToken: masterToken, origin },
  );

  assert.equal(result.valid, true);
  assert.equal(result.credential.present, true);
  assert.equal(result.credential.key, SESSION_CREDENTIAL_KEY);
  assert.equal(result.credential.masterTokenPresent, false);
  assert.deepEqual(Object.keys(result.credential).sort(), [
    "daemonIdMatches", "expiresAtValid", "key", "masterTokenPresent", "originMatches", "present", "tokenInUrl", "valid",
  ]);
  assert(!JSON.stringify(result).includes(sessionToken));
  assert(!JSON.stringify(result).includes(masterToken));
});

test("serialized observer is self-contained for browser evaluation", () => {
  const browserObserver = Function(`return (${observeCursorStorage.toString()})`)();
  const result = browserObserver(
    storage(),
    storage({ [SESSION_CREDENTIAL_KEY]: envelope() }),
    "",
    daemonId,
    runId,
    { forbiddenToken: masterToken, origin },
  );

  assert.equal(result.valid, true);
  assert.equal(result.credential.masterTokenPresent, false);
});

test("allows the explicit persistent envelope beside a scoped numeric cursor", () => {
  const cursorKey = `wavedl:cursor:v1:${encodeURIComponent(daemonId)}:${encodeURIComponent(runId)}`;
  const result = observeCursorStorage(
    storage({
      [cursorKey]: JSON.stringify({ attempt: 1, seq: 7 }),
      [SESSION_CREDENTIAL_KEY]: envelope(),
    }),
    storage(),
    "",
    daemonId,
    runId,
    { credentialArea: "local", forbiddenToken: masterToken, origin },
  );

  assert.equal(result.valid, true);
  assert.equal(result.local, 2);
  assert.equal(result.session, 0);
  assert.equal(result.entries.length, 1);
  assert.equal(result.credential.present, true);
  assert.equal(result.credential.masterTokenPresent, false);
});

test("rejects unknown keys, wrong storage area, mismatched scope and master-token persistence", () => {
  const validEnvelope = envelope();
  const cases = [
    observeCursorStorage(storage({ unexpected: "value" }), storage(), "", daemonId, runId),
    observeCursorStorage(storage({ [SESSION_CREDENTIAL_KEY]: validEnvelope }), storage(), "", daemonId, runId, { forbiddenToken: masterToken, origin }),
    observeCursorStorage(storage(), storage({ [SESSION_CREDENTIAL_KEY]: envelope({ daemonId: "other-daemon" }) }), "", daemonId, runId, { forbiddenToken: masterToken, origin }),
    observeCursorStorage(storage(), storage({ [SESSION_CREDENTIAL_KEY]: envelope({ token: masterToken }) }), "", daemonId, runId, { forbiddenToken: masterToken, origin }),
  ];

  for (const result of cases) assert.equal(result.valid, false);
  assert.equal(cases.at(-1).credential.masterTokenPresent, true);
});

test("treats stored expiry as metadata rather than a client-side deadline", () => {
  const result = observeCursorStorage(storage(), storage({
    [SESSION_CREDENTIAL_KEY]: envelope({ expiresAt: 1 }),
  }), "", daemonId, runId, { forbiddenToken: masterToken, origin });
  assert.equal(result.valid, true);
  assert.equal(result.credential.expiresAtValid, true);
});
