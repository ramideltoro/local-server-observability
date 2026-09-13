import fs from "node:fs/promises";
import path from "node:path";
export const dataRoot =
  process.env.DATA_DIR || "/var/lib/local-server-observability";
export async function readState(dir = dataRoot) {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, "state.json"), "utf8"));
  } catch (e) {
    if (e.code === "ENOENT")
      return { version: 1, issues: [], reports: [], lastSuccess: null };
    throw e;
  }
}
export async function writeState(state, dir = dataRoot) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "state.json"),
    tmp = file + "." + process.pid + ".tmp";
  const handle = await fs.open(tmp, "wx", 0o600);
  try {
    await handle.writeFile(JSON.stringify(state));
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(tmp, file);
  const directory = await fs.open(dir, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}
