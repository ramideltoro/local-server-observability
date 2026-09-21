export function workflowObservation(snapshot, name, now = Date.now()) {
  if (!snapshot || snapshot.error || !Array.isArray(snapshot.runs) || !Number.isFinite(snapshot.at) || now < snapshot.at || now-snapshot.at > 1200000)
    return {status:"unknown",fresh:false,note:"Workflow source is unavailable or stale"};
  const run=snapshot.runs.find(r=>r.name===name && r.head_branch==="main" && r.event!=="pull_request");
  if (!run) return {status:"unknown",fresh:false,note:"No main-branch workflow evidence"};
  if (run.status!=="completed") return {status:"unknown",fresh:true,at:new Date(snapshot.at).toISOString(),note:"Latest main-branch workflow is still running"};
  return {status:run.conclusion==="success"?"pass":"fail",fresh:true,at:new Date(snapshot.at).toISOString(),note:run.conclusion==="success"?"Latest main-branch workflow succeeded":"Latest main-branch workflow did not succeed; review its GitHub run"};
}
