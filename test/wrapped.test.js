import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { classifyRecord } from "../src/classify.js";
import { censor, renderSvg } from "../src/card.js";
import { pickPersona } from "../src/persona.js";
import { prettyModel, quietStretch, renderSlides } from "../src/slides.js";
import { Tally } from "../src/tally.js";

const run = promisify(execFile);
const BIN = fileURLToPath(new URL("../bin/afk-wrapped.js", import.meta.url));

// Local-time timestamps so hour-of-day checks hold in any timezone.
const at = (hh, mm, day = 14) => new Date(2026, 2, day, hh, mm).toISOString();

const agent = (ts, { session = "s1", tools = [], tokens = 10 } = {}) => ({
  type: "assistant",
  timestamp: ts,
  sessionId: session,
  cwd: "/home/me/code/demo",
  entrypoint: "claude-desktop",
  message: {
    model: "claude-opus-5-5",
    usage: { output_tokens: tokens },
    content: tools.map(([name, file]) => ({ type: "tool_use", name, input: file ? { file_path: file } : {} })),
  },
});

const prompt = (ts, text, extra = {}) => ({
  type: "user",
  timestamp: ts,
  sessionId: "s1",
  entrypoint: "claude-desktop",
  message: { role: "user", content: text },
  ...extra,
});

test("classify keeps typed prompts and agent turns, drops tool results and wrappers", () => {
  assert.equal(classifyRecord(prompt(at(9, 0), "fix the build")).kind, "human");
  assert.equal(classifyRecord(prompt(at(9, 0), "nightly digest", { entrypoint: "sdk-cli" })).kind, "auto");
  assert.equal(classifyRecord(prompt(at(9, 0), "<command-name>/clear</command-name>")), null);
  assert.equal(classifyRecord(prompt(at(9, 0), "brief", { isSidechain: true })), null);
  assert.equal(classifyRecord(prompt(at(9, 0), "x", { isMeta: true })), null);
  const toolResult = prompt(at(9, 0), [{ type: "tool_result", content: "ok" }]);
  assert.equal(classifyRecord(toolResult), null);

  const a = classifyRecord(agent(at(9, 1), { tools: [["Edit", "/a.js"], ["Bash"]], tokens: 42 }));
  assert.equal(a.kind, "agent");
  assert.deepEqual(a.tools, [{ name: "Edit", file: "/a.js" }, { name: "Bash", file: null }]);
  assert.equal(a.outTokens, 42);
});

test("REGRESSION: briefs sent by schedulers or other sessions are not your prompts", () => {
  const human = { origin: { kind: "human" }, version: "2.1.29" };
  assert.equal(classifyRecord(prompt(at(9, 0), "ship it", human)).kind, "human");
  // Newer logs mark typed prompts with origin.kind "human"; anything else was sent by a machine.
  assert.equal(classifyRecord(prompt(at(9, 0), "You are the digest agent", { version: "2.1.29" })).kind, "auto");
  assert.equal(classifyRecord(prompt(at(9, 0), "relay", { version: "2.1.29", origin: { kind: "session" } })).kind, "auto");
  // Older logs have no origin field at all, so they fall back to the entrypoint.
  assert.equal(classifyRecord(prompt(at(9, 0), "fix it", { version: "2.1.17" })).kind, "human");
  assert.equal(classifyRecord(prompt(at(9, 0), "fix it", { version: "2.0.5" })).kind, "human");
});

test("REGRESSION: longest run is the longest unbroken stretch, not a resumed session's total", () => {
  const t = new Tally();
  t.beginRun("s1");
  for (let m = 0; m < 50; m += 5) t.add(classifyRecord(agent(at(1, m))));  // 01:00-01:45, gaps of 5 min
  t.add(classifyRecord(agent(at(1, 0, 16))));                                // resumed two days later
  t.endRun();
  const s = t.finish();
  assert.equal(s.longestRun.minutes, 46);
});

