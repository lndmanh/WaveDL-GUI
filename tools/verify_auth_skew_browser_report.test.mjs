import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyAuthSkewFile, verifyAuthSkewReport } from "./verify_auth_skew_browser_report.mjs";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { observeCursorStorage } from "./browser_cursor_storage.mjs";

const emptyStorage = () => ({ local: 0, entries: [], valid: true, session: 0, cookies: "" });

const fixture = () => ({
  status: "passed",
  scenario: "same-daemon-auth-skew",
  approvedRunId: "owned-run",
  assetManifestSha256: "a".repeat(64),
  browserRuntime: { userAgent: "HeadlessChrome/154.0.0.0", headed: false, executable: "managed" },
  pythonInterpreter: "/owned/python",
  beforeFault: {
    selectedRun: "owned-run",
    historySteps: 1,
    historyCanvas: true,
    diagnostics: true,
  },
  registryBeforeFault: {
    plans: 1,
    control: [["owned-plan", 1, 0, "train", "owned-run", null, null]],
    manifests: [
      {
        planId: "owned-plan",
        manifestJson: JSON.stringify({ operation: "train", run_id: "owned-run" }),
      },
    ],
  },
  registryAfterRecovery: {
    plans: 1,
    control: [["owned-plan", 1, 0, "train", "owned-run", null, null]],
    manifests: [
      {
        planId: "owned-plan",
        manifestJson: JSON.stringify({ operation: "train", run_id: "owned-run" }),
      },
    ],
  },
  derivedPlanIds: [],
  cleanup: {
    browserClosed: true,
    servicesClosed: true,
    fixtureReaped: true,
    listenerClosed: true,
    ownedRootsRemoved: true,
    browserProfileRemoved: true,
    privateCredentialRemoved: true,
    workspaceRemoved: true,
  },
  tokenObservation: "behavioral authority retirement only; private token bytes are not inspected",
  assertions: [
    "real authenticated request returned 401",
    "build skew refused live authority",
    "protocol skew refused live authority",
  ],
  faultEvidence: ["401", "build", "protocol"].map((mode) => ({
    mode,
    endpoint: "/api/health",
    realStatus: 200,
    faultStatus: mode === "401" ? 401 : 200,
    daemonId: "daemon",
    buildId: "build",
    protocolMin: 1,
    protocolMax: 1,
  })),
  revoked: {
    authMessage: true,
    reconnectPrompt: true,
    stalePlan: false,
    staleHistory: false,
    staleSelectedRun: false,
    mutationControls: 0,
    storage: emptyStorage(),
  },
  reauthed: {
    connected: true,
    authMessage: false,
    mutationControls: 0,
    storage: emptyStorage(),
  },
  skewObservations: ["build", "protocol"].map((mode) => ({ mode, refused: true, recovery: true })),
  ownedArtifactsRetained: false,
});

test("dedicated populated auth/skew report passes", () => assert(verifyAuthSkewReport(fixture())));
const watermark = () => ({
  local: 1, entries: [{ key: "wavedl:cursor:v1:daemon:owned-run", cursor: { attempt: 1, seq: 23 } }],
  valid: true, session: 0, cookies: "",
});
test("accepts only exact scoped numeric watermark evidence", () => {
  const report = fixture();
  report.revoked.storage = watermark();
  report.reauthed.storage = watermark();
  assert(verifyAuthSkewReport(report));
});
for (const [name, change] of [
  ["cookie", s => { s.cookies = "present"; }],
  ["token field", s => { s.token = "secret"; }],
  ["session", s => { s.session = 1; }],
  ["extra localStorage", s => { s.local = 2; }],
  ["foreign daemon", s => { s.entries[0].key = "wavedl:cursor:v1:foreign:owned-run"; }],
  ["foreign run", s => { s.entries[0].key = "wavedl:cursor:v1:daemon:foreign"; }],
  ["token key", s => { s.entries[0].key = "token"; }],
  ["extra cursor token", s => { s.entries[0].cursor.token = "secret"; }],
  ["extra cursor path", s => { s.entries[0].cursor.path = "/private/path"; }],
  ["extra cursor bootstrap", s => { s.entries[0].cursor.bootstrap = "secret"; }],
  ["extra raw event", s => { s.entries[0].cursor.payload = {}; }],
  ["negative attempt", s => { s.entries[0].cursor.attempt = -1; }],
  ["fractional seq", s => { s.entries[0].cursor.seq = 1.5; }],
  ["string seq", s => { s.entries[0].cursor.seq = "23"; }],
  ["unsafe seq", s => { s.entries[0].cursor.seq = Number.MAX_SAFE_INTEGER + 1; }],
  ["invalid initial cursor", s => { s.entries[0].cursor.attempt = 0; }],
  ["invalid storage flag", s => { s.valid = false; }],
]) test(`rejects watermark ${name}`, () => {
  for (const phase of ["revoked", "reauthed"]) {
    const report = fixture();
    report[phase].storage = watermark();
    change(report[phase].storage);
    assert.throws(() => verifyAuthSkewReport(report));
  }
});

