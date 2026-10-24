import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import http from "node:http";
import { buildPayload, rankLine, validatePayload } from "../src/payload.js";
import { shareText, xIntentUrl } from "../src/share.js";
import { DEFAULT_API } from "../src/rank-client.js";

const run = promisify(execFile);
const BIN = fileURLToPath(new URL("../bin/afk-wrapped.js", import.meta.url));
const KEY_A = "a".repeat(48);

function stats(overrides = {}) {
  return {
    awayHours: 264, agentHours: 453, sleepHours: 88, agentHoursParallel: 852, peakParallel: 44, runs: 5587,
    humanPrompts: 1797, toolCalls: 199303, actionsPerPrompt: 110.9, filesTouched: 7442, outTokens: 375e6,
    longestRun: { minutes: 700, cwd: "C:\\secret\\project", start: 0 }, dayStreak: 35, interrupts: 33,
    hourAgent: new Array(24).fill(10), hourHuman: new Array(24).fill(2),
    topTools: [{ key: "Bash", count: 139000 }, { key: "mcp__acme-notes__get_page", count: 900 },
      { key: "mcp__private-crm__find", count: 800 }, { key: "Read", count: 500 }],
    topExts: [{ key: ".py", count: 50 }, { key: "MEMO", count: 9 }, { key: ".md", count: 8 }],
    topWord: { word: "fuck", count: 190 },
    ...overrides,
  };
}

test("payload carries totals only: no paths, no MCP server names, no odd file names", () => {
  const p = buildPayload(stats(), { year: 2026, handle: "pat" });
  const text = JSON.stringify(p);
  assert.doesNotMatch(text, /secret|acme-notes|private-crm|MEMO|cwd/);
  assert.deepEqual(p.topTools.map((t) => t.key), ["Bash", "MCP", "Read"]);
  assert.deepEqual(p.topTools[1], { key: "MCP", count: 1700 });
  assert.deepEqual(p.topExts.map((t) => t.key), [".py", "other", ".md"]);
  assert.equal(p.longestRunMinutes, 700);
});

test("validation rejects impossible or hostile payloads with a reason", () => {
  const good = buildPayload(stats(), { year: 2026 });
  const bad = (patch, reason) => assert.throws(() => validatePayload({ ...good, ...patch }), new RegExp(reason));
  bad({ awayHours: 9000, agentHours: 9000 }, "awayHours out of range");
  bad({ awayHours: 500 }, "cannot exceed agent hours");
  bad({ handle: "<script>" }, "handle must be");
  bad({ hourAgent: [1, 2, 3] }, "hourAgent must be 24");
  bad({ topTools: [{ key: "rm -rf /", count: 1 }] }, "topTools has a bad entry");
  bad({ topWord: { word: "hello", count: 1 } }, "word list");
  bad({ v: 99 }, "unsupported payload version");
});

test("rank line shows a percentile only once the board has 20 people", () => {
  assert.equal(rankLine({ rank: 1, total: 3 }), "#1 OF 3");
  assert.equal(rankLine({ rank: 12, total: 340 }), "TOP 4% · #12 OF 340");
  assert.equal(rankLine({ rank: 1, total: 5000 }), "TOP 1% · #1 OF 5,000");
});

// The board lives at bmdpat.com/wrapped (bmdpat repo, src/lib/wrapped). This
// stand-in answers the one endpoint the CLI calls, the way that route does.
async function withServer(fn) {
  const posts = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.method !== "POST" || req.url !== "/api/wrapped/rank") {
        res.writeHead(404).end("not found");
        return;
      }
      const input = JSON.parse(body);
      validatePayload(input.payload);
      posts.push(input);
      const shareId = "Test000001";
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
        shareId, rank: 1, total: 1, url: `https://bmdpat.com/wrapped/w/${shareId}`, line: rankLine({ rank: 1, total: 1 }),
      }));
    });
  });
  await new Promise((r) => server.listen(0, r));
  try {
    return await fn(`http://localhost:${server.address().port}`, posts);
  } finally {
    server.close();
  }
}

test("the CLI ranks against bmdpat.com by default", () => {
  assert.equal(DEFAULT_API, "https://bmdpat.com");
});

