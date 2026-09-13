import { createHash } from 'node:crypto';
export const issueId = (system, check, signature) => createHash('sha256').update(JSON.stringify([system, check, signature])).digest('hex').slice(0,24);
// Only a completed check can resolve a previous failure. Missing data is never success.
export function reconcile(previous, checks, at) {
  const issues = structuredClone(previous);
  for (const check of checks) {
    const existing = issues.filter(i => i.system === check.system && i.check === check.id);
    const failures = check.failures || [];
    for (const failure of failures) {
      const id = issueId(check.system, check.id, failure.signature);
      let issue = issues.find(i => i.id === id);
      if (!issue) { issue = {id,system:check.system,check:check.id,firstSeen:at,lastSeen:at,occurrences:0,history:[]}; issues.push(issue); }
      const status = issue.status === 'Remediated' ? 'Reopened' : issue.status ? 'Ongoing' : 'New';
      issue.status = status; issue.lastSeen = at; issue.occurrences += failure.count || 1;
      issue.severity = failure.severity || 'warning'; issue.summary = failure.summary;
      issue.evidence = failure.evidence || []; issue.evidenceAt = at;
      issue.history.push({at,status});
    }
    for (const issue of existing) {
      if (failures.some(f => issueId(check.system,check.id,f.signature) === issue.id) || issue.status === 'Remediated') continue;
      const status = check.complete ? 'Remediated' : 'Unverified';
      if (issue.status !== status) issue.history.push({at,status});
      issue.status = status;
    }
  }
  for (const issue of issues) if (Date.parse(at)-Date.parse(issue.evidenceAt||at)>90*86400000) delete issue.evidence;
  return issues;
}
export function summarize(report) {
  const incomplete = report.checks.filter(c=>!c.complete).length;
  const failed = report.checks.filter(c=>c.failures?.length).length;
  return `${report.checks.length} checks examined; ${failed} found issues and ${incomplete} have incomplete coverage. Only completed checks can establish remediation.`;
}
