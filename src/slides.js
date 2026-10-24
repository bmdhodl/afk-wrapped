// Stats -> a Spotify-Wrapped-style story: 1080x1920 slides, one stat each,
// ending on a summary card built to post. Pure functions, no I/O.

import { BG, DIM, INK, LINE, ORANGE, censor, fmtCompact, fmtDuration, fmtInt, hourChart, text } from "./card.js";
import { pickPersona } from "./persona.js";

export const SLIDE_W = 1080;
export const SLIDE_H = 1920;
const M = 80; // side margin

export function renderSlides(stats, { year, rank = null }) {
  const persona = pickPersona(stats);
  const bodies = [
    ["intro", intro(year)],
    ["away", bigStat({
      kicker: ["WHILE YOU WERE AWAY,", "YOUR AGENTS WORKED"],
      value: fmtInt(stats.awayHours),
      unit: "HOURS",
      foot: `${pct(stats.awayHours, stats.agentHours)} of all their hours · ${fmtInt(stats.sleepHours)} h while you slept`,
    })],
    ["swarm", bigStat({
      kicker: ["AT THEIR PEAK,", "YOU RAN"],
      value: fmtInt(stats.peakParallel),
      unit: "AGENTS AT ONCE",
      foot: `${fmtInt(stats.agentHoursParallel)} agent-hours across ${fmtInt(stats.runs)} runs`,
    })],
    ["sleep", sleepShip(stats)],
    ["tools", topList("YOUR TOP TOOLS", stats.topTools.map((t) => [t.key, `${fmtInt(t.count)} calls`]))],
    ["leverage", bigStat({
      kicker: ["FOR EVERY PROMPT YOU TYPED,", "THEY TOOK"],
      value: fmtInt(stats.actionsPerPrompt),
      unit: "ACTIONS",
      foot: `You: ${fmtInt(stats.humanPrompts)} prompts, ~${fmtInt(stats.wordsPerPrompt)} words each. Them: ${fmtInt(stats.toolCalls)} tool calls.`,
    })],
    ["receipts", receipts(stats)],
    ["persona", personaSlide(persona)],
    ["summary", summary(stats, persona, year, rank)],
  ];
  const footRight = rank ? rank.url.replace(/^https?:\/\//, "") : "runs 100% local";
  return bodies.map(([name, body], i) => ({ name: `${String(i + 1).padStart(2, "0")}-${name}`, svg: frame(body, i, bodies.length, year, footRight) }));
}

function frame(body, index, total, year, footRight) {
  const gap = 8;
  const segW = (SLIDE_W - 2 * M - gap * (total - 1)) / total;
  const bars = Array.from({ length: total }, (_, i) =>
    `<rect x="${M + i * (segW + gap)}" y="48" width="${segW}" height="6" rx="3" fill="${i <= index ? ORANGE : LINE}"/>`);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SLIDE_W}" height="${SLIDE_H}" viewBox="0 0 ${SLIDE_W} ${SLIDE_H}">`,
    `<defs><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#FFFFFF" opacity="0.035"/></pattern></defs>`,
    `<rect width="100%" height="100%" fill="${BG}"/>`,
    ...bars,
    text(M, 130, `§ ${String(index + 1).padStart(3, "0")} / AFK WRAPPED`, { size: 30, fill: ORANGE, weight: 700, spacing: 5 }),
    text(SLIDE_W - M, 130, String(year), { size: 30, fill: DIM, spacing: 5, anchor: "end" }),
    body,
    `<rect x="${M}" y="${SLIDE_H - 120}" width="${SLIDE_W - 2 * M}" height="2" fill="${LINE}"/>`,
    text(M, SLIDE_H - 66, "npx afk-wrapped", { size: 32, fill: ORANGE, weight: 700 }),
    text(SLIDE_W - M, SLIDE_H - 66, footRight, { size: 26, fill: DIM, anchor: "end" }),
    `<rect width="100%" height="100%" fill="url(#scan)"/>`,
    `</svg>`,
  ].join("\n");
}

function intro(year) {
  return [
    text(M, 760, "YOUR AGENTS", { size: 130, fill: ORANGE, weight: 700, spacing: -2 }),
    text(M, 900, "HAD A YEAR.", { size: 130, fill: ORANGE, weight: 700, spacing: -2 }),
    text(M, 1020, `Here is what they did in ${year}`, { size: 42, fill: INK }),
    text(M, 1080, "while you were gone.", { size: 42, fill: INK }),
  ].join("\n");
}

