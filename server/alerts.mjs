import {createHash}from'node:crypto';
// No query strings, datasource credentials, labels, or template-expanded evidence cross this projection.
export function alertCatalog(config,groups,instances,now=new Date().toISOString()) {
 const runtime=(groups.data?.groups||[]).flatMap(g=>(g.rules||[]).map(r=>({...r,interval:g.interval,group:g.name})));
 return {updatedAt:now,rules:config.map(r=>{
  const run=runtime.find(x=>(x.uid&&x.uid===r.uid)||(x.name===r.title&&x.group===r.ruleGroup));
  const active=instances.filter(a=>a.labels?.__alert_rule_uid__===r.uid||a.labels?.alertname===r.title);
  const silenced=active.some(a=>a.status?.silencedBy?.length>0);
  const conditions=(r.data||[]).flatMap(d=>(d.model?.conditions||[]).map(c=>({operator:c.evaluator?.type,values:c.evaluator?.params}))).filter(c=>c.operator);
  const lookbacks=[...new Set((r.data||[]).map(d=>d.relativeTimeRange?.from).filter(Number.isFinite))];
  return {id:createHash('sha256').update(r.uid).digest('hex').slice(0,16),name:r.title,source:'Grafana Cloud',system:/backend/i.test(r.title)?'backend-vps':/raspberry/i.test(r.title)?'raspberry':/local/i.test(r.title)?'local':/nutsnews/i.test(r.title)?'nutsnews':'fleet',severity:['critical','warning','info'].includes(r.labels?.severity)?r.labels.severity:'unspecified',enabled:!r.isPaused,paused:!!r.isPaused,silenced,state:r.isPaused?'paused':run?.health==='error'?'evaluation-error':run?.state||'unknown',intervalSeconds:run?.interval??null,pending:r.for||'0s',lastEvaluation:run?.lastEvaluation||null,lookbackSeconds:lookbacks,thresholds:conditions,purpose:`${r.title}. Evaluated by the existing Cloud rule group.`,signal:'Metric expression (owner diagnostics)',datasource:'Grafana Cloud',runbook:'/../#alerts',evaluationNote:run?'Actual rule-group interval':'Rule-group evaluation metadata unavailable'};
 })};
}
