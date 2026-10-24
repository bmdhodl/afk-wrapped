# afk-wrapped

A Spotify-Wrapped-style card for the work your AI coding agents did while you were away.

```bash
npx afk-wrapped
```

It reads your local Claude Code transcripts (`~/.claude/projects`) and writes one PNG card:

- hours your agents worked while you were away (no prompt from you in the 30 minutes before)
- hours they worked while you slept (00:00 to 08:00 local time)
- a 24-hour chart: agent work against your prompts
- tool calls, files touched, output tokens, agent runs, longest unbroken run
- agent actions per prompt you typed
- top tool, busiest day, and the word you said most

**Nothing leaves your machine** unless you add `--rank`. The card shows totals only: no code, no prompts, no project names (unless you pass `--show-projects`).

## Is it safe to run?

Read the code before you run it: https://github.com/bmdhodl/afk-wrapped (the same files ship on npm: https://www.npmjs.com/package/afk-wrapped?activeTab=code).

- It reads only `~/.claude/projects` (or the folder you pass to `--logs`) and never changes those files.
- It writes the PNGs to one output folder. With `--rank` it also keeps a random key in `~/.afk-wrapped/device-key`.
- It makes no network calls unless you add `--rank`. The one network call is in `src/rank-client.js`, and the CLI prints what it sends first.
- No account, no API key, no telemetry, no install scripts. One dependency: `@resvg/resvg-js`, which draws the PNGs.
- About a thousand lines of plain JavaScript.

## The board (opt-in)

```bash
npx afk-wrapped --rank --handle yourname
```

`--rank` sends totals only to the board at https://bmdpat.com/wrapped: hours, counts, your top 5 tool names (MCP tools show as `MCP`) and file types, the 24-hour activity shape, and an optional handle. Never code, prompts, paths or project names. The CLI prints exactly what it sends. You get a rank ("TOP 3% · #12 OF 340") on your summary slide and a share link that unfurls your card on X, LinkedIn and Slack. The CLI also prints a `post on X:` link with the post written for you. A private key in `~/.afk-wrapped/device-key` makes re-runs update your entry instead of adding a new one.

Numbers are self-reported, so the board is for fun, not proof.

The board, the share pages and the card images run on bmdpat.com. `AFK_WRAPPED_API` points `--rank` at another server.

## Options

```
--year <yyyy>      year to wrap (default: this year)
--logs <dir>       Claude Code projects folder (default: ~/.claude/projects)
--out <dir>        folder for the 9 story slides and the card (default: afk-wrapped-<year>)
--svg              also write the SVG
--json             print the stats as JSON
--show-projects    put the longest run's folder name on the card
--rank             opt in to the public board
--handle <name>    your name on the board
```

## How it counts

- A prompt counts as yours only when Claude Code marks it as typed by a person (`origin.kind: "human"`, Claude Code 2.1.20+). Scheduled runs and briefs from other sessions do not count as you.
- Agent time is counted in active minutes. Parallel agents stack into agent-hours; the headline hours are wall-clock.
- Claude Code deletes old transcripts after a set number of days (`cleanupPeriodDays`), so a year may hold fewer days than you worked.

Not affiliated with Anthropic. Works with Claude Code logs.

## License

MIT
