import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { verifyStorageFaultBrowserReport, limitation } from "./verify_storage_fault_browser_report.mjs";

const packagedAssetCount = Object.keys(JSON.parse(await readFile(new URL("../src/wavedl_daemon/web_assets/.wavedl-assets.json", import.meta.url), "utf8"))).length;

function sample(mode) {
  const id="00000000-0000-4000-8000-000000000001", plan="00000000-0000-4000-8000-000000000002";
  const payloads=[{device:"cpu",capabilities:["train"]},{stream:"stdout",level:"info",message:"quota-growth:"+"x".repeat(60000)},{status:"completed",code:0}];
  const events=["hello","log","exit"].map((type,seq)=>({run_id:id,attempt:1,seq,type,payload:payloads[seq],version:1,protocol:"wavedl-jsonl"}));
  const raw=events.map(e=>JSON.stringify(e)+"\n"), hello=Buffer.byteLength(raw[0]);
  const sqliteErrors=[{code:mode==="query_only"?8:13,name:mode==="query_only"?"SQLITE_READONLY":"SQLITE_FULL"}];
  const snapshots=[0,1,2,3].map(phase=>{
    const bytes=Buffer.from(phase?raw.join(""):raw[0]), recovered=phase>=2;
    const c={runId:id,planId:plan,journalHex:bytes.toString("hex"),journalSha256:createHash("sha256").update(bytes).digest("hex"),
      cursors:[[1,recovered?2:0]],events:recovered?events:[events[0]],registry:{state:recovered?"completed":"running",eventCount:recovered?3:1},
      bookmark:{last_seq:recovered?2:0,offset:recovered?bytes.length:hello,private_owner:false,historical_hello:false},
      view:{run_id:id,plan_id:plan,state:recovered?"completed":"terminal_unknown",uncertainty:!recovered,evidence:{confidence:recovered?"confirmed":"unconfirmed",runtime:{exit_seq:recovered?2:-1}}},
      sqliteErrors:phase?sqliteErrors:[],pageCount:recovered?30:20,maxPages:phase===1&&mode==="page_quota"?20:999,queryOnly:Number(phase===1&&mode==="query_only")};
    return {cases:{[mode]:c},phase,fixtureId:id,laps:phase*5+3,phaseStartLaps:phase*5,scope:"real-sqlite-storage-refusal",limitation,health:{monitoring_errors:phase===1?[{source:plan,error:"OperationalError"}]:[],dispatch_errors:[],restart_monitoring_errors:[]}};
  });
  const assets={manifestSha256:"a".repeat(64),assets:Object.fromEntries(Array.from({length:packagedAssetCount},(_,i)=>[String(i),"b".repeat(64)]))};
  return {status:"passed",scope:"real-sqlite-storage-refusal",limitation,snapshots,driverReadinessMode:"sync-exposure-poll-and-two-controller-dom-observations",browser:{version:"agent-browser 0.26.0",userAgent:"HeadlessChrome/150"},assetPreflight:assets,assetPostflight:structuredClone(assets),browserObservations:snapshots.flatMap(({phase})=>[0,1].map(repeat=>({phase,repeat,fault:mode,runId:id,badge:phase<2?"terminal unknown · uncertain":"completed",uncertain:phase<2,emptyMetrics:true}))),cleanup:{errors:[],browserSessionAbsent:true,fixtureReaped:true,servicesClosed:true,controlDrained:true,listenerClosed:true,rootRemoved:true,profileRemoved:true,tokenRemoved:true,workspaceRemoved:true,fixtureExit:{code:null,signal:"SIGINT"}}};
}
for(const mode of ["query_only","page_quota"]){
  test(`accept coherent ${mode} evidence`,()=>assert.equal(verifyStorageFaultBrowserReport(sample(mode)),true));
  test(`reject ${mode} as the opposite expected mode`, ()=>{
    const opposite = mode === "query_only" ? "page_quota" : "query_only";
    assert.throws(() => verifyStorageFaultBrowserReport(sample(mode), opposite));
  });
  for(const [name,mutate] of [
    ["early success",r=>r.browserObservations[2].badge="completed"],
    ["missing DOM",r=>r.browserObservations.pop()],
    ["wrong native code",r=>Object.values(r.snapshots[1].cases)[0].sqliteErrors=[{code:5,name:"SQLITE_BUSY"}]],
    ["cursor advanced on refusal",r=>Object.values(r.snapshots[1].cases)[0].cursors=[[1,2]]],
    ["bookmark advanced on refusal",r=>Object.values(r.snapshots[1].cases)[0].bookmark.offset++],
    ["duplicate replay",r=>Object.values(r.snapshots[3].cases)[0].events.push({seq:3})],
    ["failed cleanup",r=>r.cleanup.controlDrained=false],
    ["skip evidence",r=>r.skipped=true],
    ["modified assets",r=>r.assetPostflight.manifestSha256="c".repeat(64)],
    ["truncated journal",r=>Object.values(r.snapshots[2].cases)[0].journalHex="00"],
  ]) test(`reject ${mode}: ${name}`,()=>{const r=sample(mode);mutate(r);assert.throws(()=>verifyStorageFaultBrowserReport(r));});
}
