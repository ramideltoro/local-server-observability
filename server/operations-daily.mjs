import fs from "node:fs";
import { openOperations } from "./operations-store.mjs";
import { forecast } from "./health-engine.mjs";
const config = JSON.parse(
  fs.readFileSync(new URL("../config/operations.json", import.meta.url)),
);
const store = openOperations();
const items = [];
for (const system of config.systems)
  for (const check of system.checks.filter((c) => c.category === "resources"))
    items.push({
      system: system.id,
      signal: check.id,
      ...forecast(
        store.samples(system.id, check.id, Date.now() - 14 * 86400000),
        Date.now(),
        check.id === "disk",
      ),
    });
items.push({
  system: "nutsnews",
  signal: "queue",
  ...forecast(
    store.samples("nutsnews", "queue", Date.now() - 14 * 86400000),
    Date.now(),
    false,
    null,
  ),
});
store.put("forecasts", { at: Date.now(), items });
store.prune();
store.close();
console.log("Capacity forecasts and daily health summaries recorded.");