function bigStat({ kicker, value, unit, foot }) {
  const valueSize = value.length > 5 ? 230 : 340;
  return [
    ...kicker.map((line, i) => text(M, 640 + i * 72, line, { size: 54, fill: INK, weight: 700, spacing: 2 })),
    text(M - 8, 1060, value, { size: valueSize, fill: ORANGE, weight: 700, spacing: -10 }),
    text(M, 1170, unit, { size: 72, fill: INK, weight: 700, spacing: 4 }),
    ...wrap(foot, 44).map((line, i) => text(M, 1280 + i * 50, line, { size: 34, fill: DIM })),
  ].join("\n");
}

function sleepShip(stats) {
  const parts = [
    text(M, 560, "YOU SLEEP.", { size: 120, fill: ORANGE, weight: 700, spacing: -2 }),
    text(M, 690, "THEY SHIP.", { size: 120, fill: ORANGE, weight: 700, spacing: -2 }),
    hourChart(stats.hourAgent, stats.hourHuman, { x: M, y: 860, w: SLIDE_W - 2 * M, h: 460 }),
  ];
  const quiet = quietStretch(stats.hourHuman);
  if (quiet) parts.push(text(M, 1460, `You went quiet from ${clock(quiet.from)} to ${clock(quiet.to)}.`, { size: 40, fill: INK }));
  parts.push(text(M, 1520, quiet ? "They didn't." : `Their favorite hour: ${clock(stats.favoriteHour)}.`, { size: 40, fill: quiet ? ORANGE : INK, weight: 700 }));
  return parts.join("\n");
}

function topList(title, rows) {
  const parts = [text(M, 420, title, { size: 64, fill: ORANGE, weight: 700, spacing: 3 })];
  rows.forEach(([name, detail], i) => {
    const y = 620 + i * 210;
    parts.push(text(M, y, String(i + 1), { size: i === 0 ? 120 : 96, fill: i === 0 ? ORANGE : DIM, weight: 700 }));
    parts.push(text(M + 130, y - 30, name, { size: i === 0 ? 84 : 68, fill: INK, weight: 700 }));
    parts.push(text(M + 130, y + 24, detail, { size: 34, fill: DIM }));
  });
  return parts.join("\n");
}

function receipts(s) {
  const rows = [
    ["LONGEST RUN", s.longestRun ? fmtDuration(s.longestRun.minutes) : "-"],
    ["DAY STREAK", `${fmtInt(s.dayStreak)} days`],
    ["FILES TOUCHED", fmtInt(s.filesTouched)],
    ["OUTPUT TOKENS", fmtCompact(s.outTokens)],
    ["MOSTLY EDITED", s.topExt ? `${s.topExt.key} (${Math.round(s.topExt.share * 100)}%)` : "-"],
    ["YOU HIT STOP", `${fmtInt(s.interrupts)} times`],
    ["YOU SAID", s.topWord ? `"${censor(s.topWord.word)}" ×${fmtInt(s.topWord.count)}` : "please"],
    ["TOP MODEL", s.topModel ? `${prettyModel(s.topModel.key)} (${Math.round(s.topModelShare * 100)}%)` : "-"],
  ];
  const parts = [text(M, 420, "THE RECEIPTS", { size: 64, fill: ORANGE, weight: 700, spacing: 3 })];
  rows.forEach(([label, value], i) => {
    const y = 580 + i * 140;
    parts.push(text(M, y, label, { size: 30, fill: DIM, spacing: 4 }));
    parts.push(text(M, y + 62, value, { size: 60, fill: INK, weight: 700 }));
  });
  return parts.join("\n");
}

function personaSlide(persona) {
  const lines = wrap(persona.name, 13);
  const parts = [text(M, 560, "YOUR AGENT PERSONA IS", { size: 46, fill: INK, weight: 700, spacing: 3 })];
  lines.forEach((line, i) => parts.push(text(M - 4, 760 + i * 130, line, { size: 116, fill: ORANGE, weight: 700, spacing: -3 })));
  const y = 760 + lines.length * 130;
  parts.push(...wrap(persona.tagline, 38).map((line, i) => text(M, y + i * 60, line, { size: 46, fill: INK })));
  persona.traits.forEach((trait, i) => {
    const ty = y + 200 + i * 100;
    parts.push(`<rect x="${M}" y="${ty - 52}" width="${trait.length * 26 + 90}" height="76" fill="none" stroke="${ORANGE}" stroke-width="3"/>`);
    parts.push(text(M + 30, ty, `+ ${trait}`, { size: 38, fill: ORANGE, weight: 700, spacing: 2 }));
  });
  return parts.join("\n");
}

