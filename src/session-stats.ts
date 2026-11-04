/**
 * Session accounting for the orchestrator fleet.
 *
 * The fleet panel already shows LIVE state (turn, ctx, tokens of a run that is
 * working right now). It had nothing to show once the run finished, so an idle
 * panel listed agent names and nothing else. This keeps a per-agent tally for
 * the whole session: runs, failures, input/output tokens, turns and the last
 * context size, so the panel can answer "what has this session spent".
 */

export interface AgentStat {
	runs: number;
	failed: number;
	input: number;
	output: number;
	turns: number;
	/** Context size of the most recent run, a rough "how big are these tasks". */
	lastContextTokens: number;
	lastError?: string;
}

export interface SessionStatsSnapshot {
	perAgent: Record<string, AgentStat>;
	totals: AgentStat;
}

export interface RunUsage {
	input?: number;
	output?: number;
	contextTokens?: number;
	turns?: number;
}

export interface SessionStats {
	/** One settled run, exactly once per run. */
	record(agent: string, usage: RunUsage, failed: boolean, error?: string): void;
	snapshot(): SessionStatsSnapshot;
	/** Dropped on session start; stats are per session, never lifetime. */
	reset(): void;
}

const emptyStat = (): AgentStat => ({ runs: 0, failed: 0, input: 0, output: 0, turns: 0, lastContextTokens: 0 });

const addInto = (target: AgentStat, source: AgentStat): void => {
	target.runs += source.runs;
	target.failed += source.failed;
	target.input += source.input;
	target.output += source.output;
	target.turns += source.turns;
	target.lastContextTokens = Math.max(target.lastContextTokens, source.lastContextTokens);
	if (source.lastError !== undefined) target.lastError = source.lastError;
};

export function createSessionStats(): SessionStats {
	const perAgent = new Map<string, AgentStat>();
	const get = (agent: string): AgentStat => {
		let stat = perAgent.get(agent);
		if (!stat) {
			stat = emptyStat();
			perAgent.set(agent, stat);
		}
		return stat;
	};

	return {
		record(agent, usage, failed, error) {
			const stat = get(agent);
			stat.runs += 1;
			if (failed) stat.failed += 1;
			stat.input += usage.input ?? 0;
			stat.output += usage.output ?? 0;
			stat.turns += usage.turns ?? 0;
			const ctx = usage.contextTokens ?? 0;
			if (ctx > 0) stat.lastContextTokens = ctx;
			if (error) stat.lastError = error;
		},
		snapshot() {
			const out: Record<string, AgentStat> = {};
			const totals = emptyStat();
			for (const [agent, stat] of perAgent) {
				out[agent] = { ...stat };
				addInto(totals, stat);
			}
			return { perAgent: out, totals };
		},
		reset() {
			perAgent.clear();
		},
	};
}
