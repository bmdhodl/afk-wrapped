// Fold events into Wrapped stats. Memory stays bounded by minutes, not lines.

const MINUTE = 60_000;
// Agent work counts as "while you were away" when you sent no prompt
// in the 30 minutes before it.
export const AWAY_GAP_MINUTES = 30;
export const SLEEP_HOURS = [0, 1, 2, 3, 4, 5, 6, 7];

const SPICY = ["fuck", "shit", "damn", "wtf", "bro", "bruh", "lol", "lmao"];
const POLITE = ["please", "thanks"];
const WORDS = [...SPICY, ...POLITE];

export class Tally {
  constructor({ from = -Infinity, to = Infinity } = {}) {
    this.from = from;
    this.to = to;
    this.agentMinutes = new Map(); // minute -> number of agent runs active in it
    this.parallelMinutes = 0;
    this.humanTimes = [];
    this.autoPrompts = 0;
    this.runs = []; // one per transcript file with agent work
    this.tools = new Map();
    this.files = new Set();
    this.models = new Map();
    this.words = new Map();
    this.outTokens = 0;
    this.interrupts = 0;
    this.promptWords = 0;
    this.editsByExt = new Map();
    this.current = null;
  }

  beginRun(label) {
    this.current = { label, minutes: new Set(), start: Infinity, end: -Infinity, cwd: null };
  }

  endRun() {
    const run = this.current;
    this.current = null;
    if (!run || run.minutes.size === 0) return;
    for (const m of run.minutes) this.agentMinutes.set(m, (this.agentMinutes.get(m) || 0) + 1);
    this.parallelMinutes += run.minutes.size;
    this.runs.push({ label: run.label, cwd: run.cwd, ...longestStretch(run.minutes) });
  }

  add(event) {
    if (!event || event.t < this.from || event.t >= this.to) return;
    if (event.kind === "human") return this.addHuman(event);
    if (event.kind === "auto") return void this.autoPrompts++;
    if (event.kind === "interrupt") return void this.interrupts++;
    if (event.kind === "agent") this.addAgent(event);
  }

  addHuman(event) {
    this.humanTimes.push(event.t);
    this.promptWords += (event.text.match(/\S+/g) || []).length;
    for (const word of event.text.toLowerCase().match(/[a-z]+/g) || []) {
      const root = WORDS.find((w) => word === w || (w === "fuck" && word.startsWith("fuck")));
      if (root) this.words.set(root, (this.words.get(root) || 0) + 1);
    }
  }

  addAgent(event) {
    if (!this.current) this.beginRun(event.sessionId);
    const run = this.current;
    run.minutes.add(Math.floor(event.t / MINUTE));
    run.start = Math.min(run.start, event.t);
    run.end = Math.max(run.end, event.t);
    run.cwd = run.cwd || event.cwd;
    this.outTokens += event.outTokens;
    if (event.model) this.models.set(event.model, (this.models.get(event.model) || 0) + 1);
    for (const tool of event.tools) {
      this.tools.set(tool.name, (this.tools.get(tool.name) || 0) + 1);
      if (tool.file) {
        this.files.add(tool.file);
        const ext = extOf(tool.file);
        this.editsByExt.set(ext, (this.editsByExt.get(ext) || 0) + 1);
      }
    }
  }

