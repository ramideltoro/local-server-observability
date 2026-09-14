import { randomUUID } from "node:crypto";
export function configurationProposal(input, config) {
  if (
    !input ||
    Object.keys(input).some(
      (k) =>
        !["system", "check", "warn", "fail", "availabilityTarget"].includes(k),
    )
  )
    throw Error("Unsupported proposal");
  const next = structuredClone(config),
    system = next.systems.find((s) => s.id === input.system);
  if (!system) throw Error("Unknown system");
  if (input.availabilityTarget !== undefined) {
    if (
      system.kind !== "application" ||
      typeof input.availabilityTarget !== "number" ||
      input.availabilityTarget < 90 ||
      input.availabilityTarget >= 100
    )
      throw Error("Invalid objective");
    system.objective = {
      ...system.objective,
      availability: input.availabilityTarget,
      provisional: false,
    };
  } else {
    const check = system.checks.find((c) => c.id === input.check);
    if (!check || (!check.metric && !check.expr))
      throw Error("Registered metric required");
    for (const key of ["warn", "fail"])
      if (input[key] !== undefined) {
        if (
          typeof input[key] !== "number" ||
          !Number.isFinite(input[key]) ||
          input[key] < 0 ||
          input[key] > 1e9
        )
          throw Error("Invalid threshold");
        check[key] = input[key];
      }
    if (input.fail !== undefined) delete check.measureOnly;
    if (
      check.warn != null &&
      check.fail != null &&
      (check.direction === "below"
        ? check.warn <= check.fail
        : check.warn >= check.fail)
    )
      throw Error("Warning must precede failure");
  }
  return next;
}
export async function proposeConfiguration(input, config, token) {
  const next = configurationProposal(input, config);
  if (!token) throw Error("Git unavailable");
  const repo =
    "https://api.github.com/repos/ramideltoro/local-server-observability";
  async function api(p, method = "GET", payload) {
    const r = await fetch(repo + p, {
      method,
      headers: {
        Authorization: "Bearer " + token,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.timeout(12000),
    });
    if (!r.ok) throw Error("Git unavailable");
    return r.json();
  }
  const main = await api("/git/ref/heads/main"),
    branch = "operations/" + randomUUID();
  const current = await api(
    "/contents/config/operations.json?ref=" + main.object.sha,
  );
  // Reject proposals from a deployment that is behind Git, preventing lost configuration edits.
  if (
    JSON.stringify(
      JSON.parse(Buffer.from(current.content, "base64").toString()),
    ) !== JSON.stringify(config)
  )
    throw Error("Refresh deployment before proposing");
  await api("/git/refs", "POST", {
    ref: "refs/heads/" + branch,
    sha: main.object.sha,
  });
  await api("/contents/config/operations.json", "PUT", {
    branch,
    sha: current.sha,
    message: "Update reviewed operational target",
    content: Buffer.from(JSON.stringify(next, null, 2) + "\n").toString(
      "base64",
    ),
  });
  const pr = await api("/pulls", "POST", {
    head: branch,
    base: "main",
    title: "Update operational target for " + input.system,
    body: "Updates a validated registered threshold or availability objective. Health history and alert evaluation remain unchanged. Documentation fingerprints must be synchronized before deployment.",
  });
  return { url: pr.html_url };
}
