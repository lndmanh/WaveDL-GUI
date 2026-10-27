#!/usr/bin/env node
// Focused export of the shared real-browser / real-daemon acceptance flow.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedCommand } from './browser_process.mjs';
import { REPORT_NAME, verifySubmittedPlanReport } from './verify_submitted_plan_browser_report.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
assert(destination, 'Usage: run_submitted_plan_browser_acceptance.mjs REPORT_DIR');
await mkdir(resolve(destination), { mode: 0o700 });
const runnerTemporary = await mkdtemp(join(tmpdir(), 'wavedl-submitted-runner-'));
let output;
try {
  output = await boundedCommand(process.execPath, ['tools/run_web_acceptance.mjs', '--case=submitted-plan-authoring-protection'], { cwd: repo, env: { ...process.env, TMPDIR: runnerTemporary }, timeout: 300000,
    redact: value => String(value).split('\n').filter(line => /^Nonsecret evidence: \/(?:private\/)?(?:var\/folders\/|tmp\/)\S+\/summary\.json$/.test(line)).join('\n') });
} catch (error) {
  const evidencePath = String(error.stdout ?? '').match(/Nonsecret evidence: (.+\/summary\.json)/)?.[1];
  if (evidencePath) console.error(`Retained failed acceptance evidence: ${evidencePath}`);
  throw error;
}
const path = output.match(/Nonsecret evidence: (.+\/summary\.json)/)?.[1];
assert(path, 'Shared runner must emit its completed evidence path');
const summary = JSON.parse(await readFile(path, 'utf8'));
assert.equal(summary.cases.length, 1);
const record = summary.cases[0];
assert.equal(record.status, 'passed');
assert.deepEqual(record.cleanup.errors, []);
const source = record.cleanup;
assert((source.fixtureExit.code === 0 && source.fixtureExit.signal === null) || (source.fixtureExit.code === null && source.fixtureExit.signal === 'SIGINT'), 'Fixture must be reaped after graceful SIGINT and confirmed services closure');
record.cleanup = { errors: [], browserSessionAbsent: source.browserSessionAbsent,
  fixtureReaped: true, servicesClosed: source.fixtureServicesClosed,
  listenerClosed: source.listenerClosed, ownedRootsRemoved: source.removedOwnedRoots && source.browserProfileRemoved };
await writeFile(join(resolve(destination), REPORT_NAME), JSON.stringify(record, null, 2), { flag: 'wx', mode: 0o600 });
await verifySubmittedPlanReport(destination);
console.log(`Submitted-plan browser evidence: ${join(resolve(destination), REPORT_NAME)}`);
