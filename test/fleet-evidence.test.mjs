
import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
test('production ingestion evidence cannot consume shadow worker metrics',()=>{const config=JSON.parse(fs.readFileSync(new URL('../config/operations.json',import.meta.url)));const cloud=config.systems.find(s=>s.id==='nutsnews-cloud-workers');const checks=cloud.checks.filter(c=>c.expr);assert(checks.length>=3);for(const c of checks){assert(c.expr.includes('job="nutsnews-backend-host"'));assert(!c.expr.includes('max(nutsnews_worker_last_success_timestamp_seconds)'));}const age=checks.find(c=>c.id==='freshness');assert(age.expr.includes("nutsnews_backend_legacy_worker_fresh_within_15_minutes"));assert.equal(age.direction,"below");assert.equal(age.fail,1);});
