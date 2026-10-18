import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyPreviewBudgetRecord } from "./verify_preview_budget_browser_report.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const limits = {
  max_file_bytes: 32768,
  max_decompressed_bytes: 67108864,
  max_elements: 8388608,
  max_sample_rows: 512,
  max_input_features: 64,
  max_output_features: 256,
  max_preview_elements: 16384,
  max_output_bytes: 200000,
  max_zip_ratio: 100,
  max_variables: 128,
  max_header_bytes: 16384,
};
const zero = () =>
  Object.fromEntries(
    [
      "plans",
      "plan_control",
      "execution_control",
      "submission_control",
      "runs",
      "runtime_provenance",
      "event_log",
    ].map((key) => [key, 0]),
  );
const snap = () => ({
  counts: zero(),
  sources: {
    "bytes.npz": { size: 40000, sha256: "a".repeat(64) },
    "compressed.npz": { size: 100, sha256: "b".repeat(64) },
    "features.npz": { size: 500, sha256: "c".repeat(64) },
    "samples.npz": { size: 500, sha256: "d".repeat(64) },
  },
});
const painted = () => ({
  connected: true,
  loading: false,
  canvases: 1,
  figures: 1,
  rasters: [{ width: 120, height: 80, painted: true }],
});
function response(status, path, payload) {
  const request = { root: "datasets", path, view: "all" };
  const requestText = JSON.stringify(request);
  const value = {
    status,
    method: "POST",
    path: "/api/datasets/preview",
    request,
    requestComplete: true,
    responseComplete: true,
    requestText,
    requestBytes: Buffer.byteLength(requestText),
    requestSha256: sha(requestText),
    response:
      status === 413
        ? { error: "Request too large" }
        : {
            ...structuredClone(payload),
            selection: { root: "datasets", path: "samples.npz" },
            view: "all",
          },
  };
  rehash(value);
  return value;
}
function rehash(value) {
  value.responseText = JSON.stringify(value.response);
  value.responseBytes = Buffer.byteLength(value.responseText);
  value.responseSha256 = sha(value.responseText);
}
function valid() {
  const payload = {
    input_shape: [96, 32],
    output_shape: [96, 1],
    limits: { max_sample_rows: 512 },
  };
  const processes = [1, 2, 3, 4, 5, 6].map((phase) => {
    const refused = [2, 4].includes(phase);
    const path = phase === 2 ? "compressed.npz" : phase === 4 ? "features.npz" : "samples.npz";
    const stdoutText = JSON.stringify(
      refused ? { error: "Dataset preview refused", code: "too_large" } : payload,
    );
    return {
      phase,
      pid: phase + 100,
      pidAbsent: true,
      cancelled: false,
      timedOut: false,
      stdoutTruncated: false,
      stdoutText,
      stdoutBytes: Buffer.byteLength(stdoutText),
      stdoutSha256: sha(stdoutText),
      originalArgv: [
        "/owned/python",
        "-m",
        "wavedl.core.dataset_preview",
        "--path",
        `/owned/${path}`,
        "--expected-identity",
        JSON.stringify({ root_id: "datasets", relative_path: path, path: `/owned/${path}` }),
        ...Object.entries(limits).flatMap(([key, value]) => [
          `--${key.replaceAll("_", "-")}`,
          String(value),
        ]),
      ],
      returncode: refused ? 1 : 0,
    };
  });
  const paths = [
      "samples.npz",
      "compressed.npz",
      "samples.npz",
      "features.npz",
      "samples.npz",
      "bytes.npz",
      "samples.npz",
    ],
    statuses = [200, 413, 200, 413, 200, 413, 200];
  return {
    name: "dataset-preview-budget",
    status: "passed",
    driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations",
    browser: "agent-browser test Chrome/150",
    initialProfileEmpty: true,
    browserObserved: {
      userAgent: "Chrome/150",
      width: 1280,
      height: 900,
      cookies: "",
      localStorageKeys: [],
      sessionStorageKeys: [],
    },
    cleanup: {
      errors: [],
      browserSessionAbsent: true,
      fixtureReaped: true,
      servicesClosed: true,
      listenerClosed: true,
      ownedRootsRemoved: true,
      browserProfileRemoved: true,
      privateCredentialRemoved: true,
    },
    drained: { outstanding: 0 },
    before: snap(),
    after: snap(),
    witness: {
      limits: structuredClone(limits),
      control: {
        input_shape: [10000, 10],
        output_shape: [10000, 1],
        sample_count: 512,
        max_zip_ratio: 10000,
      },
      members: [
        { name: "X.npy", expanded: 800128, compressed: 100 },
        { name: "y.npy", expanded: 100000, compressed: 100 },
      ],
    },
    initial: painted(),
    refusals: ["compressed.npz", "features.npz", "bytes.npz"].map((name, i) => ({
      name,
      refused: {
        message:
          "The daemon request failed. Verify connectivity and the operation outcome before retrying.",
        canvases: 0,
        figures: 0,
        loading: false,
        connected: true,
        rasters: [],
      },
      capacity: { phase: [2, 4, 5][i], outstanding: 0 },
      unchanged: snap(),
      retry: painted(),
    })),
    processes,
    responses: paths.map((path, i) => response(statuses[i], path, payload)),
    limitation:
      "Fixture-only valid numeric resource witnesses; default ZIP ratio and explicit lower file/feature caps; no remote or site certification.",
  };
}
test("accepts complete preview budget evidence", () => verifyPreviewBudgetRecord(valid()));
test("cleanup-pending requires deletion proof only after the pre-delete check", () => {
  const value = valid();
  value.cleanup.ownedRootsRemoved =
    value.cleanup.browserProfileRemoved =
    value.cleanup.privateCredentialRemoved =
      false;
  verifyPreviewBudgetRecord(value, { cleanupPending: true });
  assert.throws(() => verifyPreviewBudgetRecord(value));
  assert.throws(() => verifyPreviewBudgetRecord(valid(), { cleanupPending: true }));
});
for (const key of [
  "error",
  "skip",
  "skipped",
  "skipReason",
  "retainedPrivateRoots",
  "explicitFixtureWebAssets",
  "authoringEventDiagnostic",
  "shutdownError",
  "failed",
  "failureStage",
  "failureDom",
  "fixtureStderrDiagnostic",
]) {
  for (const marker of ["", false]) {
    test(`rejects present ${key} flag ${JSON.stringify(marker)}`, () => {
      const value = valid();
      value[key] = marker;
      assert.throws(() => verifyPreviewBudgetRecord(value));
    });
  }
}
const mutations = [
  [
    "process identity",
    (value) => {
      value.processes[0].originalArgv[2] = "wrong.module";
    },
  ],
  [
    "process PID cleanup",
    (value) => {
      value.processes[1].pidAbsent = false;
    },
  ],
  [
    "process output hash",
    (value) => {
      value.processes[2].stdoutSha256 = "0".repeat(64);
    },
  ],
  [
    "null refusal exit",
    (value) => {
      value.processes[1].returncode = null;
    },
  ],
  [
    "string refusal exit",
    (value) => {
      value.processes[3].returncode = "1";
    },
  ],
  [
    "HTTP binding",
    (value) => {
      value.responses[0].path = "/api/other";
    },
  ],
  [
    "HTTP response bytes",
    (value) => {
      value.responses[1].responseText = "{}";
    },
  ],
  [
    "HTTP request hash",
    (value) => {
      value.responses[2].requestSha256 = "0".repeat(64);
    },
  ],
  [
    "HTTP drift hash recomputed",
    (value) => {
      value.responses[0].response.extra_result = "not-from-child";
      rehash(value.responses[0]);
    },
  ],
  [
    "HTTP selection drift",
    (value) => {
      value.responses[2].response.selection.path = "features.npz";
      rehash(value.responses[2]);
    },
  ],
  [
    "HTTP view drift",
    (value) => {
      value.responses[6].response.view = "statistics";
      rehash(value.responses[6]);
    },
  ],
  [
    "render witness",
    (value) => {
      value.initial.rasters[0].painted = false;
    },
  ],
  [
    "refusal capacity",
    (value) => {
      value.refusals[0].capacity.outstanding = 1;
    },
  ],
  [
    "immutable source",
    (value) => {
      value.before.sources["samples.npz"].size = 0;
    },
  ],
  [
    "cleanup pending mismatch",
    (value) => {
      value.cleanup.ownedRootsRemoved = false;
    },
  ],
];
for (const [label, mutate] of mutations)
  test(`rejects ${label} mutation`, () => {
    const value = valid();
    mutate(value);
    assert.throws(() => verifyPreviewBudgetRecord(value));
  });
