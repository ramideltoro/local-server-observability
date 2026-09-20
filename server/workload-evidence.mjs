export function fantasyWorkloadEvidence(evidence, pid, now = Date.now()) {
  const workload = evidence?.workloads?.fantasyQwen;
  const age = now - Date.parse(evidence?.observedAt);
  if (!(age >= 0 && age < 20 * 60000) || workload?.pid !== String(pid) || !/^[1-9][0-9]*$/.test(String(pid))) return null;
  if (!Number.isFinite(workload.latest) || workload.latest > now / 1000 || workload.latest <= now / 1000 - 900) return null;
  if (!Number.isInteger(workload.count) || workload.count < 5 || !Number.isFinite(workload.maxSeconds) || workload.maxSeconds < 0 || ![0, 1].includes(workload.met)) return null;
  if (workload.met === 1 && workload.maxSeconds >= 220) return null;
  return workload;
}
