// Pick an agent persona from the stats, Spotify-personality style.
// The first rule that matches is the persona; other matches become traits.

const PERSONAS = [
  {
    name: "THE NIGHT SHIFT MANAGER",
    tagline: () => "You go to bed. They clock in.",
    when: (s) => share(s.sleepHours, s.agentHours) >= 0.15 && share(s.awayHours, s.agentHours) >= 0.5,
  },
  {
    name: "THE SWARM LORD",
    tagline: (s) => `One agent is a tool. ${s.peakParallel} at once is a workforce.`,
    when: (s) => s.peakParallel >= 20,
  },
  {
    name: "THE ABSENTEE LANDLORD",
    tagline: () => "You set the rules and left the building.",
    when: (s) => share(s.awayHours, s.agentHours) >= 0.6,
  },
  {
    name: "THE BASH GOBLIN",
    tagline: () => "If it can't run in a terminal, it can't run.",
    when: (s) => s.topTool?.key === "Bash" && s.toolShare >= 0.5,
  },
  {
    name: "THE MICROMANAGER",
    tagline: () => "You check in. A lot.",
    when: (s) => s.humanPrompts >= 20 && s.actionsPerPrompt < 8,
  },
];

const FALLBACK = { name: "THE PAIR PROGRAMMER", tagline: () => "Side by side, prompt by prompt." };

export function pickPersona(stats) {
  const matches = PERSONAS.filter((p) => p.when(stats));
  const main = matches[0] || FALLBACK;
  return {
    name: main.name,
    tagline: main.tagline(stats),
    traits: matches.slice(1, 4).map((p) => p.name.replace(/^THE /, "")),
  };
}

function share(part, whole) {
  return whole ? part / whole : 0;
}
