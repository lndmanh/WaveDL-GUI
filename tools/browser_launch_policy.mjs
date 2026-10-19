// Test-owned Chrome only: suppress browser Optimization Guide model downloads,
// not WaveDL model loading, application uploads, or artifact downloads.
// Chromium 154.0.8037.98: switch definition and ShouldFetchModels gate:
// https://chromium.googlesource.com/chromium/src/+/refs/tags/154.0.8037.98/components/optimization_guide/core/delivery/prediction_model_download_manager.cc
// Keep each option comma-free: agent-browser's --args parser splits on commas.
export const browserLaunchArgs =
  "--disable-gpu,--disable-optimization-guide-model-downloads-for-benchmarking";

// Linux Chromium creates its own private mkdtemp directory for SingletonSocket.
// Nested CI report TMPDIRs can exceed sockaddr_un even with a short session.
// Change only the browser child's temporary-directory base, never the profile,
// fixture environment, report destination or the parent's environment.
export function browserTemporaryEnvironment(environment, platform = process.platform) {
  return platform === "linux" ? { ...environment, TMPDIR: "/tmp" } : { ...environment };
}

// No filesystem paths, credentials, or platform-compatibility certification.
// The caller retains its private profile and the browser's security defaults.
export const browserLaunchPolicy = Object.freeze({
  scope: "test-owned-browser",
  optimizationGuideModelDownloads: "disabled-for-benchmarking",
});
