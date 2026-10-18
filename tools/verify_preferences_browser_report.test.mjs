import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  verifyPreferencesRecord,
  verifyPreferencesReport,
  trainingPreferenceNames,
} from "./verify_preferences_browser_report.mjs";

function fixture() {
  const training = { ...Object.fromEntries(trainingPreferenceNames.map(name => [name, null])), epochs: 17, wandb: true, wandb_watch: true };
  const defaults = { epochs: "1000", batch_size: "128", workers: "-1", precision: "bf16" };
  const source = Object.fromEntries(
    ["samples.npz", "samples.h5", "samples.mat", "retained-run-cache/previous-run.cache"].map((path) => [
      path,
      { size: 100, sha256: "a".repeat(64) },
    ]),
  );
  return {
    name: "preferences-browser-corruption",
    status: "passed",
    driverReadinessMode: "sync-exposure-poll-and-two-controller-dom-observations",
    daemonId: "daemon",
    freshStorage: { keys: [], unrelated: null, session: 0, cookies: "" },
    defaults,
    trainingOptionsSha256: "b".repeat(64),
    assetManifestSha256: "c".repeat(64),
    appearanceSaved: { language: "vi", dark: true, fontSize: "20px", primary: "oklch(0.55 0.18 300)", preferences: { theme: "dark", accent: "violet", zoom: 125, language: "vi", showProjectGuide: false } },
    appearanceAfterRestart: { language: "vi", dark: true, fontSize: "20px", primary: "oklch(0.55 0.18 300)", preferences: { theme: "dark", accent: "violet", zoom: 125, language: "vi", showProjectGuide: false } },
    trainingSaved: training,
    trainingAfterRestart: structuredClone(training),
    savedGuideDefaultApplied: true,
    savedDefaultDraft: { epochs: "17", wandb: "true", wandb_watch: "true" },
    afterReset: { trainingRemoved: true, stalePreference: "unavailable-old-cache-location", unrelated: "preserve-me" },
    finalStorage: { keys: ["qa-unrelated", "wavedl.appearance.v1", "wavedl.legacy.cache-directory"], unrelated: "preserve-me", session: 0, cookies: "" },
    settingsControls: ["Reset training defaults", "Save appearance"],
    cases: ["malformed", "oversized"].map((mode, index) => ({
      mode,
      seedBytes: index ? 65537 : 1,
      appearance: { theme: "system", language: "en", guide: "true", rootLanguage: "en" },
      trainingDefaults: { ...defaults },
      draft: { epochs: "1000", device: "cpu" },
      storage: {
        keys: ["qa-unrelated", "wavedl.appearance.v1", "wavedl.training-defaults.v1.daemon"],
        unrelated: "preserve-me",
        session: 0,
        cookies: "",
      },
    })),
    sourceBefore: source,
    sourceAfter: structuredClone(source),
    limitation: "No exported YAML exercised.",
    cleanup: {
      errors: [],
      browserSessionAbsent: true,
      fixtureReaped: true,
      servicesClosed: true,
      listenerClosed: true,
      ownedRootsRemoved: true,
    },
  };
}
test("populated preference recovery record passes", () =>
  assert(verifyPreferencesRecord(fixture(), "/tmp")));
for (const field of ["error", "skip", "skipped", "skipReason", "failureStage"])
  test(`rejects passed evidence containing ${field}`, () => {
    const record = fixture();
    record[field] = false;
    assert.throws(() => verifyPreferencesRecord(record, "/tmp"));
  });
for (const [name, change] of [
  ["missing oversized case", (r) => r.cases.pop()],
  ["wrong daemon scope", (r) => (r.daemonId = "foreign")],
  ["wrong guide state", (r) => (r.cases[0].appearance.guide = "false")],
  ["wrong language", (r) => (r.cases[1].appearance.language = "fr")],
  ["wrong default fields", (r) => (r.cases[0].trainingDefaults.workers = "0")],
  ["non-CPU draft", (r) => (r.cases[0].draft.device = "cuda")],
  ["deleted unrelated storage", (r) => (r.cases[0].storage.unrelated = null)],
  ["persistent authentication", (r) => (r.cases[1].storage.session = 1)],
  ["absent fresh profile proof", (r) => delete r.freshStorage],
  ["changed retained source", (r) => (r.sourceAfter["samples.npz"].sha256 = "d".repeat(64))],
  ["missing listener cleanup", (r) => delete r.cleanup.listenerClosed],
  ["cleanup error", (r) => r.cleanup.errors.push("failure")],
  ["invalid asset hash", (r) => (r.assetManifestSha256 = "bad")],
  ["invalid oversized byte claim", (r) => (r.cases[1].seedBytes = 65536)],
  ["missing persisted appearance", (r) => delete r.appearanceAfterRestart],
  ["unapplied scale", (r) => r.appearanceSaved.fontSize = "16px"],
  ["lost W&B default", (r) => r.trainingAfterRestart.wandb = false],
  ["default not applied to draft", (r) => r.savedDefaultDraft.epochs = "1000"],
  ["guide default not applied", (r) => delete r.savedGuideDefaultApplied],
  ["unsafe training preference", (r) => r.trainingSaved.token = "unsafe"],
  ["stale preference removed", (r) => r.afterReset.stalePreference = null],
  ["authentication persisted after settings", (r) => r.finalStorage.keys.push("bearer-token")],
  ["cache deletion control", (r) => r.settingsControls.push("Delete run cache")],
  ["missing cache sentinel", (r) => { delete r.sourceBefore["retained-run-cache/previous-run.cache"]; delete r.sourceAfter["retained-run-cache/previous-run.cache"]; }],
  ["failed record", (r) => (r.status = "failed")],
])
  test(`rejects ${name}`, () => {
    const r = fixture();
    change(r);
    assert.throws(() => verifyPreferencesRecord(r, "/tmp"));
  });
test("file verifier rejects empty, oversized, symlink and private-extra-file evidence", async () => {
  const root = await mkdtemp(join(tmpdir(), "wavedl-preferences-verifier-"));
  try {
    const path = join(root, "preferences-browser.json");
    await writeFile(path, "");
    await assert.rejects(verifyPreferencesReport(root));
    await writeFile(path, " ".repeat(256 * 1024 + 1));
    await assert.rejects(verifyPreferencesReport(root));
    await rm(path);
    await symlink("/dev/null", path);
    await assert.rejects(verifyPreferencesReport(root));
    await rm(path);
    await writeFile(path, JSON.stringify(fixture()));
    await writeFile(join(root, "private-token"), "private");
    await assert.rejects(verifyPreferencesReport(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
