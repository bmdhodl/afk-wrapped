// The post a ranked user shares on X. Keep the words in step with
// src/lib/wrapped/share.ts on bmdpat.com, so the CLI and the share page post
// the same thing. The share link unfurls as the card, so no image is attached.

import { fmtInt } from "./card.js";

export const X_INTENT = "https://x.com/intent/tweet";

export function shareText({ awayHours, persona, rankLine }) {
  return [
    `My AI agents worked ${fmtInt(awayHours)} hours this year while I was away.`,
    `I'm ${persona}, ${rankLine} on AFK Wrapped.`,
    "How many did yours? npx afk-wrapped",
  ].join("\n");
}

export function xIntentUrl(text, url) {
  return `${X_INTENT}?${new URLSearchParams({ text, url })}`;
}