async function fixtureLogs() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afk-rank-"));
  const project = path.join(dir, "C--code-demo");
  await mkdir(project);
  const ts = (h, d = 14) => new Date(2026, 2, d, h, 0).toISOString();
  const lines = [
    { type: "user", timestamp: ts(22), sessionId: "s", origin: { kind: "human" }, version: "2.1.30", message: { content: "go bro" } },
    { type: "assistant", timestamp: ts(23), sessionId: "s", cwd: "/x", message: { usage: { output_tokens: 5 }, content: [{ type: "tool_use", name: "Bash", input: {} }] } },
    { type: "assistant", timestamp: ts(3, 15), sessionId: "s", cwd: "/x", message: { usage: { output_tokens: 5 }, content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/a.py" } }] } },
  ];
  await writeFile(path.join(project, "s.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
  return dir;
}

// Same words as src/lib/wrapped/share.ts on bmdpat.com, so the CLI and the
// share page post the same thing.
test("the X post names the hours, persona and rank, and fits with the link", () => {
  assert.equal(
    shareText({ awayHours: 70, persona: "THE NIGHT SHIFT MANAGER", rankLine: "TOP 8% · #3 OF 40" }),
    "My AI agents worked 70 hours this year while I was away.\nI'm THE NIGHT SHIFT MANAGER, TOP 8% · #3 OF 40 on AFK Wrapped.\nHow many did yours? npx afk-wrapped",
  );
  const longest = shareText({ awayHours: 8784, persona: "THE NIGHT SHIFT MANAGER", rankLine: "TOP 1% · #99,999 OF 99,999" });
  assert.ok(longest.length + 1 + 23 <= 280, "X counts the link as 23 characters");
  const intent = new URL(xIntentUrl("a & b", "https://bmdpat.com/wrapped/w/X"));
  assert.equal(intent.searchParams.get("text"), "a & b");
  assert.equal(intent.searchParams.get("url"), "https://bmdpat.com/wrapped/w/X");
});

test("first use of --rank: CLI submits, prints the share link, and stamps the rank on the summary", async () => {
  await withServer(async (api, posts) => {
    const logs = await fixtureLogs();
    const env = { ...process.env, AFK_WRAPPED_API: api, AFK_WRAPPED_HOME: path.join(logs, "home") };
    const out = path.join(logs, "out");
    const { stdout } = await run(process.execPath, [BIN, "--logs", logs, "--year", "2026", "--out", out, "--rank", "--handle", "tester"], { env });
    assert.match(stdout, /--rank: sending these totals/);
    assert.match(stdout, /rank: #1 OF 1/);
    assert.match(stdout, /share: https:\/\/bmdpat\.com\/wrapped\/w\/Test000001/);
    const intent = new URL(stdout.match(/post on X: (\S+)/)[1]);
    assert.equal(intent.origin + intent.pathname, "https://x.com/intent/tweet");
    assert.equal(intent.searchParams.get("url"), "https://bmdpat.com/wrapped/w/Test000001");
    assert.match(intent.searchParams.get("text"), /^My AI agents worked \d+ hours[^]*#1 OF 1 on AFK Wrapped\.\nHow many did yours\? npx afk-wrapped$/);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].payload.handle, "tester");
    assert.doesNotMatch(JSON.stringify(posts[0]), /C--code-demo|a\.py|go bro/, "no project, file or prompt text leaves the machine");
    await readFile(path.join(out, "09-summary.png"));
    const key = await readFile(path.join(logs, "home", "device-key"), "utf8");
    assert.match(key.trim(), /^[a-f0-9]{48}$/);
  });
});

test("--rank with the server down still writes the cards, then fails loudly", async () => {
  const logs = await fixtureLogs();
  const env = { ...process.env, AFK_WRAPPED_API: "http://127.0.0.1:9", AFK_WRAPPED_HOME: path.join(logs, "home") };
  const out = path.join(logs, "out");
  await assert.rejects(run(process.execPath, [BIN, "--logs", logs, "--year", "2026", "--out", out, "--rank"], { env }), (err) => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /--rank failed, so the cards have no rank/);
    return true;
  });
  await readFile(path.join(out, "09-summary.png"));
});
