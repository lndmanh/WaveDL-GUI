// Read-only evidence consistency guard; not independent browser certification.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { constants, readFileSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { currentMappedAssets } from "./verify_mapped_autoplot_browser_report.mjs";

export const scope = "real-browser-hostile-origin";
export const limitation = "Isolated loopback browser acceptance only; not production, remote-host, or cross-browser certification.";
const sha = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const packagedAssetCount = Object.keys(JSON.parse(readFileSync(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url), "utf8"))).length;
function keys(value, required, optional = []) {
  assert(value && typeof value === "object" && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).filter((key) => !optional.includes(key)).sort(), [...required].sort(), "Unexpected or missing evidence members");
}
function hash(value) { assert.match(value, sha); }
function integer(value, min = 0) { assert(Number.isSafeInteger(value) && value >= min); }
function child(parent, value) {
  assert(isAbsolute(parent) && isAbsolute(value));
  const path = relative(parent, value);
  assert(path && path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}
function assets(value) {
  keys(value, ["manifestSha256", "files"]); hash(value.manifestSha256);
  assert.equal(Object.keys(value.files).length, packagedAssetCount);
  for (const [name, file] of Object.entries(value.files)) {
    assert(!name.startsWith("/") && name.split("/").every((part) => part && ![".", ".."].includes(part)));
    keys(file, ["size", "sha256"]); integer(file.size, 1); hash(file.sha256);
  }
}
function receipt(value) {
  keys(value, ["sequence", "case", "method", "path", "status", "origin", "cookiePresent", "authHeaderPresent", "setCookiePresent", "allowOriginPresent", "bodySha256", "bodyBytes", "requestedHeaders"]);
  integer(value.sequence, 1); integer(value.status, 100); assert(value.status <= 599);
  assert(["GET", "POST", "OPTIONS"].includes(value.method));
  assert(typeof value.path === "string" && /^\/api\/runs(?:\/[a-f0-9-]+\/cancel)?$/.test(value.path));
  assert(value.origin === null || typeof value.origin === "string");
  assert.equal(typeof value.cookiePresent, "boolean"); assert.equal(typeof value.authHeaderPresent, "boolean");
  assert.equal(value.setCookiePresent, false); assert.equal(value.allowOriginPresent, false);
  integer(value.bodyBytes); hash(value.bodySha256);
  assert.equal(value.bodyBytes, 0); assert.equal(value.bodySha256, createHash("sha256").update("").digest("hex"));
  assert(Array.isArray(value.requestedHeaders));
  assert.equal(new Set(value.requestedHeaders).size, value.requestedHeaders.length);
  assert(value.requestedHeaders.every((header) => ["authorization", "content-type", "x-wavedl-daemon-id"].includes(header)));
}
function snapshot(value, identity, cancelled) {
  keys(value, ["registry", "trees", "settingsSha256"]);
  hash(value.settingsSha256); keys(value.trees, ["state", "runs"]);
  hash(value.trees.state); hash(value.trees.runs);
  const registry = value.registry;
  keys(registry, ["sha256", "tables", "cancellationRequested", "plans", "executions", "submissionControls"]); hash(registry.sha256);
  assert(registry.tables && Object.keys(registry.tables).length >= 5);
  for (const [name, count] of Object.entries(registry.tables)) {
    assert.match(name, /^[a-z_]+$/); integer(count);
  }
  assert.equal(registry.tables.plans, 1); assert.equal(registry.tables.plan_control, 1);
  assert.equal(registry.tables.execution_control, 0, "No execution was authorized");
  assert.equal(registry.tables.submission_control, cancelled);
  assert.deepEqual(registry.executions, []);
  assert.deepEqual(registry.submissionControls, cancelled ? [{ planId: identity.planId, state: "pending", cancelDelivered: false }] : []);
  assert.deepEqual(registry.cancellationRequested, [cancelled]);
  assert.deepEqual(registry.plans, [{ planId: identity.planId, requestId: identity.requestId,
    runId: identity.runId, submissionRequested: 0, cancellationRequested: cancelled }]);
}
export function verifyHostileOriginReport(report) {
  keys(report, ["status", "scope", "limitation", "driverReadinessMode", "ownership", "origins", "identity", "assetsBefore", "assetsAfter", "browser", "controls", "evidence", "cleanup", "fixtureOutputOverflow", "ownedArtifactsRetained"]);
  assert.equal(report.status, "passed"); assert.equal(report.scope, scope); assert.equal(report.limitation, limitation);
  assert.equal(report.driverReadinessMode, "sync-exposure-poll-and-two-controller-dom-observations");
  assert.equal(report.fixtureOutputOverflow, false); assert.equal(report.ownedArtifactsRetained, false);
  keys(report.ownership, ["workspace", "root", "profile", "session"]);
  const owned = report.ownership;
  assert.match(owned.workspace, /\/wavedl-hostile-origin-[A-Za-z0-9]+$/);
  child(owned.workspace, owned.root); child(owned.workspace, owned.profile);
  assert.equal(owned.root, `${owned.workspace}/root`); assert.equal(owned.profile, `${owned.workspace}/profile`);
  assert.match(owned.session, /^wavedl-hostile-origin-[a-f0-9-]{36}$/);
  keys(report.origins, ["daemon", "attack"]);
  for (const origin of Object.values(report.origins)) {
    const url = new URL(origin); assert.equal(url.origin, origin); assert.equal(url.protocol, "http:");
    assert.equal(url.hostname, "127.0.0.1"); assert(url.port && Number(url.port) > 0);
  }
  assert.notEqual(report.origins.daemon, report.origins.attack);
  keys(report.identity, ["daemonId", "buildId", "runId", "planId", "requestId"]);
  // HostedServices hashes the resolved state root, database identity and
  // principal; authored run/plan/request identities remain UUIDs.
  hash(report.identity.daemonId);
  for (const key of ["runId", "planId", "requestId"]) assert.match(report.identity[key], uuid);
  assert.equal(new Set([report.identity.daemonId, report.identity.runId, report.identity.planId, report.identity.requestId]).size, 4);
  assert.match(report.identity.buildId, /^\d+\.\d+\.\d+(?:[a-zA-Z0-9.+-]*)$/);
  assets(report.assetsBefore); assets(report.assetsAfter); assert.deepEqual(report.assetsAfter, report.assetsBefore);
  keys(report.browser, ["version", "userAgent", "cookieSet", "dom", "cookieOnly"]);
  assert.match(report.browser.version.trim(), /^agent-browser \d+\.\d+\.\d+$/);
  assert.match(report.browser.userAgent, /(?:Headless)?Chrome\/\d+/); assert.equal(report.browser.cookieSet, true);
  keys(report.browser.dom, ["simpleGet", "simplePost", "formPost", "jsonPost"]);
  for (const [key, name] of [["simpleGet", "simple-get"], ["simplePost", "simple-post"], ["formPost", "form-post"], ["jsonPost", "json-post"]]) {
    const observation = report.browser.dom[key], outcome = key === "formPost" ? "submitted" : "rejected";
    keys(observation, ["outcome", "text"]); assert.equal(observation.outcome, outcome);
    assert.equal(observation.text, `${name}:${outcome}`, "Actual DOM result must corroborate request outcome");
  }
  keys(report.browser.cookieOnly, ["outcome", "status", "text"]);
  assert.equal(report.browser.cookieOnly.outcome, "response"); assert.equal(report.browser.cookieOnly.status, 401);
  assert(typeof report.browser.cookieOnly.text === "string" && report.browser.cookieOnly.text.length < 1024);
  assert.deepEqual(parseHostileOriginJSON(Buffer.from(report.browser.cookieOnly.text)), { error: "Unauthorized" });
  keys(report.controls, ["nodeAuthenticatedGet", "nodeAuthenticatedCancel"]);
  assert.deepEqual(report.controls.nodeAuthenticatedGet, { status: 200, transport: "node-fetch-not-browser" });
  assert.deepEqual(report.controls.nodeAuthenticatedCancel, { status: 202, transport: "node-fetch-not-browser" });
  keys(report.evidence, ["receipts", "storageBefore", "storageAfter", "storageAfterPositive"]);
  const evidence = report.evidence;
  snapshot(evidence.storageBefore, report.identity, 0); snapshot(evidence.storageAfter, report.identity, 0);
  snapshot(evidence.storageAfterPositive, report.identity, 1);
  assert.deepEqual(evidence.storageAfter, evidence.storageBefore, "Attack cases changed durable storage");
  assert.equal(evidence.storageAfterPositive.settingsSha256, evidence.storageBefore.settingsSha256);
  assert.deepEqual(evidence.storageAfterPositive.registry.tables, { ...evidence.storageBefore.registry.tables, submission_control: 1 });
  assert.notEqual(evidence.storageAfterPositive.registry.sha256, evidence.storageBefore.registry.sha256);
  assert(Array.isArray(evidence.receipts)); assert.equal(evidence.receipts.length, 7);
  const cancelPath = `/api/runs/${report.identity.runId}/cancel`;
  const expected = [
    ["GET", "/api/runs", 200, null, false, true],
    ["GET", "/api/runs", 403, report.origins.attack, true, false],
    ["POST", cancelPath, 403, report.origins.attack, true, false],
    ["POST", cancelPath, 403, report.origins.attack, true, false],
    ["OPTIONS", cancelPath, 403, report.origins.attack, false, false],
    ["GET", "/api/runs", 401, null, true, false],
    ["POST", cancelPath, 202, null, false, true],
  ];
  evidence.receipts.forEach((row, index) => {
    receipt(row); assert.equal(row.sequence, index + 1);
    assert.equal(row.case, ["node-get", "simple-get", "simple-post", "form-post", "json-post", "cookie-only", "node-cancel"][index]);
    assert.deepEqual([row.method, row.path, row.status, row.origin, row.cookiePresent, row.authHeaderPresent], expected[index]);
    assert.deepEqual([...row.requestedHeaders].sort(), index === 4 ? ["authorization", "content-type"] : []);
  });
  keys(report.cleanup, ["errors", "browserSessionAbsent", "fixtureReaped", "fixtureExit", "servicesClosed", "daemonListenerClosed", "attackListenerClosed", "rootRemoved", "profileRemoved", "tokenRemoved", "workspaceRemoved"]);
  assert.deepEqual(report.cleanup.errors, []);
  keys(report.cleanup.fixtureExit, ["code", "signal"]);
  const exit = report.cleanup.fixtureExit;
  // Uvicorn may re-raise its handled SIGINT after the lifespan drain. Only
  // accept that signal alongside measured service and listener shutdown below.
  assert((exit.code === 0 && exit.signal === null) || (exit.code === null && exit.signal === "SIGINT"));
  for (const [key, value] of Object.entries(report.cleanup)) if (!["errors", "fixtureExit"].includes(key)) assert.equal(value, true);
  return true;
}
export function parseHostileOriginJSON(bytes) {
  const source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  const value = JSON.parse(source);
  const stack = [];
  for (const match of source.matchAll(/"(?:[^"\\]|\\.)*"|[{}[\],:]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)) {
    const token = match[0], parent = stack.at(-1);
    if (token === "{" || token === "[") {
      assert(stack.length < 40, "Evidence nesting exceeds bound");
      stack.push({ keys: token === "{" ? new Set() : null, key: token === "{" });
    } else if (token === "}" || token === "]") stack.pop();
    else if (token === "," && parent?.keys) parent.key = true;
    else if (token === ":" && parent) parent.key = false;
    else if (token.startsWith('"') && parent?.keys && parent.key) {
      const key = JSON.parse(token);
      assert(!parent.keys.has(key), "Duplicate JSON member");
      parent.keys.add(key);
    }
  }
  return value;
}
async function boundedFile(path) {
  const limit = 1024 * 1024, before = await lstat(path);
  assert(before.isFile() && !before.isSymbolicLink() && before.size > 0 && before.size <= limit);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat();
    assert(opened.isFile() && opened.dev === before.dev && opened.ino === before.ino);
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < bytes.length) {
      const result = await handle.read(bytes, length, bytes.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await handle.stat();
    assert(length === before.size && length <= limit && after.size === before.size);
    assert(after.mtimeMs === opened.mtimeMs && after.ctimeMs === opened.ctimeMs);
    return bytes.subarray(0, length);
  } finally { await handle.close(); }
}

export async function verifyHostileOriginFile(path) {
  const report = parseHostileOriginJSON(await boundedFile(path));
  verifyHostileOriginReport(report);
  assert.deepEqual(report.assetsBefore, await currentMappedAssets(), "Not current packaged assets");
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert(process.argv[2], "Provide the dedicated JSON report path");
  await verifyHostileOriginFile(process.argv[2]);
  process.stdout.write("Hostile-origin browser report verified\n");
}