test("agent work counts as away only after 30 quiet minutes", () => {
  const t = new Tally();
  t.add(classifyRecord(prompt(at(10, 0), "go")));
  t.beginRun("s1");
  t.add(classifyRecord(agent(at(10, 10))));  // you were here 10 minutes ago
  t.add(classifyRecord(agent(at(10, 45))));  // 45 quiet minutes: away
  t.add(classifyRecord(agent(at(3, 0, 15)))); // next night: away and asleep
  t.endRun();
  const s = t.finish();
  assert.equal(s.agentHours * 60, 3);
  assert.equal(s.awayHours * 60, 2);
  assert.equal(s.sleepHours * 60, 1);
  assert.equal(s.hourAgent[3], 1);
  assert.equal(s.hourHuman[10], 1);
});

test("parallel runs stack into agent-hours and peak, not wall-clock hours", () => {
  const t = new Tally();
  for (const session of ["a", "b", "c"]) {
    t.beginRun(session);
    t.add(classifyRecord(agent(at(2, 0), { session, tools: [["Write", `/${session}.md`]] })));
    t.endRun();
  }
  const s = t.finish();
  assert.equal(s.agentHours * 60, 1);
  assert.equal(s.agentHoursParallel * 60, 3);
  assert.equal(s.peakParallel, 3);
  assert.equal(s.runs, 3);
  assert.equal(s.filesTouched, 3);
  assert.equal(s.toolCalls, 3);
  assert.deepEqual(s.topTool, { key: "Write", count: 3 });
});

test("fun stats: stops, streak, words per prompt, file types, top 5 tools, months", () => {
  const t = new Tally();
  t.add(classifyRecord(prompt(at(9, 0), "[Request interrupted by user]")));
  t.add(classifyRecord(prompt(at(9, 1), "ship the thing now", { origin: { kind: "human" } })));
  t.beginRun("s1");
  for (const day of [14, 15, 16, 18]) t.add(classifyRecord(agent(at(16, 0, day), { tools: [["Edit", `/n${day}.md`], ["Bash"]] })));
  t.add(classifyRecord(agent(at(16, 5, 18), { tools: [["Write", "/a.py"]] })));
  t.endRun();
  const s = t.finish();
  assert.equal(s.interrupts, 1);
  assert.equal(s.humanPrompts, 1, "a stop is not a prompt");
  assert.equal(s.wordsPerPrompt, 4);
  assert.equal(s.dayStreak, 3);
  assert.equal(s.favoriteHour, 16);
  assert.deepEqual(s.topExt, { key: ".md", share: 0.8 });
  assert.deepEqual(s.topTools.map((x) => x.key), ["Edit", "Bash", "Write"]);
  assert.equal(s.monthAgent[2] * 60, 5);
});

test("persona: first matching rule wins, other matches become traits", () => {
  const base = { agentHours: 100, awayHours: 10, sleepHours: 0, peakParallel: 1, topTool: { key: "Edit" },
    toolShare: 0.3, humanPrompts: 100, actionsPerPrompt: 30 };
  assert.equal(pickPersona(base).name, "THE PAIR PROGRAMMER");
  assert.equal(pickPersona({ ...base, actionsPerPrompt: 3 }).name, "THE MICROMANAGER");
  const night = pickPersona({ ...base, awayHours: 55, sleepHours: 20, peakParallel: 44,
    topTool: { key: "Bash" }, toolShare: 0.7 });
  assert.equal(night.name, "THE NIGHT SHIFT MANAGER");
  assert.deepEqual(night.traits, ["SWARM LORD", "BASH GOBLIN"]);
});

