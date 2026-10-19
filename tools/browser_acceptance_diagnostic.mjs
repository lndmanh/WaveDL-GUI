// Finite nonsecret stage markers survive nested command-output suppression.
// They locate a failed gate; they never replace its report or prove acceptance.
const stages = new Set([
  "fixture-startup", "browser-open", "browser-readiness", "scenario", "cleanup",
]);

export function acceptanceDiagnostic(stage) {
  return stages.has(stage) ? `WAVEDL_ACCEPTANCE_DIAGNOSTIC=${stage}` : null;
}
