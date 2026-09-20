import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryObservation,MAX_AGE} from '../server/recovery-evidence.mjs';
const now=Date.now();
function fixture(){return {version:1,systems:{app:{revision:'deployed',observedAt:new Date(now).toISOString(),restore:{outcome:'pass',testedRevision:'deployed',verifiedAt:new Date(now).toISOString(),expiresAt:new Date(now+MAX_AGE).toISOString(),backupReference:'a'.repeat(64),tests:{'archive-integrity':true,'isolated-network':true,'restored-data':true,'application-behavior':true}}}}};}
test('only a complete current isolated restore passes',()=>{assert.equal(recoveryObservation(fixture(),'app','restore',now).status,'pass');assert.equal(recoveryObservation(fixture(),'app','readiness',now).status,'unknown');});
test('expired, missing, corrupt, future and changed revision evidence never passes',()=>{for(const change of [d=>delete d.systems.app.restore,d=>d.systems.app.revision='new',d=>d.systems.app.restore.backupReference='',d=>d.systems.app.restore.tests['restored-data']=false,d=>d.systems.app.restore.expiresAt=new Date(now-1).toISOString(),d=>d.systems.app.restore.verifiedAt=new Date(now+120000).toISOString(),d=>d.systems.app.observedAt=new Date(now-21*60000).toISOString()]){const d=fixture();change(d);assert.equal(recoveryObservation(d,'app','restore',now).status,'unknown');}});
test('a failed restore remains a failure',()=>{const d=fixture();d.systems.app.restore.outcome='fail';assert.equal(recoveryObservation(d,'app','restore',now).status,'fail');});
test('missing or stale log streams do not grant coverage',async()=>{const {applicationLogObservation}=await import('../server/recovery-evidence.mjs');assert.equal(applicationLogObservation(undefined,now).status,'unknown');assert.equal(applicationLogObservation(new Date(now-3600001).toISOString(),now).status,'unknown');assert.equal(applicationLogObservation(new Date(now).toISOString(),now).status,'pass');});
test('a missing or corrupt backup is a failed attempted recovery',()=>{const d=fixture();d.systems.app.restore.outcome='fail';d.systems.app.restore.backupReference='';assert.equal(recoveryObservation(d,'app','restore',now).status,'fail');});

test('worker recovery describes replay scope without implying production cutover',()=>{const d=fixture();d.systems['nutsnews-fetcher']=d.systems.app;const r=recoveryObservation(d,'nutsnews-fetcher','restore',now);assert.equal(r.status,'pass');assert.match(r.scope,/duplicate replay/);assert.match(r.note,/outside this drill/);});

test('cloud log coverage requires a fresh collector and fresh application activity',async()=>{const {cloudLogObservation}=await import('../server/recovery-evidence.mjs');const d={version:1,observedAt:new Date(now).toISOString(),systems:{nutsnews:{at:new Date(now-1000).toISOString()}}};assert.equal(cloudLogObservation(d,'nutsnews',now).status,'pass');for(const bad of [undefined,{...d,systems:{}},{...d,observedAt:new Date(now-1200000).toISOString()},{...d,observedAt:new Date(now+1000).toISOString()},{...d,systems:{nutsnews:{at:new Date(now-3600000).toISOString()}}}])assert.equal(cloudLogObservation(bad,'nutsnews',now).status,'unknown');});

test('known local deployment changes invalidate a restore immediately before polling catches up',()=>{assert.equal(recoveryObservation(fixture(),'app','restore',now,'new-release').status,'unknown');assert.equal(recoveryObservation(fixture(),'app','restore',now,'deployed').status,'pass');});
test('Pi backup readiness expires at 27 hours and never substitutes for a restore',()=>{
 const d=fixture(), entry=d.systems.app;
 entry.readiness={...entry.restore,expiresAt:new Date(now+97200000).toISOString(),tests:{'archive-integrity':true,'required-components':true}};
 delete entry.restore;d.systems.raspberry=entry;
 assert.equal(recoveryObservation(d,'raspberry','readiness',now).status,'pass');
 assert.equal(recoveryObservation(d,'raspberry','restore',now).status,'unknown');
 entry.observedAt=new Date(now+97200000).toISOString();
 assert.equal(recoveryObservation(d,'raspberry','readiness',now+97200000).status,'unknown');
});
test('cloud worker recovery names its tested scope without claiming production freshness',()=>{
 const d=fixture();d.systems['nutsnews-cloud-workers']=d.systems.app;const result=recoveryObservation(d,'nutsnews-cloud-workers','restore',now);
 assert.equal(result.status,'pass');assert.match(result.note,/production ingestion freshness remains separate/);
 d.systems.app.revision='changed';assert.equal(recoveryObservation(d,'nutsnews-cloud-workers','restore',now).status,'unknown');
});
