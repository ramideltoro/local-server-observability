import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { metricObservation, scoreSystem } from "../server/health-engine.mjs";
const config=JSON.parse(fs.readFileSync(new URL("../config/operations.json",import.meta.url)));
const system=config.systems.find(s=>s.id==="pricedip");
const now=Date.now();
const sample=value=>({state:"live",series:[{values:[[now/1000,String(value)]]}]});
test("PriceDip telemetry and worker failures cross the defined minute thresholds and recover",()=>{
  for(const id of ["telemetry","worker"]){
    const check=system.checks.find(c=>c.id===id);
    assert.equal(metricObservation(check,sample(179),now).status,"pass");
    assert.equal(metricObservation(check,sample(180),now).status,"warning");
    assert.equal(metricObservation(check,sample(300),now).status,"fail");
    assert.equal(metricObservation(check,{state:"no-data",series:[]},now).status,"unknown");
    assert.equal(metricObservation(check,sample(0),now).status,"pass");
  }
});
test("PriceDip stale tracking, Qwen outage and wiki drift degrade capabilities without failing the HTTP endpoint",()=>{
  const observations=system.checks.map(c=>({...c,status:"pass",fresh:true}));
  for(const [id,value,status] of [["stale",1,"warning"],["qwen",0,"fail"],["docs",0,"fail"]]){
    const c=system.checks.find(c=>c.id===id);
    const result=metricObservation(c,sample(value),now);
    assert.equal(result.status,status);
    const degraded=scoreSystem(system,observations.map(x=>x.id===id?{...x,...result}:x));
    assert.equal(degraded.checks.find(x=>x.id==="endpoint:pricedip").status,"pass");
    assert(degraded.score<100);
  }
});
