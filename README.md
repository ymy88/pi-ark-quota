# pi-ark-quota

[pi](https://github.com/earendil-works/pi-coding-agent) extension that shows your
[Volcano Ark Coding Plan](https://www.volcengine.com/activity/codingplan) quota
(5h / weekly / monthly) in the status bar.

```
⚡ 5h 32% · wk 45% · mo 60%
```

Percentages are color-graded (green < 70, yellow < 90, red ≥ 90) using the active
theme, and render in the footer's extension-status area (same mechanism as other
extension statuses, e.g. zentui's `extensionStatuses`).

## How it works

Shells out to the official [`arkcli`](https://github.com/volcengine/ark-cli)
(`arkcli usage plan --product coding-plan`), which returns the same real-time
quota snapshot as the Ark console (used percent + reset time per period).
Results are cached for 5 minutes; the status refreshes on session start and
after each settled agent run.

## Setup

```bash
# 1. install arkcli and log in once
npm i -g @volcengine/ark-cli
arkcli auth login volc-sso

# 2. install this extension
npm i -g pi-ark-quota
```

Then add `npm:pi-ark-quota` to the `packages` array in `~/.pi/agent/settings.json`
and restart pi (or `/reload`).

## Commands

- `/ark-quota` — force-refresh and show per-period usage with reset times.

## Configuration (env)

| Variable | Default | Description |
|---|---|---|
| `ARK_QUOTA_PRODUCT` | `coding-plan` | arkcli product id (`coding-plan`, `agent-plan`, …) |
| `ARK_QUOTA_TTL_MS` | `300000` | cache TTL in milliseconds |

## Status states

| Display | Meaning |
|---|---|
| `⚡ 5h 32% · wk 45% · mo 60%` | normal |
| `⚡ ark…` | fetching |
| `⚡ ark ✗` | arkcli missing / not logged in / query failed |
| `⚡ ark ⌀` | subscribed but no period data |

## License

MIT
