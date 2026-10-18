import assert from "node:assert/strict";
import { openTrainingEditor } from "./browser_training_editor.mjs";

export const activeDraftLimitation =
  "Four genuine isolated builds from the current source use namespaced fixture assets, not the frozen package generation. Local CPU attempt-one supervision and unsent public editor fields are checked around one shared worker takeover only; no remote, scheduler, GPU, Windows or crash durability claim.";

export async function frozenAssetProof(command, python) {
  return JSON.parse(
    await command(python, [
      "-c",
      "import json,hashlib\nfrom pathlib import Path\nfrom tools.vendor_web_assets import inventory\np=Path('src/wavedl_daemon/web_assets'); raw=(p/'.wavedl-assets.json').read_bytes(); assets=inventory(p,managed=True)\nif assets!=json.loads(raw): raise ValueError('Frozen asset inventory mismatch')\nprint(json.dumps({'manifestSha256':hashlib.sha256(raw).hexdigest(),'assets':assets}))",
    ]),
  );
}

export function createActiveDraftProof({
  cli,
  dom,
  actions,
  command,
  python,
  root,
  report,
  fixtureOutput,
  page,
  switchTab,
  tab,
  poll,
}) {
  const runId = fixtureOutput().match(/Run: ([0-9a-f-]{36})/)?.[1];
  assert(runId, "Owned seeded run identity required");
  report.activeDraft = { runId, limitation: activeDraftLimitation, tabId: tab.id };
  const proof = report.activeDraft;
  const authority = async () =>
    JSON.parse(
      await command(python, [
        "-c",
        `import json,os,sqlite3,sys
from pathlib import Path
root=Path(sys.argv[1]); run=sys.argv[2]
c=sqlite3.connect((root/'state'/'registry.db').resolve().as_uri()+'?mode=ro',uri=True); c.row_factory=sqlite3.Row
rows=list(c.execute('SELECT * FROM execution_control')); plans=list(c.execute('SELECT * FROM plans')); control=list(c.execute('SELECT * FROM plan_control'))
if len(rows)!=1 or len(plans)!=1 or len(control)!=1: raise ValueError('Only one owned seeded plan is allowed')
row=rows[0]; handle=json.loads(row['handle_json']); pid=handle.get('pid'); alive=False
if isinstance(pid,int) and pid>0:
 try: os.kill(pid,0); alive=True
 except ProcessLookupError: pass
hello=c.execute("SELECT event_json FROM event_log WHERE run_id=? AND event_type='hello' ORDER BY attempt,seq LIMIT 1",(run,)).fetchone()
state=c.execute('SELECT state FROM runs WHERE run_id=?',(run,)).fetchone()
observation=json.loads(row['latest_observation_json'] or row['observation_json'] or '{}')
manifest=json.loads(json.loads(plans[0]['plan_json'])['manifest_json'])
print(json.dumps({'runId':run,'planId':plans[0]['plan_id'],'requestId':handle['request_id'],'operation':manifest['operation'],'state':state['state'] if state else None,'backendStatus':observation.get('status'),'pid':pid,'alive':alive,'hello':json.loads(hello['event_json']) if hello else None,'plans':len(plans),'executions':len(rows),'submissionRequested':control[0]['submission_requested'],'cancellationRequested':control[0]['cancellation_requested'],'cancelDelivered':row['cancel_delivered']}))`,
        root,
        runId,
      ]),
    );
  const draft = () =>
    dom(
      `JSON.stringify((()=>{const labels=Array.from(document.querySelectorAll('section[aria-labelledby="project-title"] label'));const field=n=>{const l=labels.find(e=>e.textContent.trim()===n);return l?document.getElementById(l.htmlFor)?.value:null};return {epochs:field('epochs'),python:field('Python interpreter'),preview:!!document.querySelector('[aria-label="Approved normalized manifest"]'),acknowledged:!!document.querySelector('[aria-label="Acknowledged training run"]')}})())`,
    );
  const selected = () =>
    dom(
      `JSON.stringify((()=>{const s=document.querySelector('[aria-label="Selected run"]');return {runId:s?.querySelector('.identity')?.textContent.trim(),badge:s?.querySelector('[data-slot="badge"]')?.textContent.trim(),progress:!!s?.querySelector('progress'),diagnostics:s?.querySelector('[aria-label="Runtime diagnostics"]')?.textContent||''}})())`,
    );
  const running = async () =>
    poll(
      authority,
      (value) =>
        value.state === "running" &&
        value.backendStatus === "running" &&
        value.alive &&
        value.hello?.run_id === runId,
      "Fresh owned runtime running evidence",
      45000,
    );
  return {
    async prepare() {
      await cli("wait", "--text", runId);
      await cli(
        "click",
        await actions.readyControl("button", runId, false, {
          locator: `xpath=//section[@aria-label='Runs']//button[.//small[normalize-space()='${runId}']]`,
        }),
      );
      await poll(
        selected,
        (value) => value.runId === runId && value.badge === "running" && value.progress,
        "Public active run metrics",
        45000,
      );
      await actions.button("New training run", false, { scope: '//nav[@aria-label="Sections"]' });
      await openTrainingEditor({ button: (...args) => actions.button(...args), cli, dom });
      await actions.fill("epochs", "77");
      proof.draftBefore = await draft();
      assert.equal(proof.draftBefore.epochs, "77");
      assert.equal(proof.draftBefore.preview, false);
      proof.authorityBefore = await running();
      await actions.button("Experiments", false, { scope: '//nav[@aria-label="Sections"]' });
      proof.pageBefore = await page();
      proof.selectedBefore = await selected();
    },
    async defer() {
      await switchTab(tab);
      proof.waitingBeforeDefer = await dom(
        `(async()=>JSON.stringify((await navigator.serviceWorker.getRegistrations()).map(r=>({scope:r.scope,active:r.active?.state,waiting:r.waiting?.state}))))()`,
      );
      assert(proof.waitingBeforeDefer.some((registration) => registration.waiting === "installed"));
      await actions.button("Later");
      proof.deferred = await dom(
        `JSON.stringify({updatePromptVisible:document.body.innerText.includes('A workstation update is available'),timeOrigin:performance.timeOrigin})`,
      );
      assert.equal(proof.deferred.updatePromptVisible, false);
      proof.authorityAtDefer = await running();
    },
    async afterApproval(approved) {
      proof.approvedPage = approved;
      await switchTab(tab);
      proof.pageAfter = await page();
      assert.equal(proof.pageAfter.timeOrigin, proof.pageBefore.timeOrigin);
      assert.deepEqual(proof.pageAfter.entries, proof.pageBefore.entries);
      proof.selectedAfter = await selected();
      assert.equal(proof.selectedAfter.runId, runId);
      assert.equal(proof.selectedAfter.badge, "running");
      proof.authorityAfter = await running();
      await actions.button("New training run", false, { scope: '//nav[@aria-label="Sections"]' });
      proof.draftAfter = await draft();
      assert.deepEqual(proof.draftAfter, proof.draftBefore);
      await actions.button("Experiments", false, { scope: '//nav[@aria-label="Sections"]' });
    },
  };
}
