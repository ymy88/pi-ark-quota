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
# 1. install arkcli (CI=1 suppresses its postinstall skill injection,
#    which would otherwise dump 25 arkcli-* skills into every agent's
#    context; the binary still installs and works the same)
CI=1 npm i -g @volcengine/ark-cli
arkcli auth login volc-sso

# 2. install this extension into pi
pi install npm:pi-ark-quota
```

Then restart pi (or `/reload`). Update later with `pi update npm:pi-ark-quota`.
Equivalent to adding `"npm:pi-ark-quota"` to the `packages` array in
`~/.pi/agent/settings.json`.

Or skip step 1: if arkcli is missing, the extension shows a hint and
`/ark-quota install` installs it for you (login still has to be done by you:
`arkcli auth login volc-sso`).

Then add `npm:pi-ark-quota` to the `packages` array in `~/.pi/agent/settings.json`
and restart pi (or `/reload`).

The status only appears when the active model's provider resolves to a base URL
that **exactly equals** one of the two official Coding Plan endpoints:

- `https://ark.cn-beijing.volces.com/api/coding/v3` (OpenAI-compatible)
- `https://ark.cn-beijing.volces.com/api/coding` (Anthropic-compatible)

Pay-per-use Ark (`/api/v3`), same-path-different-host proxies, and every other
provider stay hidden. Provider names are never used for the decision.

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
| `⚡ arkcli missing` | arkcli not on PATH - run `/ark-quota install` |
| `⚡ ark ✗` | not logged in / query failed - try `arkcli auth login volc-sso` |
| `⚡ ark ⌀` | subscribed but no period data |

## License

MIT
