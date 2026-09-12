import test from 'node:test';import assert from 'node:assert/strict';import {windowFor,redact,publicSeries,metricState} from '../server/core.mjs';
test('public series strips internal labels',()=>{const p=publicSeries([{metric:{instance:'private',user:'sensitive'},values:[[1,'2']]}]);assert.equal(JSON.stringify(p).includes('private'),false);assert.deepEqual(p[0].values,[[1,'2']])});
test('query windows are bounded',()=>{assert.equal(windowFor('999d',10000).start,6400);assert.equal(windowFor('7d',700000).end-windowFor('7d',700000).start,604800)});
test('missing and stale data do not become healthy',()=>{assert.equal(metricState([]),'unavailable');assert.equal(metricState([{values:[[1,'2']]}],1000),'stale');assert.equal(metricState([{values:[[1000,'2']]}],1000),'live')});
test('diagnostics redact credentials and email',()=>{const s=redact('token=secret123 user@example.com Bearer xyz');assert(!s.includes('secret123'));assert(!s.includes('user@example.com'));assert(!s.includes('xyz'))});
