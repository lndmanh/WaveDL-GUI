import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { absent, assertOwnedWorkspace, attackObservation, authenticatedGetControl, gracefulFixtureExit, hostilePageHTML, sessionAbsent, validateOrigins, validateReportPath, waitForSessionAbsence } from "./run_hostile_origin_browser_acceptance.mjs";

test("Node GET control uses the genuine public query schema and separate receipt metadata", () => {
  const control = authenticatedGetControl("http://127.0.0.1:31001", "synthetic-test-bearer");
  const url = new URL(control.url);
  assert.equal(url.pathname, "/api/runs"); assert.equal(url.search, "");
  assert.equal(control.options.headers["X-WaveDL-Acceptance-Case"], "node-get");
  assert.equal(control.options.headers.Authorization, "Bearer synthetic-test-bearer");
  assert.equal(control.options.method, undefined);
  assert.equal(control.options.signal.aborted, false);
});
test("fixture exit accepts SIGINT only with independently measured service closure", () => {
  for (const exit of [{ code: 0, signal: null }, { code: null, signal: "SIGINT" }]) {
    assert(gracefulFixtureExit(exit, true)); assert(!gracefulFixtureExit(exit, false));
  }
  for (const exit of [undefined, { code: 1, signal: null }, { code: null, signal: "SIGKILL" }, { code: 0, signal: "SIGINT" }]) assert(!gracefulFixtureExit(exit, true));
});

test("served attack script wires native controls to distinct real-request intents", async () => {
  // This DOM harness tests page wiring, not CORS or browser certification. The
  // acceptance runner itself always uses a real browser and daemon receipts.
  const origin = "http://127.0.0.1:31001", cancel = "/api/runs/11111111-1111-1111-1111-111111111111/cancel";
  const html = hostilePageHTML(origin, cancel);
  const controls = Object.fromEntries(["simple-get", "simple-post", "native-form", "bearer-json", "cookie-only"].map((name) => [name, {}]));
  const result = {}, requests = [], forms = [], location = {};
  const document = { cookie: "", querySelector: () => result, getElementById: (id) => controls[id],
    body: { append: (form) => forms.push(form) }, createElement: (tag) => {
      assert.equal(tag, "form"); return { submit() { this.submitted = true; } };
    } };
  runInNewContext(html.match(/<script>([\s\S]*)<\/script>/)[1], {
    document, location, fetch: async (url, options) => { requests.push({ url, options }); throw new TypeError("CORS refusal simulation for wiring test only"); },
  });
  assert.match(document.cookie, /^acceptance_marker=hostile;/);
  for (const id of ["simple-get", "simple-post", "bearer-json"]) {
    await controls[id].onclick();
    assert.equal(result.textContent, `${id === "bearer-json" ? "json-post" : id}:rejected`);
  }
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, `${origin}/api/runs?acceptance_case=simple-get`);
  assert.equal(requests[0].options.credentials, "include");
  assert.equal(requests[0].options.headers, undefined);
  assert.equal(requests[1].url, `${origin}${cancel}?acceptance_case=simple-post`);
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].options.headers, undefined);
  assert.equal(requests[1].options.body, undefined);
  assert.equal(requests[2].url, `${origin}${cancel}?acceptance_case=json-post`);
  assert.equal(requests[2].options.headers.Authorization, "Bearer synthetic-attack-only");
  assert.equal(requests[2].options.headers["Content-Type"], "application/json");
  assert.equal(requests[2].options.body, "{}");
  controls["native-form"].onclick();
  assert.equal(forms.length, 1); assert.equal(forms[0].submitted, true);
  assert.equal(forms[0].method, "POST"); assert.equal(forms[0].target, "sink");
  assert.equal(forms[0].action, `${origin}${cancel}?acceptance_case=form-post`);
  assert.equal(result.textContent, "form-post:submitted");
  controls["cookie-only"].onclick();
  assert.equal(location.href, `${origin}/api/runs?acceptance_case=cookie-only`);
});

