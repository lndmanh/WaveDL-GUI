import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("CV parity is additive and keeps the default eleven real-browser scenarios", async () => {
  const shared = await readFile(new URL("./run_web_acceptance.mjs", import.meta.url), "utf8");
  const cases = shared.match(/const cases = \[([^\]]+)\]/)[1].match(/'[^']+'/g);
  assert.equal(cases.length, 11);
  assert(!cases.includes("'cv-parity'"));
  assert(shared.includes("if (name === 'cv-parity')"));
  const helper = await readFile(new URL("./browser_cv_parity.mjs", import.meta.url), "utf8");
  assert(!/network.*route|dispatchEvent|__vue|\.value\s*=/.test(helper));
  assert(helper.includes('"tools/browser_cv_parity_evidence.py"'));
});

test("CV runner requires cleanup and verifier before publishing owned report", async () => {
  const source = await readFile(new URL("./run_cv_parity_browser_acceptance.mjs", import.meta.url), "utf8");
  assert(source.includes('"--case=cv-parity"'));
  assert(source.includes("verifyCvParityFile(source)"));
  assert(source.indexOf("verifyCvParityFile(source)") < source.indexOf('writeFile(join(destination, "cv-parity.json")'));
  assert(source.includes("if (verified) await rm(temporary"));
  assert(source.includes('"Report destination must be empty"'));
});
