#!/usr/bin/env node
// Fail-closed verifier for the legacy worker close/reopen acceptance.
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function readJson(path) {
  const stat = await lstat(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0 && stat.size <= 2 * 1024 * 1024);
  const fd = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try { return JSON.parse((await fd.readFile("utf8"))); } finally { await fd.close(); }
}

export function verifyLegacyTransitionRecord(record, directory) {
  assert(record && typeof record === "object" && !Array.isArray(record));
  assert.equal(record.name, "legacy-worker-transition");
  assert.equal(record.status, "passed");
  assert.equal(record.scope, "legacy-transition-only");
  assert.equal(record.initiallyEmptyProfile,true);
  assert(record.legacy?.assetManifest && record.legacy?.serviceWorker);
  assert(record.current?.assetManifest && record.current?.serviceWorker);
  for (const build of [record.legacy, record.current]) {
    assert.equal(digest(build.assetManifest.text),build.assetManifest.sha256);
    assert.equal(Buffer.byteLength(build.assetManifest.text),build.assetManifest.size);
    assert.equal(digest(build.serviceWorker.sourceText),build.serviceWorker.sha256);
    assert.equal(Buffer.byteLength(build.serviceWorker.sourceText),build.serviceWorker.size);
    assert(/^[a-f0-9]{64}$/.test(build.assetManifest.sha256));
    assert(Number.isInteger(build.assetManifest.size) && build.assetManifest.size > 0);
    assert(/^[a-f0-9]{64}$/.test(build.serviceWorker.sha256));
    assert(Number.isInteger(build.serviceWorker.size) && build.serviceWorker.size > 0);
    assert(Array.isArray(build.manifestFiles) && build.manifestFiles.length > 0);
    for (const file of build.manifestFiles) {
      assert(file.path && !file.path.startsWith("/") && !file.path.includes("\\"));
      assert(Number.isInteger(file.size) && file.size >= 0 && file.size <= 128 * 1024 * 1024);
      assert(/^[a-f0-9]{64}$/.test(file.sha256));
      assert.equal(file.symlink, false);
      assert.equal(JSON.parse(build.assetManifest.text)[file.path],file.sha256);
    }
    assert.deepEqual(build.manifestFiles.map(f=>f.path).sort(),Object.keys(JSON.parse(build.assetManifest.text)).sort());
  }
  assert(record.initial?.connect?.public === true && record.initial.connect.oneTimeBootstrap === true);
  const old=record.initial?.storage;
  assert(old?.controller && old.cacheNames?.length > 0);
  assert(record.legacy.serviceWorker.workbox.precache);
  assert(record.legacy.serviceWorker.sourceText.includes("workbox:core") && record.legacy.serviceWorker.sourceText.includes("precache-v2"));
  assert(old.registrations.some(r=>r.active==="activated"));
  const precache=old.caches.find(c=>c.name.startsWith("workbox-precache-v2-"));
  assert(precache && record.legacy.serviceWorker.workbox.entries.length>0);
  const origin=record.initial.origin;
  assert.deepEqual(precache.files.map(f=>new URL(f.url,origin).pathname).sort(),record.legacy.serviceWorker.workbox.entries.map(e=>new URL(e.url,origin).pathname).sort());
  for(const file of precache.files){
    const pathname=new URL(file.url,origin).pathname;
    const path=pathname==="/"?"index.html":pathname.slice(1);
    const source=record.legacy.manifestFiles.find(f=>f.path===path);
    assert(source && source.sha256===file.sha256 && source.size===file.size);
  }
  assert(record.authoring?.yaml?.epochs === 11 && record.authoring.savedExternalBeforeClose);
  assert(/^[a-f0-9]{64}$/.test(record.authoring.sha256));
  assert(record.authoring.size>0 && record.authoring.size<=1024*1024);
  assert.equal(digest(record.authoring.yamlText),record.authoring.sha256);
  assert.equal(Buffer.byteLength(record.authoring.yamlText),record.authoring.size);
  assert(!/Bearer|access_token|Authorization/.test(record.authoring.yamlText));
  for(const field of ["runtime","environment","token","access_token","output_dir"])assert(!Object.hasOwn(record.authoring.yaml,field));
  assert(record.close?.sessionAbsent === true && record.close?.profilePreserved === true);
  assert(record.close.allOwnedDocumentsClosed);
  assert(record.swap?.afterOwnedSessionClosed === true && record.swap?.currentOnly === true);
  assert(record.reopen?.sameProfile === true && record.reopen?.origin === record.initial.origin);
  const next=record.reopen.storage, current=record.reopen.currentBuild;
  assert(next?.controller && next.registrations.some(r=>r.active==="activated"&&!r.waiting));
  assert(current?.schema_version===1 && /^[a-f0-9]{64}$/.test(current.build_key));
  const ready=next.records.find(r=>r.status==="ready" && r.inventory?.build_key===current.build_key);
  assert(ready);
  assert.deepEqual(ready.inventory,current);
  const cache=next.caches.find(c=>c.name===ready.cacheName);
  assert(cache);
  const normal=files=>files.map(f=>({url:f.url,sha256:f.sha256,size:f.size})).sort((a,b)=>a.url.localeCompare(b.url));
  assert.deepEqual(normal(cache.files),normal(current.assets));
  assert(record.reopen.entryUrls.length>0 && record.reopen.entryUrls.every(url=>record.reopen.page.entries.includes(url)));
  assert(record.reopen.page.bootstrapAbsent);
  assert.deepEqual(record.reopen.legacyCacheDeleted,old.cacheNames.filter(n=>!next.cacheNames.includes(n)));
  assert.deepEqual(record.reopen.legacyCacheRemaining,old.cacheNames.filter(n=>next.cacheNames.includes(n)));
  assert.equal(record.reopen.draftRestorationRequired,false);
  assert.equal(record.cleanup.errors.length,0);
  for(const field of ["browserSessionAbsent","fixtureExited","listenerClosed","ownedRemoved"])assert(record.cleanup[field]);
  assert(record.cleanup?.servicesClosed === true && record.cleanup?.privateCredentialRemoved === true);
  assert(record.cleanup?.profileRemoved === true || record.cleanup?.profilePreserved === true);
  return record;
}

export async function verifyLegacyTransitionReport(directory) {
  const root = resolve(directory);
  const entries = await readdir(root);
  assert.deepEqual(entries.sort(), ["legacy-worker-transition.json"]);
  const record = verifyLegacyTransitionRecord(await readJson(join(root, entries[0])), root);
  const base=fileURLToPath(new URL("../src/wavedl_daemon/web_assets/",import.meta.url));
  assert.equal(digest(await readFile(join(base,".wavedl-assets.json"))),record.current.assetManifest.sha256,"not current packaged assets");
  assert.equal(digest(await readFile(join(base,"sw.js"))),record.current.serviceWorker.sha256);
  assert.deepEqual(JSON.parse(await readFile(join(base,"offline-build.json"),"utf8")),record.reopen.currentBuild);
  const html=await readFile(join(base,"index.html"),"utf8");
  const expectedEntries=[...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(m=>new URL(m[1],record.initial.origin).pathname);
  assert.deepEqual(record.reopen.entryUrls,expectedEntries);
  return record;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2];
  if (!dir) throw new Error("Usage: verify_legacy_transition_report.mjs REPORT_DIR");
  await verifyLegacyTransitionReport(dir);
  console.log("legacy worker transition report: valid");
}