// The one to post: hero number, persona, two top-5 lists, four stats.
function summary(s, persona, year, rank) {
  const parts = [
    text(M, 330, `${fmtInt(s.awayHours)} H`, { size: 190, fill: ORANGE, weight: 700, spacing: -6 }),
    text(M, 400, "OF AGENT WORK WHILE I WAS AWAY", { size: 38, fill: INK, weight: 700, spacing: 2 }),
    text(M, 520, "PERSONA", { size: 28, fill: DIM, spacing: 4 }),
    text(M, 590, persona.name.replace(/^THE /, ""), { size: 64, fill: ORANGE, weight: 700 }),
  ];
  if (rank) parts.push(text(M, 650, rank.line, { size: 36, fill: INK, weight: 700, spacing: 2 }));
  const colX = [M, SLIDE_W / 2 + 10];
  const lists = [
    ["TOP TOOLS", s.topTools.map((t) => t.key)],
    ["TOP FILE TYPES", s.topExts.map((t) => t.key)],
  ];
  lists.forEach(([title, items], c) => {
    parts.push(text(colX[c], 730, title, { size: 28, fill: DIM, spacing: 4 }));
    items.forEach((item, i) => {
      parts.push(text(colX[c], 805 + i * 70, `${i + 1}`, { size: 44, fill: ORANGE, weight: 700 }));
      parts.push(text(colX[c] + 50, 805 + i * 70, clip(item, 14), { size: 44, fill: INK, weight: 700 }));
    });
  });
  const stats = [
    ["AGENT-HOURS", fmtInt(s.agentHoursParallel)],
    ["PEAK AGENTS", fmtInt(s.peakParallel)],
    ["ACTIONS / PROMPT", fmtInt(s.actionsPerPrompt)],
    ["LONGEST RUN", s.longestRun ? fmtDuration(s.longestRun.minutes) : "-"],
  ];
  stats.forEach(([label, value], i) => {
    const x = colX[i % 2];
    const y = 1270 + Math.floor(i / 2) * 150;
    parts.push(text(x, y, label, { size: 28, fill: DIM, spacing: 4 }));
    parts.push(text(x, y + 66, value, { size: 64, fill: INK, weight: 700 }));
  });
  parts.push(hourChart(s.hourAgent, s.hourHuman, { x: M, y: 1600, w: SLIDE_W - 2 * M, h: 180 }));
  parts.push(text(M, 1600 - 34 + 7, `${year} · YOU SLEEP. THEY SHIP.`, { size: 16, fill: ORANGE, weight: 700, spacing: 3 }));
  return parts.join("\n");
}

// Longest run of hours (wrapping past midnight) where you sent no prompts.
export function quietStretch(hourHuman) {
  if (hourHuman.every((h) => h === 0) || hourHuman.every((h) => h > 0)) return null;
  let best = null;
  for (let start = 0; start < 24; start++) {
    if (hourHuman[start] !== 0 || hourHuman[(start + 23) % 24] === 0) continue;
    let len = 0;
    while (len < 24 && hourHuman[(start + len) % 24] === 0) len++;
    if (!best || len > best.len) best = { from: start, to: (start + len) % 24, len };
  }
  return best && best.len >= 2 ? best : null;
}

export function prettyModel(id) {
  const parts = id.replace(/^claude-/, "").split("-").filter((p) => !/^\d{8}$/.test(p));
  const [family, ...version] = parts;
  return `${family[0].toUpperCase()}${family.slice(1)} ${version.join(".")}`.trim();
}

function clock(hour) {
  if (hour == null) return "-";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}

function pct(part, whole) {
  return `${whole ? Math.round((part / whole) * 100) : 0}%`;
}

function clip(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export function wrap(textValue, maxChars) {
  const lines = [];
  let line = "";
  for (const word of String(textValue).split(/\s+/)) {
    if (line && (line + " " + word).length > maxChars) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
