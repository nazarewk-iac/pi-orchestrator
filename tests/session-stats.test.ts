import { test } from "node:test";
import assert from "node:assert/strict";
import { createSessionStats } from "../src/session-stats.ts";

test("session stats: accumulates per agent and totals, flags failures", () => {
	const stats = createSessionStats();
	stats.record("scout", { input: 1000, output: 100, contextTokens: 5000, turns: 2 }, false);
	stats.record("scout", { input: 3000, output: 300, contextTokens: 9000, turns: 3 }, true, "boom");
	const snap = stats.snapshot();
	assert.deepEqual(snap.perAgent.scout, {
		runs: 2, failed: 1, input: 4000, output: 400, turns: 5, lastContextTokens: 9000, lastError: "boom",
	});
	assert.equal(snap.totals.runs, 2);
	assert.equal(snap.totals.input, 4000);
});

test("session stats: reset drops everything for a new session", () => {
	const stats = createSessionStats();
	stats.record("worker", { input: 10, output: 5 }, false);
	stats.reset();
	const snap = stats.snapshot();
	assert.deepEqual(snap.perAgent, {});
	assert.equal(snap.totals.runs, 0);
});