test("slides: nine story slides, quiet hours wrap past midnight, model names read well", () => {
  const hours = new Array(24).fill(3);
  for (const h of [23, 0, 1, 2]) hours[h] = 0;
  assert.deepEqual(quietStretch(hours), { from: 23, to: 3, len: 4 });
  assert.equal(quietStretch(new Array(24).fill(1)), null);
  assert.equal(prettyModel("claude-opus-5-5"), "Opus 5.5");
  assert.equal(prettyModel("claude-sonnet-4-5-20250929"), "Sonnet 4.5");

  const t = new Tally();
  t.beginRun("s1");
  t.add(classifyRecord(agent(at(4, 0), { tools: [["Edit", "/a.md"]] })));
  t.endRun();
  const slides = renderSlides(t.finish(), { year: 2026 });
  assert.deepEqual(slides.map((s) => s.name.slice(3)),
    ["intro", "away", "swarm", "sleep", "tools", "leverage", "receipts", "persona", "summary"]);
  assert.ok(slides.every((s) => s.svg.startsWith("<svg ") && s.svg.includes('height="1920"')));
});

test("the year window drops events outside it", () => {
  const t = new Tally({ from: new Date(2026, 0, 1).getTime(), to: new Date(2027, 0, 1).getTime() });
  t.beginRun("s1");
  t.add(classifyRecord(agent(new Date(2025, 11, 31, 23, 0).toISOString())));
  t.add(classifyRecord(agent(at(1, 0))));
  t.endRun();
  assert.equal(t.finish().agentHours * 60, 1);
});

test("top word prefers the spicy list and folds fucking into fuck", () => {
  const t = new Tally();
  t.add(classifyRecord(prompt(at(9, 0), "bro this is fucking broken, fuck it, please")));
  assert.deepEqual(t.finish().topWord, { word: "fuck", count: 2 });
  assert.equal(censor("fuck"), "f**k");
  assert.equal(censor("bro"), "bro");
});

test("card shows the away hours and escapes text", () => {
  const t = new Tally();
  t.beginRun("s1");
  t.add(classifyRecord(agent(at(4, 0), { tools: [["Bash"]] })));
  t.endRun();
  const stats = { ...t.finish(), awayHours: 1234, topTool: { key: "<Bash&>", count: 9 } };
  const svg = renderSvg(stats, { year: 2026 });
  assert.match(svg, /^<svg /);
  assert.match(svg, />1,234</);
  assert.match(svg, /&lt;Bash&amp;&gt;/);
  assert.doesNotMatch(svg, /demo/, "project folder stays off the card by default");
  assert.match(renderSvg(stats, { year: 2026, showProjects: true }), /demo/);
});

async function logsDir(lines) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afk-wrapped-"));
  const project = path.join(dir, "C--code-demo");
  await mkdir(project);
  await writeFile(path.join(project, "s1.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return dir;
}

test("first use: the CLI writes a PNG card from a logs folder", async () => {
  const dir = await logsDir([
    prompt(at(23, 0), "ship it bro"),
    agent(at(23, 5), { tools: [["Edit", "/x.js"]] }),
    agent(at(2, 0, 15), { tools: [["Bash"]] }),
    "not json {",
  ]);
  const out = path.join(dir, "wrapped");
  const { stdout, stderr } = await run(process.execPath, [BIN, "--logs", dir, "--year", "2026", "--out", out]);
  assert.match(stdout, /story: .*9 slides/);
  // Say what it touches before it reads anything, and how to get a link to post.
  assert.match(stderr, /reads your Claude Code logs on this machine and sends nothing unless you add --rank/);
  assert.match(stdout, /add --rank for a link that shows your card on X/);
  for (const name of ["01-intro", "09-summary", "card"]) {
    const png = await readFile(path.join(out, `${name}.png`));
    assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47], `${name} is a PNG`);
  }
});

test("empty state: no transcripts gives a clear message and exit 1", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "afk-wrapped-empty-"));
  await assert.rejects(run(process.execPath, [BIN, "--logs", dir, "--year", "2026"]), (err) => {
    assert.equal(err.code, 1);
    assert.match(err.stderr, /no Claude Code transcripts from 2026/);
    return true;
  });
});

test("a bad --year fails loudly", async () => {
  await assert.rejects(run(process.execPath, [BIN, "--year", "soon"]), (err) => err.code === 2);
});
