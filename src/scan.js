// Stream every transcript under a Claude Code projects folder into a Tally.

import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { classifyRecord } from "./classify.js";

export function defaultLogDir() {
  const base = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  return path.join(base, "projects");
}

export async function findTranscripts(dir, { since = 0 } = {}) {
  const out = [];
  async function walk(d) {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") return;
      throw err;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".jsonl") && (await stat(p)).mtimeMs >= since) out.push(p);
    }
  }
  await walk(dir);
  return out.sort();
}

// Only these lines can become events. Checking the text first skips
// JSON.parse on large tool-result lines, which are most of the bytes.
function mayMatter(line) {
  if (line.includes('"type":"assistant"')) return true;
  return line.includes('"type":"user"') && !line.includes('"type":"tool_result"');
}

export async function scanFile(file, tally) {
  tally.beginRun(path.basename(file, ".jsonl"));
  const lines = readline.createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!mayMatter(line)) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // a half-written last line from a live session
    }
    tally.add(classifyRecord(rec));
  }
  tally.endRun();
}

export async function scanAll(files, tally, onProgress = () => {}) {
  for (let i = 0; i < files.length; i++) {
    await scanFile(files[i], tally);
    onProgress(i + 1, files.length);
  }
  return tally.finish();
}
