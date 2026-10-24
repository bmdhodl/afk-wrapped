// What --rank sends: totals only. Shared by the CLI (build) and the API (validate).
// No paths, no prompt text, no project names, no MCP server names.

export const PAYLOAD_VERSION = 1;
export const MAX_PAYLOAD_BYTES = 8_000;

const WORDS = ["fuck", "shit", "damn", "wtf", "bro", "bruh", "lol", "lmao", "please", "thanks"];
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const EXT = /^\.[a-z0-9]{1,10}$/;
const HANDLE = /^[A-Za-z0-9_]{1,24}$/;

const NUMBERS = {
  awayHours: 8784, // hours in a leap year
  agentHours: 8784,
  sleepHours: 8784,
  agentHoursParallel: 10_000_000,
  peakParallel: 100_000,
  runs: 10_000_000,
  humanPrompts: 10_000_000,
  toolCalls: 1_000_000_000,
  actionsPerPrompt: 1_000_000,
  filesTouched: 100_000_000,
  outTokens: 1e13,
  longestRunMinutes: 527_040,
  dayStreak: 366,
  interrupts: 10_000_000,
};

export function buildPayload(stats, { year, handle = null }) {
  const payload = { v: PAYLOAD_VERSION, year, handle };
  for (const field of Object.keys(NUMBERS)) {
    payload[field] = field === "longestRunMinutes" ? stats.longestRun?.minutes ?? 0 : stats[field] ?? 0;
  }
  payload.hourAgent = stats.hourAgent;
  payload.hourHuman = stats.hourHuman;
  payload.topTools = mergeTop(stats.topTools, (k) => (k.startsWith("mcp__") ? "MCP" : k));
  payload.topExts = mergeTop(stats.topExts, (k) => (EXT.test(k) ? k : "other"));
  payload.topWord = stats.topWord && WORDS.includes(stats.topWord.word) ? stats.topWord : null;
  return validatePayload(payload);
}

// Throws PayloadError with a reason a person can act on.
export function validatePayload(input) {
  if (!input || typeof input !== "object") throw new PayloadError("payload must be an object");
  if (input.v !== PAYLOAD_VERSION) throw new PayloadError(`unsupported payload version ${input.v}`);
  const year = input.year;
  if (!Number.isInteger(year) || year < 2024 || year > 2100) throw new PayloadError("year out of range");
  const handle = input.handle ?? null;
  if (handle !== null && !(typeof handle === "string" && HANDLE.test(handle))) {
    throw new PayloadError("handle must be 1-24 letters, digits or underscores");
  }
  const out = { v: PAYLOAD_VERSION, year, handle };
  for (const [field, max] of Object.entries(NUMBERS)) {
    const n = input[field];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > max) throw new PayloadError(`${field} out of range`);
    out[field] = n;
  }
  if (out.awayHours > out.agentHours + 1e-9 || out.sleepHours > out.agentHours + 1e-9) {
    throw new PayloadError("away and sleep hours cannot exceed agent hours");
  }
  for (const field of ["hourAgent", "hourHuman"]) {
    const a = input[field];
    if (!Array.isArray(a) || a.length !== 24 || !a.every((n) => Number.isFinite(n) && n >= 0 && n <= 1e7)) {
      throw new PayloadError(`${field} must be 24 non-negative numbers`);
    }
    out[field] = a;
  }
  out.topTools = topList(input.topTools, (k) => TOOL_NAME.test(k), "topTools");
  out.topExts = topList(input.topExts, (k) => EXT.test(k) || k === "other", "topExts");
  const w = input.topWord ?? null;
  if (w !== null && !(WORDS.includes(w.word) && Number.isInteger(w.count) && w.count >= 0 && w.count < 1e8)) {
    throw new PayloadError("topWord is not on the word list");
  }
  out.topWord = w && { word: w.word, count: w.count };
  if (JSON.stringify(out).length > MAX_PAYLOAD_BYTES) throw new PayloadError("payload too large");
  return out;
}

export class PayloadError extends Error {}

function topList(list, ok, name) {
  if (!Array.isArray(list) || list.length > 5) throw new PayloadError(`${name} must hold at most 5 entries`);
  return list.map((item) => {
    if (!item || typeof item.key !== "string" || !ok(item.key) || !Number.isInteger(item.count) || item.count < 0) {
      throw new PayloadError(`${name} has a bad entry`);
    }
    return { key: item.key, count: item.count };
  });
}

function mergeTop(list = [], rename) {
  const merged = new Map();
  for (const { key, count } of list) {
    const k = rename(key);
    merged.set(k, (merged.get(k) || 0) + count);
  }
  return [...merged].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, count]) => ({ key, count }));
}

// Persona inputs, rebuilt from a payload on the server.
export function personaInputs(p) {
  return {
    ...p,
    topTool: p.topTools[0] ? { key: p.topTools[0].key, count: p.topTools[0].count } : null,
    toolShare: p.toolCalls && p.topTools[0] ? p.topTools[0].count / p.toolCalls : 0,
    longestRun: { minutes: p.longestRunMinutes },
  };
}

// "TOP 3% · #12 OF 340", or just the rank while the board is small.
export function rankLine({ rank, total }) {
  const place = `#${rank.toLocaleString("en-US")} OF ${total.toLocaleString("en-US")}`;
  if (total < 20) return place;
  const top = Math.max(1, Math.ceil((rank / total) * 100));
  return `TOP ${top}% · ${place}`;
}
