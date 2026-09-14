import test from 'node:test';
import assert from 'node:assert/strict';
import { latestMetric, resourceHealth, endpointHealth } from '../src/health.ts';
const now = 1800000000000;
const signal = (value, age = 0) => ({state:'live',series:[{values:[[now/1000-age,String(value)]]}]});
test('resource health never treats stale, missing, invalid or partial telemetry as passing', () => {
  assert.equal(resourceHealth([signal(10),signal(20),signal(30)],now),'good');
  for (const absent of [undefined,signal(10,301),signal('NaN'),{state:'unavailable',series:[]},signal('')]) {
    assert.equal(resourceHealth([signal(10),absent,signal(30)],now),'unknown');
  }
  assert.equal(resourceHealth([signal(90),undefined,signal(30)],now),'bad');
  assert.equal(resourceHealth([signal(10),signal(20),signal(85)],now),'bad');
  assert.equal(resourceHealth([signal(10)],now),'unknown');
  assert.equal(latestMetric({state:'live',series:[...signal(10).series,...signal(95).series]},now),95);
});
test('failed endpoint probes remain red and stale probes become unverified', () => {
  assert.equal(endpointHealth('healthy',true),'good');
  assert.equal(endpointHealth('degraded',true),'bad');
  assert.equal(endpointHealth('unavailable',true),'bad');
  assert.equal(endpointHealth('healthy',false),'unknown');
  assert.equal(endpointHealth('degraded',false),'unknown');
});
