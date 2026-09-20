import test from 'node:test';
import assert from 'node:assert/strict';
import {fantasyWorkloadEvidence} from '../server/workload-evidence.mjs';
const now=Date.parse('2026-09-20T16:00:00Z');
const sample=()=>({observedAt:new Date(now).toISOString(),workloads:{fantasyQwen:{pid:'1501',latest:now/1000-1,count:5,maxSeconds:40,met:1}}});
test('fresh production aggregates pass; failed completions remain failed',()=>{const d=sample();assert.equal(fantasyWorkloadEvidence(d,1501,now).met,1);d.workloads.fantasyQwen.met=0;assert.equal(fantasyWorkloadEvidence(d,1501,now).met,0);});
test('stale collectors, stale activity, changed processes and malformed aggregates cannot pass',()=>{
 assert.equal(fantasyWorkloadEvidence(sample(),1502,now),null);
 for(const [key,value] of [['latest',now/1000-901],['latest',now/1000+1],['count',0],['maxSeconds',NaN],['maxSeconds',220],['met',2]]) {const d=sample();d.workloads.fantasyQwen[key]=value;assert.equal(fantasyWorkloadEvidence(d,1501,now),null);}
 for(const time of [now-21*60000,now+1]){const d=sample();d.observedAt=new Date(time).toISOString();assert.equal(fantasyWorkloadEvidence(d,1501,now),null);}
 assert.equal(fantasyWorkloadEvidence({},1501,now),null);
});
