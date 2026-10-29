#!/usr/bin/env node
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const digest = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const sameSet = (actual, expected) => {
  assert.equal(new Set(actual).size, actual.length, "Duplicate identity");
  assert.deepEqual(actual.slice().sort(), expected.slice().sort());
};
export function verifyInstalledBrowserRecord(record, expectedWheelSha256) {
  assert.equal(record.name, "installed-wheel-browser");
  assert.equal(record.status, "passed");
  assert(digest(expectedWheelSha256), "Explicit expected wheel hash is required");
  assert.equal(record.wheelSha256, expectedWheelSha256);
  assert.equal(record.expectedWheelSha256, expectedWheelSha256);
  assert.deepEqual(record.ownedWheel, { mode: 0o400, beforeInstallSha256: expectedWheelSha256,
    afterOriginsSha256: expectedWheelSha256, finalSha256: expectedWheelSha256 });
  assert.equal(record.browser, "agent-browser 0.26.0");
  assert(Number.isFinite(Date.parse(record.started)) && Date.parse(record.finished) >= Date.parse(record.started));
  for (const key of ["error", "skip", "skipped", "failureCategory", "failureStage"]) assert(!Object.hasOwn(record, key));
  assert(record.scope.includes("fresh isolated native CPython venv") && record.scope.includes("offline wheelhouse") && record.scope.includes("local CPU only"));
  assert.deepEqual(record.environment, {
    pythonPathRemoved: true, pythonHomeRemoved: true, userSiteDisabled: true,
    systemSitePackages: false, offlineResolution: true,
  });
  const install = record.installation;
  assert(install && isAbsolute(install.prefix) && resolve(install.prefix) === install.prefix);
  const inside = path => typeof path === "string" && isAbsolute(path) && resolve(path) === path && path.startsWith(install.prefix + sep);
  assert(inside(install.python) && inside(install.console));
  assert.deepEqual(Object.keys(install.modules).sort(), ["wavedl", "wavedl.core.protocol", "wavedl_daemon", "wavedl_daemon.cli"]);
  assert(Object.values(install.modules).every(inside));
  for (const key of ["noCheckoutPath", "qtAbsent", "cwdOutsideCheckout", "pipCheck"]) assert.equal(install[key], true);
  assert.equal(install.observedSystemSitePackages, false);
  assert(record.installBudget.minimumFreeBytes >= 1024 ** 3 && record.installBudget.samples > 0 && record.installBudget.offlineOnly === true && record.installBudget.terminalExit === 0);
  assert.equal(record.pythonInterpreter, install.python);
  // The runner proves the installed files equal the wheel and its manifest; the
  // count must agree with the recorded digests rather than a fixed build size.
  assert(Number.isSafeInteger(install.assetCount) && install.assetCount >= 2);
  assert.equal(Object.keys(install.assets).length, install.assetCount);
  assert(Object.values(install.assets).every(digest) && digest(install.assetManifestSha256));
  assert.equal(install.assets[".wavedl-assets.json"], install.assetManifestSha256);
  assert.equal(record.bootstrap.removed, true);
  assert.equal(record.bootstrap.credentialKey, "wavedl.session.v1");
  const browserStorage = record.bootstrap.storage;
  assert.deepEqual(Object.keys(browserStorage).sort(), [
    "bootstrapInUrl", "cookies", "credential", "credentialInUrl", "credentialStorage", "entries", "local", "session", "valid",
  ]);
  assert.equal(browserStorage.valid, true);
  assert.equal(browserStorage.local, 0);
  assert.equal(browserStorage.session, 1);
  assert.equal(browserStorage.credential.present, true);
  assert.deepEqual(Object.keys(browserStorage.credential).sort(), [
    "daemonIdMatches", "expiresAtValid", "key", "masterTokenPresent", "originMatches", "present", "tokenInUrl", "valid",
  ]);
  assert.equal(browserStorage.credential.key, "wavedl.session.v1");
  assert.equal(browserStorage.credential.valid, true);
  assert.equal(browserStorage.credential.daemonIdMatches, true);
  assert.equal(browserStorage.credential.originMatches, true);
  assert.equal(browserStorage.credential.expiresAtValid, true);
  assert.equal(browserStorage.credentialStorage, "session");
  assert.equal(browserStorage.credential.masterTokenPresent, false);
  assert.equal(browserStorage.credentialInUrl, false);
  assert.equal(browserStorage.bootstrapInUrl, false);
  assert.equal(browserStorage.cookies, "");
  const train = record.trainingManifest;
  assert(uuid(train.run_id));
  assert.equal(train.operation, "train");
  assert.equal(train.resolved_config.model, "cnn");
  assert.equal(train.resolved_config.epochs, 3);
  assert.equal(train.resolved_config.workers, 0);
  assert.equal(train.runtime.device, "cpu");
  assert.equal(train.runtime.python, install.python);
  assert.equal(record.previewRegistry.plans, 1);
  assert.equal(record.previewRegistry.executions.length, 0);
  assert.deepEqual(record.previewRegistry.submissions, []);
  assert(record.previewRegistry.control.length === 1 && record.previewRegistry.control.every(row => row.submission_requested === 0 && row.cancellation_requested === 0));
  assert.equal(record.trainingSettled.plans, 2);
  assert.equal(record.trainingSettled.runs.length, 2);
  assert(record.trainingSettled.runs.every(run => run.state === "completed"));
  const proof = record.resultOperations;
  assert.equal(proof.sourceRunId, train.run_id);
  assert.equal(proof.approved.operation, "test");
  assert.equal(proof.approved.checkpoint_source.run_id, train.run_id);
  assert.equal(proof.approved.checkpoint_source.generation, proof.selected.value);
  assert.deepEqual(proof.refusal.before, proof.refusal.after);
  assert.equal(proof.refusal.invalid, "true");
  assert.equal(proof.durable.plans.length, 4);
  assert(proof.durable.plans.every(plan => uuid(plan.plan_id) && uuid(plan.manifest.run_id)));
  assert.equal(new Set(proof.durable.plans.map(plan => plan.plan_id)).size, 4);
  assert.equal(new Set(proof.durable.plans.map(plan => plan.manifest.run_id)).size, 4);
  assert.equal(proof.durable.plans.filter(plan => plan.submission_requested === 1).length, 3);
  assert(proof.durable.plans.every(plan => plan.cancellation_requested === 0));
  const submitted = proof.durable.plans.filter(plan => plan.submission_requested === 1);
  const trainingPlan = submitted.find(plan => plan.manifest.run_id === train.run_id);
  assert(trainingPlan);
  assert.deepEqual(trainingPlan.manifest, train);
  const evaluationPlan = submitted.find(plan => plan.manifest.run_id === proof.approved.run_id);
  assert(evaluationPlan);
  assert.deepEqual(evaluationPlan.manifest, proof.approved);
  const plotPlans = submitted.filter(plan => plan.manifest.operation === "plot");
  assert.equal(plotPlans.length, 1);
  const plot = plotPlans[0];
  assert.equal(plot.manifest.checkpoint_source.run_id, train.run_id);
  const source = proof.durable.runs.find(run => run.runId === train.run_id);
  assert(source && source.state === "completed");
  assert(source.publications.some(item => item.generation === plot.manifest.checkpoint_source.generation));
  assert(source.publications.some(item => item.generation === proof.approved.checkpoint_source.generation));
  sameSet(proof.durable.runs.map(run => run.runId), [train.run_id, proof.approved.run_id]);
  const evaluation = proof.durable.runs.find(run => run.runId === proof.approved.run_id);
  assert(evaluation && evaluation.state === "completed");
  assert(evaluation.events.some(event => event.type === "exit" && event.run_id === evaluation.runId && event.payload.status === "completed"));
  assert(evaluation.events.some(event => event.type === "metric" && event.payload?.name === "evaluation"
    && Object.keys(event.payload.metrics).length > 0 && Object.values(event.payload.metrics).every(Number.isFinite)));
  assert.equal(record.predictions.runId, evaluation.runId);
  const publication = evaluation.publications.find(item => item.generation === record.predictions.generation);
  assert(publication && digest(publication.completeSha256));
  assert.deepEqual(publication.complete.files["predictions.csv"], record.predictions.expected);
  assert.deepEqual(publication.verifiedFiles["predictions.csv"], record.predictions.expected);
  assert.deepEqual(record.predictions.actual, record.predictions.expected);
  assert(record.predictions.actual.size > 0 && digest(record.predictions.actual.sha256));
  assert.equal(record.finalRegistry.plans, 4);
  assert.equal(record.finalRegistry.runs.length, 3);
  assert.equal(record.finalRegistry.executions.length, 3);
  sameSet(record.finalRegistry.runs.map(run => run.run_id), submitted.map(plan => plan.manifest.run_id));
  sameSet(record.finalRegistry.executions.map(row => row.plan_id), submitted.map(plan => plan.plan_id));
  sameSet(record.finalRegistry.submissions.map(row => row.plan_id), submitted.map(plan => plan.plan_id));
  assert(record.finalRegistry.runs.every(run => uuid(run.run_id)));
  assert(record.finalRegistry.submissions.every(row => uuid(row.plan_id) && uuid(row.run_id) && uuid(row.request_id)));
  assert.deepEqual(record.finalRegistry.control.map(row => ({ ...row })).sort((a, b) => a.plan_id.localeCompare(b.plan_id)),
    proof.durable.plans.map(plan => ({ plan_id: plan.plan_id, submission_requested: plan.submission_requested, cancellation_requested: plan.cancellation_requested })).sort((a, b) => a.plan_id.localeCompare(b.plan_id)));
  assert(record.finalRegistry.runs.every(run => run.state === "completed"));
  assert(record.finalRegistry.executions.every(row => row.observed_status === "terminal" && row.cancel_delivered === 0));
  assert.equal(record.finalRegistry.submissions.length, 3);
  assert.equal(new Set(record.finalRegistry.submissions.map(row => row.plan_id)).size, 3);
  for (const source of record.finalRegistry.submissions) {
    const plan = submitted.find(plan => plan.plan_id === source.plan_id);
    assert(plan && source.run_id === plan.manifest.run_id);
    const execution = record.finalRegistry.executions.find(row => row.plan_id === source.plan_id);
    assert(execution && ["run_id", "request_id", "pid", "supervisor_id"].every(key => execution[key] === source[key]));
    assert(record.finalRegistry.runs.some(run => run.run_id === source.run_id));
  }
  assert.deepEqual(record.cleanupRegistry, record.finalRegistry);
  // Without a session in the tab, routing lands on login returning to the page.
  const routedTo = (path) => [path, `/login?next=${encodeURIComponent(path)}`];
  assert(routedTo("/datasets").includes(record.staticClient?.path));
  assert.deepEqual(record.staticClient, { path: record.staticClient.path, shell: true, apiStatus: 401, apiType: "application/json" });
  assert(routedTo("/experiments").includes(record.unknownPath?.path));
  assert.deepEqual(record.unknownPath, { path: record.unknownPath.path, shell: true });
  assert(Array.isArray(record.runtimePids) && record.runtimePids.length === 3 && new Set(record.runtimePids).size === 3 && record.runtimePids.every(pid => Number.isSafeInteger(pid) && pid > 0));
  sameSet(record.runtimePids, record.finalRegistry.submissions.map(row => row.pid));
  assert.deepEqual(record.cleanup, { errors: [], browserAbsent: true, daemonReaped: true, listenerAbsent: true,
    applicationShutdownComplete: true, daemonPidAbsent: true, runtimePidsAndGroupsAbsent: true, storageClosed: true, ownedRootsRemoved: true, credentialFileRemoved: true });
  assert(record.daemonExit && Object.keys(record.daemonExit).length === 2 &&
    (([0, 130].includes(record.daemonExit.code) && record.daemonExit.signal === null) ||
      (record.daemonExit.code === null && record.daemonExit.signal === "SIGINT")));
  return record;
}

export async function verifyInstalledBrowserFile(path, expectedWheelSha256) {
  const before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size < 1024 * 1024);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    assert(stat.dev === before.dev && stat.ino === before.ino && stat.isFile() && stat.size === before.size);
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, null);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    const after = await handle.stat();
    assert(size === before.size && after.size === stat.size && after.mtimeMs === stat.mtimeMs && after.ctimeMs === stat.ctimeMs);
    return verifyInstalledBrowserRecord(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size))), expectedWheelSha256);
  } finally { await handle.close(); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { assert(process.argv.length === 4); await verifyInstalledBrowserFile(process.argv[2], process.argv[3]); console.log("Installed wheel browser report verified"); }
  catch { console.error("Installed wheel browser evidence rejected"); process.exitCode = 1; }
}
