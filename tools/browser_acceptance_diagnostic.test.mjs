import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { acceptanceDiagnostic } from "./browser_acceptance_diagnostic.mjs";

test("only finite acceptance stages can leave the diagnostic boundary", () => {
  for (const stage of ["fixture-startup", "browser-open", "browser-readiness", "scenario", "cleanup"])
    assert.equal(acceptanceDiagnostic(stage), `WAVEDL_ACCEPTANCE_DIAGNOSTIC=${stage}`);
  for (const value of [undefined, null, {}, "", "private-bearer", "browser-open\nprivate-bearer", "http://localhost/?bootstrap=private-bearer"])
    assert.equal(acceptanceDiagnostic(value), null);
});

test("shared runner locates failures without copying child output into markers", async () => {
  const source = await readFile(new URL("./run_web_acceptance.mjs", import.meta.url), "utf8");
  for (const stage of ["fixture-startup", "browser-open", "browser-readiness", "scenario"])
    assert(source.includes(`diagnosticStage = '${stage}'`));
  assert(source.includes("console.error(acceptanceDiagnostic(diagnosticStage))"));
  assert(source.includes("console.error(acceptanceDiagnostic('cleanup'))"));
  assert(!source.includes("acceptanceDiagnostic(error"));
});
