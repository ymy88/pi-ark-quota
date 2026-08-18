/**
 * pi-ark-quota - Show Volcano Ark Coding Plan quota in the pi status bar.
 *
 * Shells out to the official `arkcli` (npm: @volcengine/ark-cli) and reads
 * `arkcli usage plan --product coding-plan`, which returns a real-time quota
 * snapshot identical to the Ark console (5h/session, weekly, monthly percent
 * + reset times). Results are cached; the status refreshes on session_start,
 * after each settled agent run, and via /ark-quota.
 *
 * Setup:
 *   npm i -g @volcengine/ark-cli
 *   arkcli auth login volc-sso        # once per machine
 *
 * Config (env):
 *   ARK_QUOTA_PRODUCT   default "coding-plan"
 *   ARK_QUOTA_TTL_MS    cache TTL, default 300000 (5 min)
 *
 * Status bar: ⚡ 5h 32% · wk 45% · mo 60%   (green <70, yellow <90, red ≥90)
 * Degraded states render dim: "⚡ ark ✗" (arkcli missing / not logged in / error).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const PRODUCT = process.env.ARK_QUOTA_PRODUCT || "coding-plan";
const TTL_MS = Number(process.env.ARK_QUOTA_TTL_MS) || 5 * 60 * 1000;
const TIMEOUT_MS = 15_000;

// ---- pure helpers (exported for tests) ----

export type Period = { label: string; percent?: number; reset_at?: string };

/** Pick the display label for a raw period label. */
export function shortLabel(label: string): string {
	switch (label) {
		case "session":
		case "5h":
			return "5h";
		case "weekly":
			return "wk";
		case "monthly":
			return "mo";
		default:
			return label;
	}
}

/** Threshold color role for a used-percent. */
export function colorRole(percent: number): "success" | "warning" | "error" {
	if (percent >= 90) return "error";
	if (percent >= 70) return "warning";
	return "success";
}

/** Find the subscribed quota periods in an `arkcli usage plan` JSON payload. */
export function extractPeriods(json: any, product = PRODUCT): Period[] {
	for (const item of json?.items ?? []) {
		if (item?.product === product && item?.subscribed) return item.periods ?? [];
	}
	return [];
}

/** Render the status line; `fg(role, text)` colors each percent (pass identity for plain text). */
export function renderQuota(
	fg: (role: string, text: string) => string,
	periods: Period[],
): string | undefined {
	const parts = periods
		.filter((p) => typeof p.percent === "number")
		.map((p) => {
			const pct = Math.round(p.percent!);
			return `${shortLabel(p.label)} ${fg(colorRole(pct), `${pct}%`)}`;
		});
	return parts.length ? `⚡ ${parts.join(" · ")}` : undefined;
}

/** Human detail lines for /ark-quota, including reset times. */
export function formatDetails(periods: Period[]): string {
	const cn: Record<string, string> = { "5h": "5小时窗口", wk: "本周", mo: "本月" };
	const lines = periods.map((p) => {
		const name = cn[shortLabel(p.label)] ?? p.label;
		const pct = typeof p.percent === "number" ? Math.round(p.percent) : null;
		const base = pct !== null ? `${name}: 已用 ${pct}%` : `${name}: 无数据`;
		if (p.reset_at) return `${base}，重置 ${p.reset_at}`;
		return base;
	});
	return lines.length ? lines.join("\n") : "无套餐用量数据（未订阅或无周期数据）";
}

// ---- extension ----

export default function arkQuotaExtension(pi: ExtensionAPI) {
	let lastCtx: any = null;
	let fetchedAt = 0;
	let inFlight = false;
	let lastPeriods: Period[] | null = null;

	async function fetchQuota(): Promise<Period[] | null> {
		if (inFlight) return null;
		if (Date.now() - fetchedAt < TTL_MS && lastPeriods) return lastPeriods;
		inFlight = true;
		try {
			const { stdout } = await execFileP(
				"arkcli",
				["usage", "plan", "--product", PRODUCT],
				{ timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
			);
			const start = stdout.indexOf("{");
			const json = JSON.parse(start >= 0 ? stdout.slice(start) : stdout);
			lastPeriods = extractPeriods(json, PRODUCT);
			fetchedAt = Date.now();
			return lastPeriods;
		} catch {
			return null; // arkcli missing / not logged in / network - keep old state
		} finally {
			inFlight = false;
		}
	}

	async function sync(setStatus: (s: string | undefined) => void, fg: (role: string, t: string) => string) {
		const periods = await fetchQuota();
		if (periods === null) {
			if (!lastPeriods) setStatus(fg("dim", "⚡ ark ✗")); // never had data
			return;
		}
		const styled = renderQuota(fg, periods);
		setStatus(styled ?? fg("dim", "⚡ ark ⌀")); // subscribed but empty -> dim
	}

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		if (!ctx?.ui?.setStatus) return;
		let fg: (role: string, t: string) => string;
		try {
			fg = ctx.ui.theme.fg.bind(ctx.ui.theme);
		} catch {
			return; // theme proxy not ready (pi-web before initTheme)
		}
		ctx.ui.setStatus("ark-quota", fg("dim", "⚡ ark…"));
		await sync((s) => ctx.ui.setStatus("ark-quota", s), fg);
	});

	pi.on("agent_settled", async () => {
		const ctx = lastCtx;
		if (!ctx?.ui?.setStatus) return;
		let fg: (role: string, t: string) => string;
		try {
			fg = ctx.ui.theme.fg.bind(ctx.ui.theme);
		} catch {
			return;
		}
		// stale cache only - no spinner churn mid-session
		if (Date.now() - fetchedAt < TTL_MS && lastPeriods) return;
		await sync((s) => ctx.ui.setStatus("ark-quota", s), fg);
	});

	pi.registerCommand("ark-quota", {
		description: "Refresh Volcano Ark Coding Plan quota (forces cache bypass)",
		handler: async (_args, ctx) => {
			fetchedAt = 0; // force
			const periods = await fetchQuota();
			if (periods === null) {
				ctx?.ui?.notify?.(
					"ark-quota: 查询失败。检查 arkcli 已安装并已 `arkcli auth login volc-sso`。",
					"error",
				);
				return;
			}
			const fg = (() => {
				try {
					return ctx?.ui?.theme?.fg?.bind(ctx.ui.theme);
				} catch {
					return undefined;
				}
			})();
			if (fg && ctx?.ui?.setStatus) {
				const styled = renderQuota(fg, periods);
				ctx.ui.setStatus("ark-quota", styled ?? fg("dim", "⚡ ark ⌀"));
			}
			ctx?.ui?.notify?.(formatDetails(periods), "info");
		},
	});
}
