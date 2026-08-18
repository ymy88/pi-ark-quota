import assert from "node:assert/strict";
import { classifyFailure, colorRole, extractPeriods, formatDetails, renderQuota, shortLabel } from "../index.ts";

const plain = (periods: Parameters<typeof renderQuota>[1]) => renderQuota((_r, t) => t, periods) ?? "";

// shortLabel
assert.equal(shortLabel("session"), "5h");
assert.equal(shortLabel("5h"), "5h");
assert.equal(shortLabel("weekly"), "wk");
assert.equal(shortLabel("monthly"), "mo");
assert.equal(shortLabel("daily"), "daily");

// colorRole thresholds
assert.equal(colorRole(0), "success");
assert.equal(colorRole(69), "success");
assert.equal(colorRole(70), "warning");
assert.equal(colorRole(89), "warning");
assert.equal(colorRole(90), "error");
assert.equal(colorRole(100), "error");

// extractPeriods - picks subscribed coding-plan bucket only
const payload = {
	viewer: { auth_method: "sso" },
	items: [
		{ product: "agent-plan", subscribed: true, periods: [{ label: "5h", percent: 10 }] },
		{ product: "coding-plan", subscribed: false, periods: [] },
		{
			product: "coding-plan",
			subscribed: true,
			periods: [
				{ label: "session", percent: 32, reset_at: "2026-08-18T20:00:00+08:00" },
				{ label: "weekly", percent: 45 },
				{ label: "monthly", percent: 60 },
			],
		},
	],
};
const periods = extractPeriods(payload, "coding-plan");
assert.equal(periods.length, 3);
assert.deepEqual(extractPeriods({ items: [] }), []);
assert.deepEqual(extractPeriods({}), []);

// renderQuota (plain = identity fg)
assert.equal(plain(periods), "⚡ 5h 32% · wk 45% · mo 60%");
assert.equal(plain([]), "");
assert.equal(plain([{ label: "weekly" }]), ""); // no percent -> dropped
const fg = (role: string, t: string) => `<${role}>${t}</>`;
assert.equal(renderQuota(fg, periods), "⚡ 5h <success>32%</> · wk <success>45%</> · mo <success>60%</>");
assert.equal(renderQuota(fg, [{ label: "monthly", percent: 95 }]), "⚡ mo <error>95%</>");
// real API returns floats - round for display
assert.equal(plain([{ label: "session", percent: 33.176379499999996 }]), "⚡ 5h 33%");
assert.ok(formatDetails([{ label: "weekly", percent: 9.19821 }]).includes("本周: 已用 9%"));

// formatDetails
const details = formatDetails(periods);
assert.ok(details.includes("5小时窗口: 已用 32%"));
assert.ok(details.includes("重置 2026-08-18T20:00:00+08:00"));
assert.ok(details.includes("本周: 已用 45%") && !details.includes("本周: 已用 45%，重置"));
assert.ok(formatDetails([]).includes("无套餐用量数据"));

// classifyFailure - ENOENT means arkcli is not on PATH
assert.equal(classifyFailure(Object.assign(new Error("spawn arkcli ENOENT"), { code: "ENOENT" })), "missing");
assert.equal(classifyFailure(new Error("boom")), "error");
assert.equal(classifyFailure(null), "error");

console.log("all assertions passed");
