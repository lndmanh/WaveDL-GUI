import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { inventoryAssets, readBoundedFile } from "./run_legacy_browser_acceptance.mjs";

const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
async function fixture(run) {
  const root=await mkdtemp(join(tmpdir(),"wavedl-legacy-provenance-test-"));
  try { await writeFile(join(root,"index.html"),"hello");await writeFile(join(root,".wavedl-assets.json"),JSON.stringify({"index.html":hash("hello")}));await run(root); }
  finally {await rm(root,{recursive:true,force:true});}
}
test("manifest validates every file's digest and actual byte size",()=>fixture(async root=>{
  const result=await inventoryAssets(root);assert.equal(result.manifestFiles[0].size,5);assert.equal(result.manifestFiles[0].symlink,false);
}));
test("rejects tampered manifest file",()=>fixture(async root=>{await writeFile(join(root,"index.html"),"tamper");await assert.rejects(inventoryAssets(root));}));
test("rejects unlisted asset",()=>fixture(async root=>{await writeFile(join(root,"unlisted.js"),"a");await assert.rejects(inventoryAssets(root));}));
test("bounded reader rejects excess before allocation",()=>fixture(root=>assert.rejects(readBoundedFile(join(root,"index.html"),4))));
test("manifest traversal rejected",()=>fixture(async root=>{await writeFile(join(root,".wavedl-assets.json"),JSON.stringify({"../escape":hash("hello")}));await assert.rejects(inventoryAssets(root));}));
test("manifest ancestor symlink rejected",()=>fixture(async root=>{
  await mkdir(join(root,"real"));await writeFile(join(root,"real","x.js"),"hello");await symlink(join(root,"real"),join(root,"linked"));
  await writeFile(join(root,".wavedl-assets.json"),JSON.stringify({"linked/x.js":hash("hello")}));await assert.rejects(inventoryAssets(root));
}));
test("manifest itself cannot be symlink",()=>fixture(async root=>{await writeFile(join(root,"actual.json"),"{}");await rm(join(root,".wavedl-assets.json"));await symlink(join(root,"actual.json"),join(root,".wavedl-assets.json"));await assert.rejects(inventoryAssets(root));}));