test("browser collection rejects private/invalid storage without copying bytes to report", () => {
  const key = "wavedl:cursor:v1:daemon:owned-run";
  const collect = (entries, session = 0, cookie = "") => observeCursorStorage({
    length: entries.length, key: i => entries[i][0],
    getItem: key => entries.find(e => e[0] === key)?.[1],
  }, { length: session }, cookie, "daemon", "owned-run");
  assert.deepEqual(collect([[key, '{"attempt":1,"seq":23}']]), watermark());
  for (const entries of [
    [["token", "private-secret"]],
    [[key, '{"attempt":1,"seq":23,"token":"private-secret"}']],
    [[key, '{"attempt":1,"seq":"private-secret"}']],
    [[key, 'private-secret']],
    [[key, "x".repeat(129)]],
    [[key, '{"attempt":0,"seq":0}']],
    [[key, '{"attempt":1,"seq":23}'], ["extra", "private-secret"]],
    [["wavedl:cursor:v1:foreign:owned-run", '{"attempt":1,"seq":23}']],
  ]) {
    const observed = collect(entries);
    assert.equal(observed.valid, false);
    assert(!JSON.stringify(observed).includes("private-secret"));
  }
  assert.equal(collect([], 1).session, 1);
  assert.equal(collect([], 0, "private-secret").cookies, "present");
});
function plotFixture() {
  const report = fixture();
  report.registryAfterRecovery.plans = 2;
  report.registryAfterRecovery.control.push([
    "plot-plan",
    1,
    0,
    "plot",
    "plot-run",
    "owned-run",
    "gen-000003",
  ]);
  report.registryAfterRecovery.manifests.push({
    planId: "plot-plan",
    manifestJson: JSON.stringify({
      operation: "plot",
      run_id: "plot-run",
      checkpoint_source: {
        run_id: "owned-run",
        generation: "gen-000003",
        manifest_sha256: "a".repeat(64),
        complete_sha256: "b".repeat(64),
      },
    }),
  });
  report.derivedPlanIds = ["plot-plan"];
  return report;
}
test("accepts exactly one derived plot tied to approved source publication", () => {
  const report = plotFixture();
  assert(verifyAuthSkewReport(report));
  report.registryAfterRecovery.control[1][5] = "foreign-run";
  assert.throws(() => verifyAuthSkewReport(report));
});
for (const [name, change] of [
  [
    "wrong persisted plot operation",
    (m) => {
      m.operation = "train";
    },
  ],
  [
    "foreign persisted source run",
    (m) => {
      m.checkpoint_source.run_id = "foreign-run";
    },
  ],
  [
    "wrong persisted source generation",
    (m) => {
      m.checkpoint_source.generation = "gen-000004";
    },
  ],
  [
    "absent persisted source pin",
    (m) => {
      delete m.checkpoint_source;
    },
  ],
  [
    "invalid persisted source digest",
    (m) => {
      m.checkpoint_source.complete_sha256 = "bad";
    },
  ],
])
  test(`rejects ${name}`, () => {
    const report = plotFixture();
    const entry = report.registryAfterRecovery.manifests[1];
    const manifest = JSON.parse(entry.manifestJson);
    change(manifest);
    entry.manifestJson = JSON.stringify(manifest);
    assert.throws(() => verifyAuthSkewReport(report));
  });
for (const [name, change] of [
  [
    "empty history",
    (r) => {
      r.beforeFault.historySteps = 0;
    },
  ],
  [
    "persisted authentication",
    (r) => {
      r.reauthed.storage.session = 1;
    },
  ],
  [
    "changed fault daemon",
    (r) => {
      r.faultEvidence[1].daemonId = "different";
    },
  ],
  [
    "foreign run",
    (r) => {
      r.beforeFault.selectedRun = "foreign";
    },
  ],
  [
    "stale cancellation mutation",
    (r) => {
      r.registryAfterRecovery.control[0][2] = 1;
    },
  ],
  [
    "new plan",
    (r) => {
      r.registryAfterRecovery.plans = 2;
    },
  ],
  [
    "missing protocol refusal",
    (r) => {
      r.assertions.pop();
    },
  ],
  [
    "unconfirmed cleanup",
    (r) => {
      r.cleanup.servicesClosed = false;
    },
  ],
  [
    "retained credential",
    (r) => {
      r.cleanup.privateCredentialRemoved = false;
    },
  ],
  [
    "missing actual workspace absence",
    (r) => {
      delete r.cleanup.workspaceRemoved;
    },
  ],
  [
    "changed original manifest",
    (r) => {
      r.registryAfterRecovery.manifests[0].manifestJson = "{}";
    },
  ],
  [
    "projection without persisted manifest",
    (r) => {
      r.registryAfterRecovery.manifests[0] = {
        planId: "owned-plan",
        operation: "train",
        runId: "owned-run",
      };
    },
  ],
  [
    "self-labelled extra train plan",
    (r) => {
      r.registryAfterRecovery.plans = 2;
      r.registryAfterRecovery.control.push(["extra", 1, 0, "train", "other-run", null, null]);
      r.registryAfterRecovery.manifests.push({
        planId: "extra",
        manifestJson: JSON.stringify({ operation: "train", run_id: "other-run" }),
      });
      r.derivedPlanIds = ["extra"];
    },
  ],
])
  test(`rejects ${name}`, () => {
    const report = fixture();
    change(report);
    assert.throws(() => verifyAuthSkewReport(report));
  });

test("file guard rejects stale assets, links, oversized and malformed evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "wavedl-auth-guard-"));
  try {
    const path = join(root, "report.json");
    const report = fixture();
    const manifest = await readFile(
      new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url),
    );
    report.assetManifestSha256 = createHash("sha256").update(manifest).digest("hex");
    await writeFile(path, JSON.stringify(report));
    assert(await verifyAuthSkewFile(path));
    const link = join(root, "link.json");
    await symlink(path, link);
    await assert.rejects(verifyAuthSkewFile(link));
    report.assetManifestSha256 = "0".repeat(64);
    await writeFile(path, JSON.stringify(report));
    await assert.rejects(verifyAuthSkewFile(path));
    await writeFile(path, Buffer.alloc(1024 * 1024 + 1));
    await assert.rejects(verifyAuthSkewFile(path));
    await writeFile(path, "{");
    await assert.rejects(verifyAuthSkewFile(path));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
