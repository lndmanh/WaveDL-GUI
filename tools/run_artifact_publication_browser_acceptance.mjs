#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { boundedCommand } from "./browser_process.mjs";
import { browserLaunchArgs } from "./browser_launch_policy.mjs";
import { createBrowserActions, DRIVER_READINESS_MODE } from "./browser_actions.mjs";
import { verifyArtifactPublicationReport } from "./verify_artifact_publication_browser_report.mjs";

const repo = resolve(fileURLToPath(new URL("..", import.meta.url)));
const python = process.env.WAVEDL_PYTHON ?? "python";
const browser = process.env.AGENT_BROWSER_BIN ?? "agent-browser";
const reportRoot = resolve(
  process.argv[2] ?? (await mkdtemp(join(tmpdir(), "wavedl-artifact-publication-"))),
);
await mkdir(reportRoot, { recursive: true, mode: 0o700 });
assert.equal((await readdir(reportRoot)).length, 0, "Report root must be empty");
const root = join(reportRoot, "fixture"),
  profile = join(reportRoot, "profile"),
  tokenFile = join(reportRoot, "token"),
  downloads = join(reportRoot, "downloads");
await mkdir(root, { mode: 0o700 });
await mkdir(profile, { mode: 0o700 });
await mkdir(downloads, { mode: 0o700 });
const privateCredential = randomBytes(32).toString("base64url");
await writeFile(tokenFile, privateCredential, { mode: 0o600 });
const evidencePath = join(reportRoot, "boundary.jsonl"),
  arm = join(reportRoot, "arm");
