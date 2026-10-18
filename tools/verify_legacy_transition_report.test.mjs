import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { verifyLegacyTransitionRecord } from "./verify_legacy_transition_report.mjs";

const hash="a".repeat(64), origin="http://127.0.0.1:12345";
const file={path:"index.html",sha256:hash,size:7,symlink:false};
function valid() {
  const sha=text=>createHash("sha256").update(text).digest("hex");
  const manifestText=JSON.stringify({"index.html":hash}), workerText="workbox:core precache-v2",yamlText="epochs: 11\n";
  const manifest={sha256:sha(manifestText),size:Buffer.byteLength(manifestText),text:manifestText};
  const worker={sha256:sha(workerText),size:Buffer.byteLength(workerText),sourceText:workerText};
  const inventory={schema_version:1,build_key:hash,generation:hash,assets:[{url:"/",sha256:hash,size:7,immutable:false}]};
  const old={controller:origin+"/sw.js",cacheNames:["workbox-precache-v2-"+origin],caches:[{name:"workbox-precache-v2-"+origin,files:[{url:"/index.html",sha256:hash,size:7}]}],registrations:[{active:"activated"}]};
  return {name:"legacy-worker-transition",status:"passed",scope:"legacy-transition-only",initiallyEmptyProfile:true,
    legacy:{assetManifest:manifest,serviceWorker:{...worker,workbox:{precache:true,entries:[{url:"index.html",revision:hash}]}},manifestFiles:[file]},
    current:{assetManifest:manifest,serviceWorker:worker,manifestFiles:[file]},
    initial:{origin,connect:{public:true,oneTimeBootstrap:true},storage:old},
    authoring:{yaml:{epochs:11},yamlText,sha256:sha(yamlText),size:Buffer.byteLength(yamlText),savedExternalBeforeClose:true},close:{sessionAbsent:true,profilePreserved:true,allOwnedDocumentsClosed:true},
    swap:{afterOwnedSessionClosed:true,currentOnly:true},reopen:{sameProfile:true,origin,currentBuild:inventory,
      storage:{controller:origin+"/sw.js",cacheNames:["current"],registrations:[{active:"activated",waiting:null}],records:[{status:"ready",inventory,cacheName:"current"}],caches:[{name:"current",files:inventory.assets}]},
      entryUrls:["/current.js"],page:{entries:["/current.js"],bootstrapAbsent:true},legacyCacheDeleted:old.cacheNames,legacyCacheRemaining:[],draftRestorationRequired:false},
    cleanup:{errors:[],servicesClosed:true,privateCredentialRemoved:true,profileRemoved:true,browserSessionAbsent:true,fixtureExited:true,listenerClosed:true,ownedRemoved:true}};
}

test("coherent explicit transition record passes",()=>verifyLegacyTransitionRecord(valid(),"/tmp/report"));
for(const [label,mutate] of [
  ["preflight is not acceptance",r=>r.status="preflight"],
  ["invented legacy worker",r=>r.legacy.serviceWorker.workbox.precache=false],
  ["legacy wrong bytes",r=>r.initial.storage.caches[0].files[0].sha256="b".repeat(64)],
  ["non-authored YAML",r=>r.authoring.yaml.epochs=10000],
  ["credential YAML",r=>r.authoring.yaml.token="secret"],
  ["no close barrier",r=>r.close.sessionAbsent=false],
  ["old documents preserved",r=>r.close.allOwnedDocumentsClosed=false],
  ["not activated",r=>r.reopen.storage.registrations[0].active="installed"],
  ["waiting without consent",r=>r.reopen.storage.registrations[0].waiting="installed"],
  ["wrong retained bytes",r=>r.reopen.storage.caches[0].files=[]],
  ["old entry",r=>r.reopen.page.entries=["/legacy.js"]],
  ["dishonest cache deletion",r=>r.reopen.legacyCacheDeleted=[]],
  ["live fixture listener",r=>r.cleanup.listenerClosed=false],
  ["private profile remains",r=>r.cleanup.profileRemoved=false],
]) test(label,()=>{const record=valid();mutate(record);assert.throws(()=>verifyLegacyTransitionRecord(record,"/tmp/report"));});
