/**
 * "Peek into a run": turn a fleet entry into a command that opens that child's
 * own session in a new pane.
 *
 * The runners are independent pi processes, and each persistent child records
 * its `sessionId`/`sessionFile` (ADR-0011), so a finished run can be resumed
 * with `pi --session <id>`. A LIVE run must be forked instead: forking copies
 * the history into a new session and leaves the running writer alone, while
 * `--session` would open a second writer on the same file.
 *
 * Pane creation is not an extension API. pi runs inside a zellij pane, so the
 * extension spawns the zellij CLI, which asks the zellij SERVER to create the
 * pane over its unix socket. Outside zellij there is no server to ask, so the
 * caller prints the equivalent pi command instead of failing silently.
 */

export interface PeekEntry {
	/** Stable identity for the picker round-trip. */
	key: string;
	agent: string;
	task: string;
	live: boolean;
	sessionId?: string;
	sessionFile?: string;
	state?: string;
	runId?: number;
	endedAt?: number;
}

export interface PeekTarget {
	/** `--fork` for a live run, `--session` for a finished one. */
	flag: "--fork" | "--session";
	ref: string;
}

export interface PeekInvocation {
	bin: string;
	args: string[];
}

export interface PeekEnv {
	/** Absolute cwd the new pane should start in (the parent's cwd). */
	cwd: string;
	/** `$ZELLIJ_SESSION_NAME`; absent outside zellij, which disables spawning. */
	zellijSession?: string;
	zellijBin?: string;
	piBin?: string;
}

/** `undefined` when the child never recorded a session (persistence off, or it died first). */
export function peekTarget(entry: PeekEntry): PeekTarget | undefined {
	const ref = entry.sessionId ?? entry.sessionFile;
	if (!ref) return undefined;
	// A live child owns its session file; a fork keeps both writers safe.
	return { flag: entry.live ? "--fork" : "--session", ref };
}

/** The pi command for one entry, as words. */
export function peekPiCommand(entry: PeekEntry): string[] | undefined {
	const target = peekTarget(entry);
	return target ? ["pi", target.flag, target.ref] : undefined;
}

/** A copy-paste line for the no-zellij fallback. */
export function formatPeekCommand(entry: PeekEntry): string | undefined {
	const cmd = peekPiCommand(entry);
	return cmd ? cmd.join(" ") : undefined;
}

/**
 * The invocation to run. Without `zellijSession` the caller must fall back to
 * `formatPeekCommand`, because there is no zellij server to accept the request.
 */
export function peekInvocation(entry: PeekEntry, env: PeekEnv): PeekInvocation | undefined {
	const target = peekTarget(entry);
	if (!target) return undefined;
	if (!env.zellijSession) return undefined;
	const args = ["action", "new-pane", "--cwd", env.cwd];
	// Name the pane after the run so the operator can tell panes apart.
	args.push("--name", `run: ${entry.agent}`);
	args.push("--", ...(env.piBin ? [env.piBin] : []), target.flag, target.ref);
	return { bin: env.zellijBin ?? "zellij", args };
}

const MAX_TASK_CHARS = 40;

function truncate(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** One picker row. Mirrors the fleet widget vocabulary, so nothing new to learn. */
export function entryLabel(entry: PeekEntry): string {
	const task = truncate(entry.task, MAX_TASK_CHARS);
	const head = entry.live
		? `● ${entry.agent} · ${entry.state && entry.state !== "running" ? entry.state.replaceAll("-", " ") : "running"}`
		: `✓ ${entry.agent}`;
	const suffix = peekTarget(entry) ? "" : " · no session";
	const id = entry.runId !== undefined ? ` [run ${entry.runId}]` : "";
	return `${head}${id} · "${task}"${suffix}`;
}

/** Entries to offer: live first, then most recent finished, capped. */
export function peekEntries(live: PeekEntry[], recent: PeekEntry[], limit = 20): PeekEntry[] {
	return [...live, ...recent].slice(0, limit);
}