const boundaryProgram = `import asyncio,json,sys,hashlib
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'tools'))
import browser_daemon_fixture as fixture
original=fixture.create_app
root,token,evidence,arm=map(Path,sys.argv[1:])
def create_app(*args,**kwargs):
    app=original(*args,**kwargs)
    async def boundary(scope,receive,send):
        path=scope.get('path','')
        target=scope['type']=='http' and path.startswith('/api/runs/') and path.endswith('/artifacts') and arm.exists()
        if not target:
            if scope['type']=='http' and '/artifacts/gen-' in path and arm.exists():
                with evidence.open('a') as stream: stream.write(json.dumps({'kind':'artifact-get','path':path})+'\\n')
            return await app(scope,receive,send)
        messages=[]
        async def capture(message):
            messages.append(message)
            if sum(len(m.get('body',b'')) for m in messages)>262144: raise RuntimeError('Inventory boundary exceeded bound')
        await app(scope,receive,capture)
        start=next(m for m in messages if m['type']=='http.response.start')
        body=b''.join(m.get('body',b'') for m in messages)
        value=json.loads(body)
        delivered=json.loads(body)
        generation=delivered['generations'][0]
        member=next(iter(generation['files']))
        mode=arm.read_text()
        if mode=='traversal': generation['files']['../manifest.json']=generation['files'].pop(member)
        else: generation['files'][member]['size']=67108865
        changed=json.dumps(delivered,separators=(',',':')).encode()
        with evidence.open('a') as stream:
            if evidence.stat().st_size>1048576: raise RuntimeError('Boundary evidence exceeds bound')
            stream.write(json.dumps({'kind':'oversized-inventory','path':path,'status':start['status'],'authenticated':any(k.lower()==b'authorization' and v.startswith(b'Bearer ') for k,v in scope['headers']),'original':value,'delivered':delivered,'originalText':body.decode(),'deliveredText':changed.decode(),'originalSha256':hashlib.sha256(body).hexdigest(),'originalBytes':len(body),'deliveredSha256':hashlib.sha256(changed).hexdigest(),'deliveredBytes':len(changed),'member':member,'generation':generation['generation']})+'\\n')
        await send({**start,'headers':[(k,v) for k,v in start['headers'] if k.lower()!=b'content-length']+[(b'content-length',str(len(changed)).encode())]})
        await send({'type':'http.response.body','body':changed})
    return boundary
fixture.create_app=create_app
asyncio.run(fixture.serve_fixture(root,1,0,token_file=token,record_process_results=True))`;
const fixture = spawn(python, ["-c", boundaryProgram, root, tokenFile, evidencePath, arm], {
  cwd: repo,
  detached: process.platform !== "win32",
  env: {
    ...process.env,
    PYTHONPATH: join(repo, "src"),
    OMP_NUM_THREADS: "1",
    MKL_NUM_THREADS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let fixtureSpawnError;
fixture.once("error", (error) => {
  fixtureSpawnError = error;
});
let fixturePipeClosed = false;
fixture.once("close", () => { fixturePipeClosed = true; });
let stdout = "", stdoutBytes = 0, stdoutExceeded = false;
fixture.stdout.on("data", (x) => {
  stdoutBytes += x.length;
  if (stdoutBytes > 1048576) stdoutExceeded = true;
  else if (!stdoutExceeded) stdout += x;
});
fixture.stderr.on("data", () => {});
const waitReady = async () => {
  const until = Date.now() + 180000;
  while (Date.now() < until) {
    const m = stdout.match(/Browser: (http:\/\/[^\s]+)/);
    if (m) return m[1];
    if (fixtureSpawnError) throw new Error("fixture spawn failed");
    if (stdoutExceeded) throw new Error("fixture stdout limit exceeded");
    if (fixture.exitCode !== null) throw new Error("fixture exited");
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("fixture readiness timeout");
};
const record = {
  name: "artifact-publication-oversized-inventory",
  status: "running",
  assertions: [],
};
const check = (v, m) => {
  assert(v, m);
  record.assertions.push(m);
};
let opened = false;
let origin;
let credentialSecret = privateCredential;
const session = `wavedl-artifact-${randomUUID().slice(0, 12)}`;
const proof = async () =>
  JSON.parse(
    await boundedCommand(
      python,
      [
        "-c",
        `import sys,json,sqlite3,hashlib
from pathlib import Path
root=Path(sys.argv[1]); db=sqlite3.connect((root/'state/registry.db').as_uri()+'?mode=ro',uri=True); db.row_factory=sqlite3.Row
registry={table:[dict(row) for row in db.execute('SELECT * FROM '+table+' ORDER BY rowid')] for table in ('runs','plans','plan_control','execution_control','cursors','event_log')}
files={}
for p in sorted((root/'runs').rglob('*')):
    if p.is_symlink(): raise RuntimeError('Symlink in owned run proof')
    if p.is_file():
        if p.stat().st_size>67108864 or len(files)>=256: raise RuntimeError('Run proof exceeds bound')
        files[str(p.relative_to(root/'runs'))]={'size':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()}
print(json.dumps({'registry':registry,'files':files}))`,
        root,
      ],
      { cwd: repo, timeout: 35000 },
    ),
  );
try {
  const sessionUrl = await waitReady();
  origin = new URL(sessionUrl).origin;
  const browserEnv = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([k]) => !k.startsWith("AGENT_BROWSER_")),
    ),
    AGENT_BROWSER_SESSION: session,
  };
  const cmd = (args, timeout = 45000) => {
    record.stage = args[0];
    return boundedCommand(
      browser,
      ["--session", session, ...(args[0] === "open" ? ["--args", browserLaunchArgs] : []), ...args],
      { cwd: repo, timeout, env: browserEnv },
    );
  };
  const dom = async (s) =>
    JSON.parse(JSON.parse(await cmd(["eval", "-b", Buffer.from(s).toString("base64")])));
  const actions = createBrowserActions({
    cli: (...args) => cmd(args),
    dom,
    snapshot: () => cmd(["snapshot", "-i"]),
  });
  record.driverReadinessMode = DRIVER_READINESS_MODE;
  record.assetManifestSha256 = createHash("sha256")
    .update(await readFile(join(repo, "src/wavedl_daemon/web_assets/.wavedl-assets.json")))
    .digest("hex");
  record.browser = await boundedCommand(browser, ["--version"], { cwd: repo, timeout: 10000 });
  opened = true;
  await cmd([
    "open",
    sessionUrl,
    "--profile",
    profile,
    "--engine",
    "chrome",
    "--headed",
    String(process.env.WAVEDL_BROWSER_HEADED === "true"),
    ...(process.env.WAVEDL_BROWSER_EXECUTABLE
      ? ["--executable-path", process.env.WAVEDL_BROWSER_EXECUTABLE]
      : []),
    "--download-path",
    downloads,
    "--allowed-domains",
    "127.0.0.1,localhost",
  ]);
  await cmd(["set", "viewport", "1280", "900"]);
  await cmd(["wait", "--text", "Connected"]);
  const runId = stdout.match(/Run: ([0-9a-f-]{36})/)?.[1];
  assert(runId);
  record.runId = runId;
  const deadline = Date.now() + 120000;
  while (true) {
    const p = await proof();
    if (p.registry.runs.some((r) => r.state === "failed")) throw new Error("CPU training failed");
    if (p.registry.runs.length === 1 && p.registry.runs[0].state === "completed") break;
    assert(Date.now() < deadline, "CPU completion timeout");
    await new Promise((r) => setTimeout(r, 300));
  }
  await cmd([
    "wait",
    "--fn",
    `Array.from(document.querySelectorAll('[aria-label="Runs"] small')).some(e=>e.textContent.trim()===${JSON.stringify(runId)})`,
  ]);
  await cmd([
    "click",
    await actions.readyControl("button", runId, false, {
      locator: `xpath=//section[@aria-label='Runs']//button[.//small[normalize-space()='${runId}']]`,
    }),
  ]);
  await actions.button("Results");
  record.before = await proof();
  const credential = await readFile(tokenFile, "utf8");
  credentialSecret = credential.trim();
  const authFetch = (path) =>
    fetch(origin + path, {
      headers: { authorization: "Bearer " + credential },
      signal: AbortSignal.timeout(10000),
    });
  const actualInventory = await authFetch(`/api/runs/${runId}/artifacts`);
  assert.equal(actualInventory.status, 200);
  const inventory = await actualInventory.json();
  const published = inventory.generations[0],
    member = Object.keys(published.files)[0];
  const artifactResponse = await authFetch(
    `/api/runs/${runId}/artifacts/${published.generation}/${member.split("/").map(encodeURIComponent).join("/")}`,
  );
  assert.equal(artifactResponse.status, 200);
  const artifactBytes = Buffer.from(await artifactResponse.arrayBuffer());
  record.realArtifactResponse = {
    status: artifactResponse.status,
    size: artifactBytes.length,
    sha256: createHash("sha256").update(artifactBytes).digest("hex"),
    generation: published.generation,
    member,
  };
  assert.deepEqual(
    { size: record.realArtifactResponse.size, sha256: record.realArtifactResponse.sha256 },
    published.files[member],
  );
  const completeText = await readFile(
    join(root, "runs", runId, "checkpoints", published.generation, "COMPLETE.json"),
    "utf8",
  );
  record.publication = {
    completeText,
    complete: JSON.parse(completeText),
    size: Buffer.byteLength(completeText),
    sha256: createHash("sha256").update(completeText).digest("hex"),
  };
  await writeFile(arm, "oversized", { flag: "wx", mode: 0o600 });
  await actions.button("Refresh artifacts");
  await cmd(["wait", "--text", "Download"]);
  const boundary = JSON.parse((await readFile(evidencePath, "utf8")).trim());
  const rowScope = `//section[@aria-labelledby='results-title']//tbody/tr[normalize-space(td[2])=${JSON.stringify(boundary.member)} and starts-with(normalize-space(td[1]),${JSON.stringify(boundary.generation)})]`;
  await actions.button("Download", false, { scope: rowScope });
  await cmd(["wait", "--text", "64 MiB browser budget"]);
  record.boundary = (await readFile(evidencePath, "utf8")).trim().split("\n").map(JSON.parse);
  record.publicDom = await dom(
    `JSON.stringify({refused:document.body.innerText.includes('This artifact exceeds the 64 MiB browser budget. Export with the CLI.'),previewImages:document.querySelectorAll('section[aria-labelledby="results-title"] img').length,downloadLinks:document.querySelectorAll('section[aria-labelledby="results-title"] a[download]').length})`,
  );
  record.downloadNames = await readdir(downloads);
  record.after = await proof();
  check(
    record.boundary.length === 1 &&
      record.boundary[0].authenticated &&
      record.boundary[0].status === 200,
    "One real authenticated completed inventory was mutated at the ASGI response boundary",
  );
  check(
    record.boundary.every((e) => e.kind !== "artifact-get"),
    "Oversized declared artifact is rejected before any artifact GET",
  );
  check(
    record.publicDom.refused &&
      record.publicDom.previewImages === 0 &&
      record.publicDom.downloadLinks === 0 &&
      record.downloadNames.length === 0,
    "Public Download refuses with budget guidance and no file or preview publication",
  );
  assert.deepEqual(record.before, record.after);
  check(
    true,
    "Actual publication bytes, COMPLETE marker, runtime journal, and durable registry remain unchanged",
  );
  // These are explicitly fixture-created filesystem cases, not training outputs.
  // Keep the original completed runtime/publication proof separate above.
  await writeFile(arm, "traversal", { mode: 0o600 });
  await actions.button("Refresh artifacts");
  await cmd(["wait", "--text", "Connect securely"]);
  const traversalBoundary = (await readFile(evidencePath, "utf8")).trim().split("\n").map(JSON.parse);
  record.safetyCases = {
    traversal: {
      boundary: traversalBoundary[1],
      refused: await dom(`JSON.stringify(Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Connect securely' && b.getClientRects().length>0) && !Array.from(document.querySelectorAll('section[aria-labelledby="results-title"] button')).some(b=>b.textContent.trim()==='Download' && b.getClientRects().length>0))`),
      downloads: await readdir(downloads),
    },
  };
  assert.equal(traversalBoundary.length, 2, "Traversal inventory must not cause an artifact GET");
  await rm(arm);
  await cmd(["fill", "#daemon-bearer", credential]);
  await actions.button("Connect securely");
  await cmd(["wait", "--text", "Connected"]);
  // Scope retirement intentionally clears the selected run. Re-authorize the
  // original run through the public list before opening its Results again.
  await actions.button("Experiments");
  await cmd([
    "click",
    await actions.readyControl("button", runId, false, {
      locator: `xpath=//section[@aria-label='Runs']//button[.//small[normalize-space()='${runId}']]`,
    }),
  ]);
  await actions.button("Results");
  const prepared = JSON.parse(await boundedCommand(python, ["-c", `import json,sys
from pathlib import Path
from wavedl.core.layout import RunLayout
from wavedl.core.generations import publish_generation
root=Path(sys.argv[1]); run_id=sys.argv[2]
layout=RunLayout(root/'runs'/run_id,run_id)
staging=root/'active-staging'; staging.mkdir(mode=0o700)
contents={'active.html':b'<html><script>document.documentElement.dataset.wavedlArtifactExecuted="yes"</script></html>', 'active.svg':b'<svg xmlns="http://www.w3.org/2000/svg" onload="document.documentElement.dataset.wavedlArtifactExecuted=String.fromCharCode(121,101,115)"></svg>'}
for name,data in contents.items(): (staging/name).write_bytes(data)
published=publish_generation(layout,staging,attempt=1,step=999)
for generation in ('gen-999998','gen-999999'):
    target=layout.checkpoints/generation; target.mkdir(mode=0o700)
    (target/'unpublished.html').write_bytes(contents['active.html'])
    if generation=='gen-999999': (target/'COMPLETE.json').write_text('{"schema_version":')
print(json.dumps({'generation':published.generation,'completeText':(published.path/'COMPLETE.json').read_text(),'incomplete':['gen-999998','gen-999999']}))`, root, runId], { cwd: repo, timeout: 15000 }));
  record.safetyCases.fixture = prepared;
  record.safetyCases.before = await proof();
  const safetyInventory = await authFetch(`/api/runs/${runId}/artifacts`);
  assert.equal(safetyInventory.status, 200);
  record.safetyCases.inventory = await safetyInventory.json();
  record.safetyCases.refusedPaths = [];
  for (const suffix of ["gen-999998/unpublished.html", "gen-999999/unpublished.html", `${published.generation}/%252e%252e/manifest.json`]) {
    const response = await authFetch(`/api/runs/${runId}/artifacts/${suffix}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert([400, 403, 404].includes(response.status));
    assert(bytes.length <= 1024);
    record.safetyCases.refusedPaths.push({ suffix, status: response.status, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  await actions.button("Refresh artifacts");
  await cmd(["wait", "--text", "active.html"]);
  record.safetyCases.publicRows = await dom(`JSON.stringify(Array.from(document.querySelectorAll('section[aria-labelledby="results-title"] tbody tr')).map(row=>({generation:row.cells[0].textContent.trim(),member:row.cells[1].textContent.trim(),buttons:Array.from(row.querySelectorAll('button')).map(b=>b.textContent.trim())})))`);
  record.safetyCases.attachments = [];
  const active = record.safetyCases.inventory.generations.find(g => g.generation === prepared.generation);
  assert(active);
  for (const member of ["active.html", "active.svg"]) {
    const response = await authFetch(`/api/runs/${runId}/artifacts/${prepared.generation}/${member}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    const scope = `//section[@aria-labelledby='results-title']//tbody/tr[normalize-space(td[2])=${JSON.stringify(member)}]`;
    await actions.button("Download", false, { scope });
    const deadline = Date.now() + 15000;
    let names;
    do {
      names = await readdir(downloads);
      if (names.length === record.safetyCases.attachments.length + 1 && !names.some(n=>n.endsWith('.crdownload'))) break;
      assert(Date.now() < deadline, "Attachment download timeout");
      await new Promise(r => setTimeout(r, 100));
    } while (true);
    const name = names.find(n => !record.safetyCases.attachments.some(a => a.download.name === n));
    const saved = await readFile(join(downloads, name));
    record.safetyCases.attachments.push({member, status:response.status, headers:Object.fromEntries(['content-type','content-disposition','content-security-policy','x-content-type-options'].map(k=>[k,response.headers.get(k)])), size:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'), download:{name,size:saved.length,sha256:createHash('sha256').update(saved).digest('hex')}});
  }
  record.safetyCases.publicDom = await dom(`JSON.stringify({executed:document.documentElement.dataset.wavedlArtifactExecuted==='yes',activeEmbeds:document.querySelectorAll('section[aria-labelledby="results-title"] iframe,section[aria-labelledby="results-title"] object,section[aria-labelledby="results-title"] embed,section[aria-labelledby="results-title"] img').length})`);
  record.safetyCases.after = await proof();
  assert.deepEqual(record.safetyCases.before, record.safetyCases.after);
  check(true, "Fixture incomplete publications are excluded; traversal inventory refused; active HTML/SVG downloaded without embedding or execution");
  record.status = "passed";
} catch (e) {
  record.status = "failed";
  record.error = String(e?.message ?? e);
} finally {
  record.cleanup = { errors: [] };
  try {
    if (opened)
      await boundedCommand(browser, ["--session", session, "close"], { cwd: repo, timeout: 10000 });
    const sessionDeadline = Date.now() + 30000;
    let listed = true;
    while (listed && Date.now() < sessionDeadline) {
      const sessions = await boundedCommand(browser, ["session", "list"], {
        cwd: repo,
        timeout: 10000,
      });
      listed = sessions.split("\n").some((line) => line.trim() === session);
      if (listed) await new Promise((r) => setTimeout(r, 250));
    }
    assert(!listed, "Browser session remains listed");
    record.cleanup.browserSessionAbsent = true;
  } catch {
    record.cleanup.errors.push("Browser shutdown unverified");
  }
  const waitForFixture = async (timeout) => {
    const deadline = Date.now() + timeout;
    while (!fixturePipeClosed && Date.now() < deadline)
      await new Promise((r) => setTimeout(r, 50));
    return fixturePipeClosed;
  };
  const signalFixture = (signal) => {
    if (fixturePipeClosed || fixture.exitCode !== null || fixture.signalCode !== null) return;
    if (process.platform !== "win32" && fixture.pid) process.kill(-fixture.pid, signal);
    else fixture.kill(signal);
  };
  try {
    signalFixture("SIGINT");
  } catch (e) {
    if (e.code !== "ESRCH") record.cleanup.errors.push("Fixture graceful signal failed");
  }
  let fixtureReaped = await waitForFixture(20000);
  if (!fixtureReaped) {
    record.cleanup.errors.push("Fixture graceful shutdown timed out; escalated");
    try {
      signalFixture("SIGKILL");
    } catch (e) {
      if (e.code !== "ESRCH") record.cleanup.errors.push("Fixture forced signal failed");
    }
    fixtureReaped = await waitForFixture(5000);
  }
  if (!fixtureReaped) {
    // Unknown shutdown must preserve owned paths, but not hang report emission.
    fixture.unref();
    fixture.stdout.unref?.();
    fixture.stderr.unref?.();
  }
  record.cleanup.fixtureServicesClosed = stdout.includes("Fixture: services-closed");
  if (fixtureSpawnError) record.cleanup.errors.push("Fixture spawn failed");
  if (stdoutExceeded) record.cleanup.errors.push("Fixture stdout exceeded bound");
  record.cleanup.launcherExited = fixtureReaped &&
    (fixture.exitCode !== null || fixture.signalCode !== null);
  try {
    record.processResults = [...stdout.matchAll(/Fixture process-result: (.+)/g)].map((m) =>
      JSON.parse(m[1]),
    );
  } catch {
    record.processResults = [];
    record.cleanup.errors.push("Fixture process result malformed");
  }
  if (!record.cleanup.fixtureServicesClosed || !record.cleanup.launcherExited)
    record.cleanup.errors.push("Fixture shutdown unverified");
  if (origin) {
    try {
      await fetch(origin + "/api/health", { signal: AbortSignal.timeout(3000) });
      record.cleanup.errors.push("Listener still accepts requests");
    } catch (e) {
      record.cleanup.listenerRefused = e.cause?.code === "ECONNREFUSED";
      if (!record.cleanup.listenerRefused)
        record.cleanup.errors.push("Listener refusal unverified");
    }
  }
  if (record.before) {
    try {
      const handles = record.before.registry.execution_control.map((r) => JSON.parse(r.handle_json));
      record.cleanup.runtimePidsAbsent = handles.every((h) => {
        if (!Number.isSafeInteger(h.pid) || h.pid <= 0) return false;
        try {
          process.kill(h.pid, 0);
          return false;
        } catch (e) {
          return e.code === "ESRCH";
        }
      });
    } catch {
      record.cleanup.runtimePidsAbsent = false;
    }
    if (!record.cleanup.runtimePidsAbsent)
      record.cleanup.errors.push("Runtime PID absence unverified");
  }
  if (!record.cleanup.errors.length) {
    for (const p of [root, profile, tokenFile, downloads, evidencePath, arm]) {
      try {
        await rm(p, { recursive: true, force: true });
        await assert.rejects(access(p), { code: "ENOENT" });
      } catch (e) {
        record.cleanup.errors.push(`Owned path cleanup failed: ${p}`);
      }
    }
    if (!record.cleanup.errors.length) {
      record.cleanup.removedOwnedRoots = true;
      record.cleanup.browserProfileRemoved = true;
      record.cleanup.privateCredentialRemoved = true;
    }
  }
  if (record.cleanup.errors.length) {
    record.status = "failed";
    record.cleanup.retainedOwnedPaths = [];
    for (const p of [root, profile, tokenFile, downloads, evidencePath, arm]) {
      try {
        await access(p);
        record.cleanup.retainedOwnedPaths.push(p);
      } catch (e) {
        if (e.code !== "ENOENT") record.cleanup.errors.push(`Owned path state unknown: ${p}`);
      }
    }
  }
  // Error messages never include bootstrap URLs, private CLI args, or token.
  if (record.error)
    record.error = record.error.replace(/bootstrap=[^\s"&#]+/g, "bootstrap=[REDACTED]");
  let reportText = JSON.stringify(record, null, 2);
  if (credentialSecret) reportText = reportText.replaceAll(credentialSecret, "[REDACTED]");
  reportText = reportText.replace(/bootstrap=[^\s"&#]+/g, "bootstrap=[REDACTED]");
  await writeFile(
    join(reportRoot, "artifact-publication-oversized-inventory.json"),
    reportText,
    { mode: 0o600, flag: "wx" },
  );
  console.log(`artifact publication: ${record.status}; report ${reportRoot}`);
}
if (record.status !== "passed") process.exitCode = 1;
else await verifyArtifactPublicationReport(reportRoot);
