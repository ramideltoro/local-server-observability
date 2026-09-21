import test from "node:test";
import assert from "node:assert/strict";
import {workflowObservation} from "../server/workflow-evidence.mjs";
test("documentation workflow failures, missing evidence, and recovery remain distinct",()=>{
  const now=Date.now(),run={name:"Check documentation alignment",head_branch:"main",event:"schedule",status:"completed",conclusion:"failure"};
  const snapshot={at:now,runs:[run]};
  assert.equal(workflowObservation(snapshot,run.name,now).status,"fail");
  assert.equal(workflowObservation({...snapshot,at:now-1200001},run.name,now).status,"unknown");
  assert.equal(workflowObservation({at:now,error:true,runs:[]},run.name,now).status,"unknown");
  assert.equal(workflowObservation({at:now,runs:[{...run,event:"pull_request"}]},run.name,now).status,"unknown");
  assert.equal(workflowObservation({at:now,runs:[{...run,conclusion:"success"}]},run.name,now).status,"pass");
  assert.equal(workflowObservation({at:now,runs:[{...run,status:"in_progress"}]},run.name,now).status,"unknown");
});
