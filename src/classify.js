// Turn one Claude Code transcript line into a small event, or null.
// Transcripts live in ~/.claude/projects/<project>/<session>.jsonl.

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);

export function classifyRecord(rec) {
  if (!rec || typeof rec !== "object" || !rec.timestamp) return null;
  const t = Date.parse(rec.timestamp);
  if (Number.isNaN(t)) return null;

  if (rec.type === "assistant") return agentEvent(rec, t);
  if (rec.type === "user") return promptEvent(rec, t);
  return null;
}

function agentEvent(rec, t) {
  const msg = rec.message || {};
  const tools = [];
  for (const block of Array.isArray(msg.content) ? msg.content : []) {
    if (block?.type !== "tool_use") continue;
    const input = block.input || {};
    const file = EDIT_TOOLS.has(block.name) ? input.file_path || input.notebook_path || null : null;
    tools.push({ name: block.name, file });
  }
  const model = msg.model && msg.model !== "<synthetic>" ? msg.model : null;
  return {
    kind: "agent",
    t,
    sessionId: rec.sessionId,
    cwd: rec.cwd || null,
    tools,
    outTokens: Number(msg.usage?.output_tokens) || 0,
    model,
  };
}

// A prompt a person typed, or one a scheduler sent (entrypoint sdk-cli).
// Tool results, meta lines, subagent briefs and <command> wrappers are not prompts.
function promptEvent(rec, t) {
  if (rec.isMeta || rec.isSidechain) return null;
  const content = rec.message?.content;
  let text;
  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    if (content.some((b) => b?.type === "tool_result")) return null;
    text = content.filter((b) => b?.type === "text").map((b) => b.text).join("\n");
  } else {
    return null;
  }
  text = text.trim();
  if (text.startsWith("[Request interrupted by user")) return { kind: "interrupt", t, sessionId: rec.sessionId };
  if (!text || text.startsWith("<")) return null;
  return {
    kind: promptKind(rec),
    t,
    sessionId: rec.sessionId,
    cwd: rec.cwd || null,
    text,
  };
}

// Claude Code 2.1.20+ stamps a prompt a person typed with origin.kind "human".
// From then on, a prompt without it came from a scheduler or another session.
const ORIGIN_SINCE = [2, 1, 20];

function promptKind(rec) {
  if (rec.entrypoint === "sdk-cli") return "auto";
  if (rec.origin?.kind) return rec.origin.kind === "human" ? "human" : "auto";
  return versionAtLeast(rec.version, ORIGIN_SINCE) ? "auto" : "human";
}

function versionAtLeast(version, min) {
  const parts = String(version || "").split(".").map((p) => parseInt(p, 10));
  if (parts.some(Number.isNaN)) return false;
  for (let i = 0; i < min.length; i++) {
    const v = parts[i] || 0;
    if (v !== min[i]) return v > min[i];
  }
  return true;
}
