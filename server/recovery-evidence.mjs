// Only the root-owned recovery runner writes this evidence. Never infer a drill
// from a backup job, nor accept a passing result for a different deployment.
export const MAX_AGE = 8 * 86400000;
export function recoveryObservation(document, system, kind, now = Date.now()) {
  const unknown = (note) => ({status: "unknown", fresh: false, evidenceState: "no-data", note});
  if (document?.version !== 1 || !["readiness", "restore"].includes(kind))
    return unknown("Recovery evidence unavailable");
  const app = document.systems?.[system], e = app?.[kind];
  if (!app || !e) return unknown("No application recovery result recorded");
  const observed = Date.parse(app.observedAt), tested = Date.parse(e.verifiedAt), expires = Date.parse(e.expiresAt);
  if (![observed, tested, expires].every(Number.isFinite) || observed > now + 60000 || tested > now + 60000 ||
      now - observed > 20 * 60000 || now - tested >= MAX_AGE || expires <= now || expires > tested + MAX_AGE)
    return unknown("Recovery evidence expired or current deployment is unverified");
  if (!app.revision || app.revision !== e.testedRevision)
    return unknown("Deployment changed; isolated recovery must be repeated");
  if (e.outcome === "fail") return {status: "fail", fresh: true, at: e.verifiedAt, note: "Application recovery verification failed; private run evidence retained"};
  if (!/^[a-f0-9]{64}$/.test(e.backupReference || ""))
    return unknown("Verified backup reference missing");
  const required = kind === "restore" ? ["archive-integrity", "isolated-network", "restored-data", "application-behavior"] : ["archive-integrity", "required-components"];
  if (e.outcome !== "pass" || !required.every(t => e.tests?.[t] === true))
    return unknown("Required recovery checks have not all passed");
  return {status: "pass", fresh: true, at: e.verifiedAt, scope: kind === "restore" ? "Isolated application restore" : "Backup and recovery readiness", note: kind === "restore" ? "Restored application behavior verified against the current deployment" : "Archived recovery components verified; restore is evaluated separately"};
}
export function applicationLogObservation(at, now=Date.now()) {
  const time=Date.parse(at), fresh=Number.isFinite(time)&&time<=now+60000&&now-time<3600000;
  return {status:fresh?'pass':'unknown',fresh,at:fresh?at:undefined,note:fresh?'Application-specific log stream has activity within the last hour':'No fresh application log stream observed'};
}
