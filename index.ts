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
 *   ARK_QUOTA_PRODUCT    default "coding-plan"
 *   ARK_QUOTA_TTL_MS     cache TTL, default 300000 (5 min)
 *   ARK_QUOTA_URLS       comma-separated exact Coding Plan base URLs,
 *                        default both official endpoints:
 *                        https://ark.cn-beijing.volces.com/api/coding/v3 (OpenAI)
 *                        https://ark.cn-beijing.volces.com/api/coding (Anthropic)
 *
 * Status bar: ⚡ 5h 32% · wk 45% · mo 60%   (green <70, yellow <90, red ≥90)
 * Degraded states render dim: "⚡ arkcli missing" (run /ark-quota install),
 * "⚡ ark ✗" (not logged in / query failed). See setup guide in notify.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

const PRODUCT = process.env.ARK_QUOTA_PRODUCT || "coding-plan";
const TTL_MS = Number(process.env.ARK_QUOTA_TTL_MS) || 5 * 60 * 1000;
const URLS = (
	process.env.ARK_QUOTA_URLS ||
	"https://ark.cn-beijing.volces.com/api/coding/v3,https://ark.cn-beijing.volces.com/api/coding"
)
	.split(",")
	.map((s) => s.trim().toLowerCase().replace(/\/+$/, ""))
	.filter(Boolean);
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
	const lines = periods.map((p) => {
		const name = shortLabel(p.label);
		const pct = typeof p.percent === "number" ? Math.round(p.percent) : null;
		const base = pct !== null ? `${name}: ${pct}% used` : `${name}: no data`;
		if (p.reset_at) return `${base}, resets ${p.reset_at}`;
		return base;
	});
	return lines.length ? lines.join("\n") : "No quota data (not subscribed or no periods)";
}

/** Classify a fetchQuota failure: "missing" (arkcli not installed) or "error". */
export function classifyFailure(err: unknown): "missing" | "error" {
	return (err as { code?: string })?.code === "ENOENT" ? "missing" : "error";
}

/** Does this base URL exactly equal a known Coding Plan endpoint? */
export function isCodingBaseUrl(url: string | undefined, urls: string[] = URLS): boolean {
	if (!url) return false;
	const u = url.trim().toLowerCase().replace(/\/+$/, "");
	return urls.includes(u);
}

// ---- extension ----

