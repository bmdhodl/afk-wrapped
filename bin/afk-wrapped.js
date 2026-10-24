#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { renderSvg, fmtInt } from "../src/card.js";
import { renderSlides } from "../src/slides.js";
import { buildPayload } from "../src/payload.js";
import { pickPersona } from "../src/persona.js";
import { DEFAULT_API, describePayload, loadDeviceKey, submitRank } from "../src/rank-client.js";
import { toPng } from "../src/render.js";
import { shareText, xIntentUrl } from "../src/share.js";
import { defaultLogDir, findTranscripts, scanAll } from "../src/scan.js";
import { Tally } from "../src/tally.js";

const HELP = `afk-wrapped: a Wrapped card for the work your AI agents did while you were away.

Usage: npx afk-wrapped [options]

  --year <yyyy>      year to wrap (default: this year)
  --logs <dir>       Claude Code projects folder (default: ~/.claude/projects)
  --out <dir>        folder for the story slides and card (default: afk-wrapped-<year>)
  --svg              also write the SVGs
  --json             print the stats as JSON
  --show-projects    put the longest run's folder name on the card (off by default)
  --rank             opt in: send your totals to the public board, get a rank and a share link
  --handle <name>    with --rank: your name on the board (letters, digits, _)
  -h, --help

Everything runs on your machine. It reads your logs and never changes them.
It sends nothing unless you add --rank. The card shows totals only: no code, no prompts.
--rank sends totals only (hours, counts, top tool names and file types). Never code, prompts or paths.`;

const { values: opts } = parseArgs({
  options: {
    year: { type: "string" },
    logs: { type: "string" },
    out: { type: "string" },
    svg: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    "show-projects": { type: "boolean", default: false },
    rank: { type: "boolean", default: false },
    handle: { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

const year = Number(opts.year || new Date().getFullYear());
if (!Number.isInteger(year) || year < 2000 || year > 3000) {
  console.error(`afk-wrapped: --year must be a year like 2026, not "${opts.year}"`);
  process.exit(2);
}
const from = new Date(year, 0, 1).getTime();
const to = new Date(year + 1, 0, 1).getTime();
const logDir = opts.logs || defaultLogDir();

console.error(`afk-wrapped reads your Claude Code logs on this machine and sends nothing unless you add --rank.`);
const files = await findTranscripts(logDir, { since: from });
if (files.length === 0) {
  console.error(`afk-wrapped: no Claude Code transcripts from ${year} in ${logDir}`);
  console.error("Run some Claude Code sessions first, or point --logs at your projects folder.");
  process.exit(1);
}

const started = Date.now();
const stats = await scanAll(files, new Tally({ from, to }), (done, total) => {
  if (process.stderr.isTTY) process.stderr.write(`\rreading ${done}/${total} transcripts`);
});
if (process.stderr.isTTY) process.stderr.write("\n");

if (stats.runs === 0) {
  console.error(`afk-wrapped: found ${files.length} transcripts, but no agent work in ${year}.`);
  process.exit(1);
}

if (opts.json) console.log(JSON.stringify(stats, null, 2));

let rank = null;
let rankError = null;
let payload = null;
if (opts.handle && !opts.rank) {
  console.error("afk-wrapped: --handle only matters with --rank");
  process.exit(2);
}
if (opts.rank) {
  const api = process.env.AFK_WRAPPED_API || DEFAULT_API;
  try {
    payload = buildPayload(stats, { year, handle: opts.handle ?? null });
    console.log(`--rank: sending these totals to ${api}
${describePayload(payload)}`);
    rank = await submitRank({ api, key: await loadDeviceKey(process.env.AFK_WRAPPED_HOME || undefined), payload });
  } catch (err) {
    rankError = err;
  }
}

const outDir = path.resolve(opts.out || `afk-wrapped-${year}`);
await mkdir(outDir, { recursive: true });
const images = [
  ...renderSlides(stats, { year, rank }),
  { name: "card", svg: renderSvg(stats, { year, showProjects: opts["show-projects"], rank }) },
];
for (const { name, svg } of images) {
  const png = toPng(svg);
  await writeFile(path.join(outDir, `${name}.png`), png);
  if (opts.svg) await writeFile(path.join(outDir, `${name}.svg`), svg);
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(`${fmtInt(stats.awayHours)} hours of agent work while you were away, in ${files.length} transcripts (${secs}s).`);
console.log(`story: ${outDir} (${images.length - 1} slides, post 09-summary.png or card.png)`);
if (rank) {
  const text = shareText({ awayHours: payload.awayHours, persona: pickPersona(stats).name, rankLine: rank.line });
  console.log(`rank: ${rank.line}
share: ${rank.url}
post on X: ${xIntentUrl(text, rank.url)}`);
} else if (!opts.rank) {
  console.log("tip: add --rank for a link that shows your card on X, LinkedIn and Slack.");
}
if (rankError) {
  console.error(`afk-wrapped: --rank failed, so the cards have no rank: ${rankError.message}`);
  process.exit(1);
}
