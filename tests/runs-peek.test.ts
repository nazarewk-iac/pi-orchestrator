import { test } from "node:test";
import assert from "node:assert/strict";
import { entryLabel, formatPeekCommand, peekEntries, peekInvocation, peekTarget } from "../src/runs-peek.ts";

const live = {
	key: "live:7:0", agent: "scout", task: "READ-ONLY SSH probe of an embedded NanoKVM",
	live: true, runId: 7, sessionId: "01a1a78d",
};
const done = { key: "done:1", agent: "worker", task: "edit the file", live: false, sessionFile: "/s/01a1a111.jsonl" };

test("a live run forks, a finished run resumes", () => {
	assert.deepEqual(peekTarget(live), { flag: "--fork", ref: "01a1a78d" });
	assert.deepEqual(peekTarget(done), { flag: "--session", ref: "/s/01a1a111.jsonl" });
});

test("a run without a session yields no target or command", () => {
	const blind = { key: "x", agent: "scout", task: "t", live: true };
	assert.equal(peekTarget(blind), undefined);
	assert.equal(formatPeekCommand(blind), undefined);
	assert.equal(peekInvocation(blind, { cwd: "/repo", zellijSession: "s" }), undefined);
});

test("inside zellij the invocation asks the server for a named pane in the parent cwd", () => {
	const inv = peekInvocation(live, { cwd: "/repo", zellijSession: "llm:x" });
	assert.deepEqual(inv, {
		bin: "zellij",
		args: ["action", "new-pane", "--cwd", "/repo", "--name", "run: scout", "--", "--fork", "01a1a78d"],
	});
});

test("outside zellij there is no server to ask, so the caller prints the pi command", () => {
	assert.equal(peekInvocation(live, { cwd: "/repo" }), undefined);
	assert.equal(formatPeekCommand(live), "pi --fork 01a1a78d");
	assert.equal(formatPeekCommand(done), "pi --session /s/01a1a111.jsonl");
});

test("labels mirror the fleet vocabulary and mark a missing session", () => {
	assert.equal(entryLabel(live), '● scout · running [run 7] · "READ-ONLY SSH probe of an embedded Nano…"');
	assert.equal(entryLabel({ ...done, task: "x" }), '✓ worker · "x"');
	assert.match(entryLabel({ key: "k", agent: "scout", task: "t", live: true }), /no session$/);
});

test("live entries come first and the list is capped", () => {
	const many = Array.from({ length: 30 }, (_, i) => ({ ...done, key: `d${i}` }));
	const out = peekEntries([live], many, 5);
	assert.equal(out.length, 5);
	assert.equal(out[0].key, "live:7:0");
});
