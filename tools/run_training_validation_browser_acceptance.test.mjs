import test from "node:test";
import assert from "node:assert/strict";
import { main } from "./run_training_validation_browser_acceptance.mjs";
import { cvResumeRefusal } from "./browser_training_validation.mjs";
test("requires an explicit report directory", async () => {
  await assert.rejects(() => main(), /Usage/);
});

function resumeDriver(fault) {
  const actions = [];
  let value = "", cv = "0", previewed = false;
  const empty = {plans:0,runs:[],control:[],executions:[]};
  const driver = {
    root:"/owned/fixture", actions,
    fill:async (name, next) => {
      actions.push(["fill", name, next]);
      if (name === "cv") cv = next;
      if (name === "resume") value = next;
    },
    button:async name => {
      actions.push(["button", name]);
      assert.equal(cv, "2");
      assert.equal(value, "/owned/fixture/private-resume-checkpoint.pth");
      previewed = true;
    },
    cli:async (...args) => actions.push(args),
    registry:async () => ({...structuredClone(empty),
      plans:previewed && fault === "mutation" ? 1 : 0}),
    dom:async () => fault === "disclosure",
  };
  const receipts = async () => previewed && fault === "request" ? [{}] : [];
  const observation = async name => {
    assert.equal(name, "resume");
    return {id:"resume-field",value,invalid:value ? "true" : "false",
      error:value ? (fault === "error" ? "Wrong error" : "Cross-validation does not support nondefault --resume.") : ""};
  };
  return {driver,receipts,observation};
}
test("CV resume driver uses native public field actions then clears for recovery", async () => {
  const {driver,receipts,observation} = resumeDriver();
  const report = await cvResumeRefusal(driver,receipts,observation);
  assert.deepEqual(driver.actions.filter(([kind])=>["fill","button"].includes(kind)), [
    ["fill","cv","2"], ["fill","resume","/owned/fixture/private-resume-checkpoint.pth"],
    ["button","Preview persisted plan"], ["fill","resume",""]]);
  assert.equal(report.corrected.invalid,"false");
  assert.equal(report.afterReceiptCount,0);
});
for (const fault of ["mutation","request","disclosure","error"])
  test("CV resume driver refuses " + fault, async () => {
    const {driver,receipts,observation} = resumeDriver(fault);
    await assert.rejects(()=>cvResumeRefusal(driver,receipts,observation));
  });
