#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readdir, realpath, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedCommand } from './browser_process.mjs';
import { REPORT_NAME, readWizardEvidence, verifyWizardProgressionFile, verifyWizardProgressionReport } from './verify_wizard_progression_browser_report.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2];
assert(destination, 'Usage: run_wizard_progression_browser_acceptance.mjs REPORT_DIR');
const requested = resolve(destination);
for (let parent = dirname(requested); parent !== dirname(parent); parent = dirname(parent)) {
  const stat = await lstat(parent);
  assert(stat.isDirectory() && !stat.isSymbolicLink());
}
const target = join(await realpath(dirname(requested)), basename(requested));
try { await mkdir(target, { mode: 0o700 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
assert((await lstat(target)).isDirectory() && !(await lstat(target)).isSymbolicLink());
assert.deepEqual(await readdir(target), []);
const temporary = await mkdtemp(join(await realpath(tmpdir()), 'wavedl-wizard-runner-'));
let verified = false;
try {
  const output = await boundedCommand(process.execPath, ['tools/run_web_acceptance.mjs', '--case=wizard-progression'], {
    cwd: repo, env: { ...process.env, TMPDIR: temporary }, timeout: 300000,
    redact: value => String(value).split('\n').filter(line => /^Nonsecret evidence: \/(?:private\/)?(?:var\/folders\/|tmp\/)\S+\/summary\.json$/.test(line)).join('\n'),
  });
  const path = output.match(/Nonsecret evidence: (.+\/summary\.json)/)?.[1];
  assert(path, 'Shared runner must emit completed evidence');
  const inside = relative(temporary, await realpath(path));
  assert(inside && inside !== '..' && !inside.startsWith(`..${sep}`) && !inside.startsWith(sep));
  const summary = JSON.parse(await readWizardEvidence(path));
  assert.equal(summary.cases.length, 1);
  const record = summary.cases[0];
  assert.equal(record.status, 'passed');
  const source = path.replace(/\/summary\.json$/, '/wizard-progression.json');
  assert.deepEqual(await verifyWizardProgressionFile(source), record);
  verified = true;
  await writeFile(join(target, REPORT_NAME), await readWizardEvidence(source), { flag: 'wx', mode: 0o600 });
  await verifyWizardProgressionReport(target);
  console.log(`Wizard progression browser evidence: ${join(target, REPORT_NAME)}`);
} finally {
  if (verified) await rm(temporary, { recursive: true, force: true });
  else console.error(`Unverified private runner evidence retained: ${temporary}`);
}