export default function arkQuotaExtension(pi: ExtensionAPI) {
	let lastCtx: any = null;
	let fetchedAt = 0;
	let inFlight = false;
	let lastPeriods: Period[] | null = null;
	let lastFailure: "missing" | "error" | null = null;
	let notifiedSetup = false;
	let arkActive = false;

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
			lastFailure = null;
			return lastPeriods;
		} catch (err) {
			lastFailure = classifyFailure(err);
			return null; // keep old state
		} finally {
			inFlight = false;
		}
	}

	function bindFg(ctx: any): ((role: string, t: string) => string) | null {
		try {
			return ctx?.ui?.theme?.fg?.bind(ctx.ui.theme) ?? null;
		} catch {
			return null; // theme proxy not ready (pi-web before initTheme)
		}
	}

	function clearStatus() {
		try {
			lastCtx?.ui?.setStatus?.("ark-quota", undefined);
		} catch {
			/* already gone */
		}
	}

	async function sync(setStatus: (s: string | undefined) => void, fg: (role: string, t: string) => string, notify?: (msg: string, level?: string) => void) {
		const periods = await fetchQuota();
		if (periods === null) {
			if (!lastPeriods) {
				if (lastFailure === "missing") {
					setStatus(fg("dim", "⚡ arkcli missing"));
					if (!notifiedSetup) {
						notify?.("pi-ark-quota: arkcli is required. Run /ark-quota install, or manually: npm i -g @volcengine/ark-cli", "warning");
						notifiedSetup = true;
					}
				} else {
					setStatus(fg("dim", "⚡ ark ✗"));
				}
			}
			return;
		}
		const styled = renderQuota(fg, periods);
		setStatus(styled ?? fg("dim", "⚡ ark ⌀")); // subscribed but empty -> dim
	}

	// Refresh visibility whenever the active model/provider changes.
	// Pure URL judgment: show only when the resolved base URL exactly equals
	// a known Coding Plan endpoint. Provider names are arbitrary - never used.
	function applyProvider(ctx: any) {
		let baseUrl: string | undefined;
		try {
			const auth = ctx?.modelRegistry?.getProviderAuth?.(ctx?.model?.provider);
			baseUrl = auth?.baseUrl ?? auth?.baseURL;
		} catch {
			baseUrl = undefined;
		}
		arkActive = isCodingBaseUrl(baseUrl);
		if (!arkActive) clearStatus();
		return arkActive;
	}

	pi.on("session_start", async (_event, ctx) => {
		lastCtx = ctx;
		if (!ctx?.ui?.setStatus) return;
		if (!applyProvider(ctx)) return; // not on an Ark provider - stay hidden
		const fg = bindFg(ctx);
		if (!fg) return;
		ctx.ui.setStatus("ark-quota", fg("dim", "⚡ ark…"));
		await sync((s) => ctx.ui.setStatus("ark-quota", s), fg, ctx.ui.notify?.bind(ctx.ui));
	});

	pi.on("model_select", async (_event, ctx) => {
		lastCtx = ctx;
		if (!ctx?.ui?.setStatus) return;
		if (!applyProvider(ctx)) return;
		const fg = bindFg(ctx);
		if (!fg) return;
		ctx.ui.setStatus("ark-quota", fg("dim", "⚡ ark…"));
		await sync((s) => ctx.ui.setStatus("ark-quota", s), fg);
	});

	pi.on("agent_settled", async () => {
		if (!arkActive) return;
		const ctx = lastCtx;
		if (!ctx?.ui?.setStatus) return;
		const fg = bindFg(ctx);
		if (!fg) return;
		// stale cache only - no spinner churn mid-session
		if (Date.now() - fetchedAt < TTL_MS && lastPeriods) return;
		await sync((s) => ctx.ui.setStatus("ark-quota", s), fg);
	});

	pi.registerCommand("ark-quota", {
		description: "Ark Coding Plan quota; `install` subcommand installs arkcli",
		handler: async (args, ctx) => {
			// /ark-quota install - user-invoked global install of arkcli
			if (String(args || "").trim() === "install") {
				try {
					ctx?.ui?.notify?.("ark-quota: installing @volcengine/ark-cli ...", "info");
					await execFileP("npm", ["i", "-g", "@volcengine/ark-cli"], { timeout: 120_000 });
					ctx?.ui?.notify?.(
						"ark-quota: installed. Run `arkcli auth login volc-sso` to log in, then /ark-quota to refresh.",
					"success",
				);
				} catch (e) {
					ctx?.ui?.notify?.(
						`ark-quota: install failed (${(e as Error).message}). Run manually: npm i -g @volcengine/ark-cli`,
					"error",
				);
				}
				return;
			}

			fetchedAt = 0; // force
			if (!arkActive && lastCtx) applyProvider(lastCtx); // manual refresh works regardless
			const periods = await fetchQuota();
			if (periods === null) {
				const hint =
					lastFailure === "missing"
						? "ark-quota: arkcli is not installed. Run /ark-quota install."
						: "ark-quota: query failed. If not logged in, run: arkcli auth login volc-sso";
				ctx?.ui?.notify?.(hint, "error");
				return;
			}
			const fg = bindFg(ctx);
			if (fg && ctx?.ui?.setStatus) {
				const styled = renderQuota(fg, periods);
				ctx.ui.setStatus("ark-quota", styled ?? fg("dim", "⚡ ark ⌀"));
			}
			ctx?.ui?.notify?.(formatDetails(periods), "info");
		},
	});
}