  finish() {
    if (this.current) this.endRun();
    const minutes = [...this.agentMinutes.keys()].sort((a, b) => a - b);
    const humanMinutes = this.humanTimes.map((t) => Math.floor(t / MINUTE)).sort((a, b) => a - b);

    let awayMinutes = 0;
    let sleepMinutes = 0;
    let peakParallel = 0;
    const hourAgent = new Array(24).fill(0);
    const monthAgent = new Array(12).fill(0);
    const days = new Map();
    let h = -1; // index of the last human minute at or before m
    for (const m of minutes) {
      while (h + 1 < humanMinutes.length && humanMinutes[h + 1] <= m) h++;
      if (h < 0 || m - humanMinutes[h] > AWAY_GAP_MINUTES) awayMinutes++;
      const date = new Date(m * MINUTE);
      const hour = date.getHours();
      hourAgent[hour]++;
      monthAgent[date.getMonth()]++;
      if (SLEEP_HOURS.includes(hour)) sleepMinutes++;
      peakParallel = Math.max(peakParallel, this.agentMinutes.get(m));
      const day = localDay(date);
      days.set(day, (days.get(day) || 0) + this.agentMinutes.get(m));
    }

    const hourHuman = new Array(24).fill(0);
    for (const t of this.humanTimes) hourHuman[new Date(t).getHours()]++;

    const toolCalls = sum(this.tools.values());
    const longest = this.runs.reduce((best, r) => (!best || r.minutes > best.minutes ? r : best), null);
    const busiest = top(days);
    const topWord = topOf(this.words, SPICY) || topOf(this.words, POLITE);

    return {
      agentHours: minutes.length / 60,
      awayHours: awayMinutes / 60,
      sleepHours: sleepMinutes / 60,
      agentHoursParallel: this.parallelMinutes / 60,
      peakParallel,
      runs: this.runs.length,
      projects: new Set(this.runs.map((r) => r.cwd).filter(Boolean)).size,
      humanPrompts: this.humanTimes.length,
      autoPrompts: this.autoPrompts,
      toolCalls,
      actionsPerPrompt: this.humanTimes.length ? toolCalls / this.humanTimes.length : 0,
      topTool: top(this.tools),
      topTools: [...this.tools].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, count]) => ({ key, count })),
      topExts: [...this.editsByExt].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, count]) => ({ key, count })),
      filesTouched: this.files.size,
      outTokens: this.outTokens,
      topModel: top(this.models),
      longestRun: longest && { minutes: longest.minutes, cwd: longest.cwd, start: longest.start },
      busiestDay: busiest && { day: busiest.key, agentHours: busiest.count / 60 },
      topWord,
      activeDays: days.size,
      dayStreak: longestDayStreak([...days.keys()]),
      favoriteHour: minutes.length ? hourAgent.indexOf(Math.max(...hourAgent)) : null,
      interrupts: this.interrupts,
      wordsPerPrompt: this.humanTimes.length ? this.promptWords / this.humanTimes.length : 0,
      topModelShare: this.models.size ? top(this.models).count / sum(this.models.values()) : 0,
      topExt: topShare(this.editsByExt),
      toolShare: toolCalls ? top(this.tools).count / toolCalls : 0,
      hourAgent,
      hourHuman,
      monthAgent: monthAgent.map((m) => m / 60),
    };
  }
}

function extOf(file) {
  const name = String(file).split(/[\\/]/).pop();
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : name;
}

function topShare(map) {
  const best = top(map);
  return best && { key: best.key, share: best.count / sum(map.values()) };
}

function longestDayStreak(dayKeys) {
  const days = dayKeys.map((k) => {
    const [y, m, d] = k.split("-").map(Number);
    return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
  }).sort((a, b) => a - b);
  let best = days.length ? 1 : 0;
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    streak = days[i] === days[i - 1] + 1 ? streak + 1 : 1;
    best = Math.max(best, streak);
  }
  return best;
}

// A session can be resumed days later. A "run" is the longest stretch
// with no quiet gap longer than STRETCH_GAP_MINUTES.
const STRETCH_GAP_MINUTES = 10;

function longestStretch(minuteSet) {
  const minutes = [...minuteSet].sort((a, b) => a - b);
  let best = { minutes: 1, start: minutes[0] * MINUTE };
  let first = minutes[0];
  for (let i = 1; i <= minutes.length; i++) {
    if (i < minutes.length && minutes[i] - minutes[i - 1] <= STRETCH_GAP_MINUTES) continue;
    const length = minutes[i - 1] - first + 1;
    if (length > best.minutes) best = { minutes: length, start: first * MINUTE };
    first = minutes[i];
  }
  return best;
}

function sum(values) {
  let total = 0;
  for (const v of values) total += v;
  return total;
}

function top(map) {
  let best = null;
  for (const [key, count] of map) if (!best || count > best.count) best = { key, count };
  return best;
}

function topOf(map, keys) {
  const best = top(new Map([...map].filter(([k]) => keys.includes(k))));
  return best && { word: best.key, count: best.count };
}

function localDay(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
