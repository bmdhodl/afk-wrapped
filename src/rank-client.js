// The CLI side of --rank: a private device key, and one POST of the totals.

import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The board, share pages and card images live at bmdpat.com/wrapped.
export const DEFAULT_API = "https://bmdpat.com";

// One random key per machine. Re-running --rank updates your entry instead of adding a new one.
export async function loadDeviceKey(dir = path.join(os.homedir(), ".afk-wrapped")) {
  const file = path.join(dir, "device-key");
  try {
    const key = (await readFile(file, "utf8")).trim();
    if (/^[a-f0-9]{32,128}$/.test(key)) return key;
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
  const key = randomBytes(24).toString("hex");
  await mkdir(dir, { recursive: true });
  await writeFile(file, key + "\n", { mode: 0o600 });
  return key;
}

export async function submitRank({ api, key, payload, fetchImpl = fetch }) {
  const res = await fetchImpl(`${api.replace(/\/$/, "")}/api/wrapped/rank`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, payload }),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`rank server answered ${res.status} with something that is not JSON`);
  }
  if (!res.ok) throw new Error(`rank server said ${res.status}: ${body.error ?? text.slice(0, 200)}`);
  return body; // { shareId, rank, total, url, line }
}

export function describePayload(p) {
  return [
    `  year ${p.year}${p.handle ? `, handle @${p.handle}` : ", no handle (shows as anonymous)"}`,
    `  hours: ${Math.round(p.awayHours)} away, ${Math.round(p.agentHours)} total, ${Math.round(p.sleepHours)} asleep`,
    `  counts: runs, prompts, tool calls, files touched, tokens, streak, stops`,
    `  top tools: ${p.topTools.map((t) => t.key).join(", ") || "-"}`,
    `  top file types: ${p.topExts.map((t) => t.key).join(", ") || "-"}`,
    `  24-hour activity shape (agents and your prompts)`,
  ].join("\n");
}
