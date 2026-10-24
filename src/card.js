// Stats -> one 1080x1350 SVG card. Pure function, no I/O.

export const WIDTH = 1080;
export const HEIGHT = 1350;

export const ORANGE = "#FF8200";
export const INK = "#F2F2F2";
export const DIM = "#8A8A8A";
export const LINE = "#262626";
export const BG = "#0A0A0A";
const MONO = "JetBrains Mono, monospace";

const PROFANE = new Set(["fuck", "shit", "damn", "wtf"]);

export function renderSvg(stats, { year, showProjects = false, rank = null } = {}) {
  const parts = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`);
  parts.push(`<defs><pattern id="scan" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="1" fill="#FFFFFF" opacity="0.035"/></pattern></defs>`);
  parts.push(`<rect width="100%" height="100%" fill="${BG}"/>`);

  // Header
  parts.push(text(72, 110, "§ 001 / AFK WRAPPED", { size: 28, fill: ORANGE, spacing: 5, weight: 700 }));
  parts.push(text(WIDTH - 72, 110, String(year ?? ""), { size: 28, fill: DIM, spacing: 5, anchor: "end" }));
  parts.push(`<rect x="72" y="138" width="${WIDTH - 144}" height="2" fill="${LINE}"/>`);

  // Hero
  parts.push(text(66, 360, fmtInt(stats.awayHours), { size: 210, fill: ORANGE, weight: 700, spacing: -6 }));
  const share = stats.agentHours ? Math.round((stats.awayHours / stats.agentHours) * 100) : 0;
  parts.push(text(WIDTH - 72, 300, `OF ${fmtInt(stats.agentHours)} H`, { size: 30, fill: INK, weight: 700, spacing: 3, anchor: "end" }));
  parts.push(text(WIDTH - 72, 342, `${share}% HANDS-OFF`, { size: 22, fill: DIM, spacing: 3, anchor: "end" }));
  if (rank) parts.push(text(WIDTH - 72, 384, rank.line, { size: 22, fill: ORANGE, weight: 700, spacing: 2, anchor: "end" }));
  parts.push(text(72, 420, "HOURS YOUR AGENTS WORKED", { size: 34, fill: INK, weight: 700, spacing: 3 }));
  parts.push(text(72, 464, "WHILE YOU WERE AWAY", { size: 34, fill: INK, weight: 700, spacing: 3 }));
  parts.push(text(72, 512,
    `${fmtInt(stats.sleepHours)} h while you slept · ${fmtInt(stats.agentHoursParallel)} agent-hours · peak ${stats.peakParallel} at once`,
    { size: 22, fill: DIM }));

  // 24-hour chart: agents in orange, your prompts as white ticks
  parts.push(text(72, 598, "§ 002 / YOU SLEEP. THEY SHIP.", { size: 22, fill: ORANGE, spacing: 4, weight: 700 }));
  parts.push(hourChart(stats.hourAgent, stats.hourHuman, { x: 72, y: 625, w: WIDTH - 144, h: 190 }));

  // Stat grid
  parts.push(text(72, 905, "§ 003 / THE RECEIPTS", { size: 22, fill: ORANGE, spacing: 4, weight: 700 }));
  const cells = [
    ["TOOL CALLS", fmtInt(stats.toolCalls)],
    ["FILES TOUCHED", fmtInt(stats.filesTouched)],
    ["OUTPUT TOKENS", fmtCompact(stats.outTokens)],
    ["AGENT RUNS", fmtInt(stats.runs)],
    ["LONGEST RUN", stats.longestRun ? fmtDuration(stats.longestRun.minutes) : "-"],
    ["ACTIONS / PROMPT", stats.actionsPerPrompt ? stats.actionsPerPrompt.toFixed(1) : "-"],
  ];
  const colW = (WIDTH - 144) / 3;
  cells.forEach(([label, value], i) => {
    const x = 72 + (i % 3) * colW;
    const y = 975 + Math.floor(i / 3) * 120;
    parts.push(text(x, y, value, { size: 52, fill: INK, weight: 700 }));
    parts.push(text(x, y + 34, label, { size: 18, fill: DIM, spacing: 3 }));
  });

  // Lines
  const lines = [];
  if (stats.topTool) lines.push(["TOP TOOL", `${stats.topTool.key} ×${fmtInt(stats.topTool.count)}`]);
  if (stats.busiestDay) lines.push(["BUSIEST DAY", `${fmtDay(stats.busiestDay.day)} · ${fmtInt(stats.busiestDay.agentHours)} agent-hours`]);
  if (stats.topWord) lines.push(["YOU SAID", `"${censor(stats.topWord.word)}" ×${fmtInt(stats.topWord.count)}`]);
  if (showProjects && stats.longestRun?.cwd) lines.push(["LONGEST RUN IN", baseName(stats.longestRun.cwd)]);
  lines.slice(0, 3).forEach(([label, value], i) => {
    const y = 1200 + i * 36;
    parts.push(text(72, y, label, { size: 20, fill: DIM, spacing: 3 }));
    parts.push(text(330, y, value, { size: 22, fill: INK }));
  });

  // Footer
  parts.push(`<rect x="72" y="${HEIGHT - 66}" width="${WIDTH - 144}" height="2" fill="${LINE}"/>`);
  parts.push(text(72, HEIGHT - 30, "npx afk-wrapped", { size: 20, fill: ORANGE, weight: 700 }));
  parts.push(text(WIDTH - 72, HEIGHT - 30, "reads local logs · nothing leaves your machine", { size: 18, fill: DIM, anchor: "end" }));

  parts.push(`<rect width="100%" height="100%" fill="url(#scan)"/>`);
  parts.push(`</svg>`);
  return parts.join("\n");
}

export function hourChart(agent, human, { x, y, w, h }) {
  const out = [];
  const maxA = Math.max(1, ...agent);
  const maxH = Math.max(1, ...human);
  const slot = w / 24;
  const barW = slot * 0.62;
  const base = y + h - 30;
  const plotH = h - 50;
  out.push(`<rect x="${x}" y="${base}" width="${w}" height="1" fill="${LINE}"/>`);
  for (let i = 0; i < 24; i++) {
    const bx = x + i * slot + (slot - barW) / 2;
    const ah = Math.max(2, (agent[i] / maxA) * plotH);
    out.push(`<rect x="${r(bx)}" y="${r(base - ah)}" width="${r(barW)}" height="${r(ah)}" fill="${ORANGE}"/>`);
    if (human[i] > 0) {
      const hy = base - Math.max(4, (human[i] / maxH) * plotH);
      out.push(`<rect x="${r(bx - 2)}" y="${r(hy)}" width="${r(barW + 4)}" height="4" fill="${INK}"/>`);
    }
    if (i % 6 === 0) out.push(text(bx, base + 26, String(i).padStart(2, "0"), { size: 16, fill: DIM }));
  }
  const ly = y - 34; // legend sits on the section title line, clear of the bars
  out.push(`<rect x="${x + w - 290}" y="${ly - 6}" width="14" height="14" fill="${ORANGE}"/>`);
  out.push(text(x + w - 268, ly + 7, "agents", { size: 16, fill: DIM }));
  out.push(`<rect x="${x + w - 170}" y="${ly}" width="18" height="4" fill="${INK}"/>`);
  out.push(text(x + w - 144, ly + 7, "your prompts", { size: 16, fill: DIM }));
  return out.join("\n");
}

export function text(x, y, value, { size, fill, weight = 400, spacing = 0, anchor = "start" }) {
  return `<text x="${r(x)}" y="${r(y)}" font-family="${MONO}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}" fill="${fill}" text-anchor="${anchor}">${esc(value)}</text>`;
}

export function censor(word) {
  if (!PROFANE.has(word) || word.length < 3) return word;
  return word[0] + "*".repeat(word.length - 2) + word[word.length - 1];
}

export function fmtInt(n) {
  return Math.round(n || 0).toLocaleString("en-US");
}

export function fmtCompact(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
  return String(n || 0);
}

export function fmtDuration(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export function fmtDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function baseName(p) {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function r(n) {
  return Math.round(n * 10) / 10;
}
