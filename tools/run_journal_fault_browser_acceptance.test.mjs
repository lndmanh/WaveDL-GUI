import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { main, runRowLocator, selectedObservationExpression, sessionAbsent, validateReportPath, waitForSessionAbsence } from "./run_journal_fault_browser_acceptance.mjs";

const runner = new URL("./run_journal_fault_browser_acceptance.mjs", import.meta.url);
const uuid = "12345678-1234-4234-8234-123456789abc";
async function owned(t) {
  const root = await realpath(await mkdtemp(join(await realpath(tmpdir()), "journal-runner-test-")));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
test("import exports main with no browser or fixture side effects", () => {
  assert.equal(typeof main, "function");
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(runner.href)}); process.stdout.write('import-only')`], { timeout: 3000, encoding: "utf8" });
  assert.equal(child.status, 0); assert.equal(child.stdout, "import-only"); assert.equal(child.stderr, "");
});
test("syntax check succeeds without browser invocation", () => {
  assert.equal(spawnSync(process.execPath, ["--check", runner.pathname], { timeout: 3000 }).status, 0);
});
test("CLI requires exactly one explicit absolute report", () => {
  for (const args of [[], ["--report=relative.json"], ["--report=/missing/report.json", "--extra"]]) {
    const child = spawnSync(process.execPath, [runner.pathname, ...args], { timeout: 3000, encoding: "utf8" });
    assert.equal(child.status, 1); assert.match(child.stderr, /Provide --report=/);
  }
});
test("new canonical file is accepted without creation", async (t) => {
  const root = await owned(t), path = join(root, "report.json");
  assert.equal(await validateReportPath(path), path); assert.deepEqual(await readdir(root), []);
});
test("missing relative noncanonical directory paths fail", async (t) => {
  const root = await owned(t);
  for (const path of [undefined, "relative", `${root}/sub/../report.json`, `${root}/`]) await assert.rejects(validateReportPath(path));
  await assert.rejects(validateReportPath(join(root, "missing", "report.json")), { code: "ENOENT" });
});
test("existing regular report is preserved", async (t) => {
  const root = await owned(t), path = join(root, "report.json"); await writeFile(path, "keep");
  await assert.rejects(validateReportPath(path), /already exist/); assert.equal(await readFile(path, "utf8"), "keep");
});
test("existing directory report fails", async (t) => {
  const root = await owned(t), path = join(root, "report.json"); await mkdir(path);
  await assert.rejects(validateReportPath(path), /already exist/); assert((await lstat(path)).isDirectory());
});
test("dangling report symlink is rejected and preserved", async (t) => {
  const root = await owned(t), path = join(root, "report.json"); await symlink(join(root, "missing"), path);
  await assert.rejects(validateReportPath(path), /already exist/); assert((await lstat(path)).isSymbolicLink());
});
test("report symlink cannot overwrite target", async (t) => {
  const root = await owned(t), target = join(root, "target"), path = join(root, "report.json");
  await writeFile(target, "preserved"); await symlink(target, path);
  await assert.rejects(validateReportPath(path), /already exist/); assert.equal(await readFile(target, "utf8"), "preserved");
});
test("symlink ancestors at any depth are rejected", async (t) => {
  const root = await owned(t), directory = join(root, "actual");
  await mkdir(directory); await mkdir(join(directory, "nested")); await symlink(directory, join(root, "linked"));
  for (const path of [join(root, "linked", "report.json"), join(root, "linked", "nested", "report.json")]) await assert.rejects(validateReportPath(path), /ordinary directory chain/);
});
test("invalid main path rejects before subprocess creation", async () => { await assert.rejects(main("relative.json"), /absolute/); });
test("row locator scopes Runs exact small UUID, not accessible button label", () => {
  assert.equal(runRowLocator(uuid), `xpath=//section[@aria-label='Runs']//button[.//small[normalize-space(.)='${uuid}']]`);
  for (const value of ["", "bad", `${uuid}' or true()`, uuid.toUpperCase()]) assert.throws(() => runRowLocator(value));
});
test("session absence uses exact lines including active arrow", () => {
  assert.equal(sessionAbsent(`Active sessions:\n  other\n→ ${uuid}\n`, uuid), false);
  assert.equal(sessionAbsent(`Active sessions:\n  ${uuid}\n`, uuid), false);
  assert.equal(sessionAbsent(`Active sessions:\n→ ${uuid}-other\n  other-${uuid}\n`, uuid), true);
  assert.equal(sessionAbsent("No active sessions", uuid), true);
});
test("session absence waits through transient retained listings", async () => {
  const outputs = [`Active sessions:\n→ ${uuid}\n`, `Active sessions:\n→ ${uuid}\n`, "Active sessions:\n  other\n"];
  let reads = 0;
  assert.equal(await waitForSessionAbsence(async () => outputs[reads++] ?? outputs.at(-1), uuid, 500), true);
  assert.equal(reads, 3);
});
test("session absence fails after bounded deadline when listing remains exact", async () => {
  await assert.rejects(waitForSessionAbsence(async () => `Active sessions:\n→ ${uuid}\n`, uuid, 25), /remained present/);
});
test("session absence accepts exact-line absence but rejects a late absent response", async () => {
  assert.equal(await waitForSessionAbsence(async (remaining) => {
    assert(remaining > 0 && remaining <= 5000);
    return `Active sessions:\n  ${uuid}-other\n`;
  }, uuid), true);
  await assert.rejects(waitForSessionAbsence(async () => {
    await new Promise((done) => setTimeout(done, 30));
    return "No active sessions";
  }, uuid, 10), /remained present/);
});
function observe({ count = 1, id = uuid, badge = "terminal unknown · uncertain", metrics = true, history = true, numerical = false, populated = false, waiting = true } = {}) {
  const metric = { textContent: waiting ? "Waiting for metrics from the current runtime." : "Missing", querySelector: () => populated ? {} : null };
  const detail = { querySelector(selector) {
    if (selector === '.identity') return { textContent: id };
    if (selector === '[data-slot="badge"]') return { textContent: badge };
    if (selector === 'section[aria-label="Current runtime metrics"]') return metrics ? metric : null;
    if (selector === 'section.metrics-chart') return history ? {} : null;
    return numerical ? {} : null;
  } };
  return runInNewContext(selectedObservationExpression, { document: { querySelectorAll: () => Array.from({ length: count }, () => detail) } });
}
test("DOM observation reports actual selected identity badge uncertainty", () => {
  const actual = observe(); assert.equal(actual.runId, uuid); assert.equal(actual.badge, "terminal unknown · uncertain"); assert.equal(actual.emptyMetrics, true); assert.equal(actual.uncertain, true);
  const completed = observe({ badge: "completed", id: "other" }); assert.equal(completed.runId, "other"); assert.equal(completed.uncertain, false);
});
test("DOM observation fails closed for ambiguous absent panel", () => { assert.equal(observe({ count: 0 }), null); assert.equal(observe({ count: 2 }), null); });
test("empty metrics rejects missing sections plots numerical values absent empty state", () => {
  for (const options of [{ metrics: false }, { history: false }, { numerical: true }, { populated: true }, { waiting: false }]) assert.equal(observe(options).emptyMetrics, false);
});