test("origin policy requires same loopback hostname and genuinely different ports", () => {
  validateOrigins("http://127.0.0.1:31001", "http://127.0.0.1:31002");
  for (const origin of ["http://127.0.0.1:31001", "http://localhost:31002", "https://127.0.0.1:31002", "http://127.0.0.1:31002/?x=1", "http://user@127.0.0.1:31002"]) {
    assert.throws(() => validateOrigins("http://127.0.0.1:31001", origin));
  }
});
test("DOM interpretation derives the actual observed outcome and rejects copied/successful text", () => {
  assert.deepEqual(attackObservation("simple-get", "simple-get:rejected"), { outcome: "rejected", text: "simple-get:rejected" });
  assert.deepEqual(attackObservation("form-post", "form-post:submitted"), { outcome: "submitted", text: "form-post:submitted" });
  for (const text of ["simple-get:200", "simple-post:rejected", "simple-get:rejected:extra", "", "simple-get:submitted"]) {
    assert.throws(() => attackObservation("simple-get", text));
  }
});
test("session absence checks exact names and bounded polls", async () => {
  assert(sessionAbsent("other-session\nprefix-owned-suffix", "owned"));
  assert(!sessionAbsent("→ owned\nother", "owned"));
  let calls = 0;
  assert(await waitForSessionAbsence(async () => ++calls === 1 ? "owned" : "other", "owned", 500));
  await assert.rejects(waitForSessionAbsence(async () => "owned", "owned", 10), /bounded close wait/);
});
test("report path rejects existing destinations and linked parent chains", async () => {
  const work = await realpath(await mkdtemp(join(await realpath(tmpdir()), "wavedl-hostile-test-")));
  try {
    const ordinary = join(work, "ordinary"); await mkdir(ordinary);
    const report = join(ordinary, "new.json"); assert.equal(await validateReportPath(report), report);
    await writeFile(report, "{}", { flag: "wx" });
    await assert.rejects(validateReportPath(report));
    await symlink(ordinary, join(work, "linked"));
    await assert.rejects(validateReportPath(join(work, "linked", "newer.json")));
    await symlink(join(work, "missing"), join(work, "dangling"));
    await assert.rejects(validateReportPath(join(work, "dangling")));
    await assert.rejects(validateReportPath("relative.json"));
    assert(await absent(join(work, "missing")));
  } finally { await rm(work, { recursive: true }); }
});
test("workspace destruction guard requires inode owner mode marker and ordinary tree", async () => {
  const work = await realpath(await mkdtemp(join(await realpath(tmpdir()), "wavedl-hostile-test-")));
  try {
    await chmod(work, 0o700);
    await writeFile(join(work, ".owner"), "owned-marker", { flag: "wx", mode: 0o600 });
    const stat = await lstat(work);
    await assertOwnedWorkspace(work, stat, "owned-marker");
    await assert.rejects(assertOwnedWorkspace(work, stat, "wrong-marker"));
    await assert.rejects(assertOwnedWorkspace(work, { ...stat, ino: stat.ino + 1 }, "owned-marker"));
    await chmod(work, 0o755);
    await assert.rejects(assertOwnedWorkspace(work, stat, "owned-marker"));
    await chmod(work, 0o700);
    await chmod(join(work, ".owner"), 0o644);
    await assert.rejects(assertOwnedWorkspace(work, stat, "owned-marker"));
  } finally { await rm(work, { recursive: true }); }
});
test("runner uses real native attacks and measured daemon evidence, never request injection", async () => {
  const source = await readFile(new URL("./run_hostile_origin_browser_acceptance.mjs", import.meta.url), "utf8");
  assert.match(source, /createServer/); assert.match(source, /127\.0\.0\.1/);
  assert.match(source, /credentials:'include'/); assert.match(source, /f\.submit\(\)/);
  assert.match(source, /Bearer synthetic-attack-only/);
  assert.match(source, /actions\.button\(label\)/);
  assert.match(source, /document\.querySelector\('#result'\)\.textContent/);
  assert.match(source, /document\.body\.innerText/);
  assert.match(source, /snapshot\("before"\)/); assert.match(source, /snapshot\("after"\)/);
  assert.match(source, /snapshot\("positive"\)/);
  assert.match(source, /assert\.deepEqual\(storageBefore, storageAfter/);
  assert.match(source, /node-fetch-not-browser/);
  assert.match(source, /verifyHostileOriginReport/);
  assert.match(source, /attackServer\.closeAllConnections\(\)/);
  assert.match(source, /boundedCommand/); assert.match(source, /workDeadline/);
  assert.doesNotMatch(source, /page\.route|setRequestInterception|fetch\s*=|vi\.mock|--disable-web-security|--no-sandbox|--auto-connect/);
  assert.doesNotMatch(source, /localStorage\.setItem|sessionStorage\.setItem|network",\s*"route/);
});
