import { stripVTControlCharacters } from "node:util";
import { fleetHeaderLines, formatTokens, type OrchestratorMode } from "./delegate.ts";
import type { SessionStatsSnapshot } from "./session-stats.ts";
import type { RunningTask } from "./run-lifecycle.ts";

// Public pi-atelier sidebar protocol v1. No import/runtime dependency on Atelier.
// https://github.com/michaelmjhhhh/pi-atelier/blob/main/src/sidebar-panels.ts
const CHANNEL = "pi-atelier:sidebar-panels";
const PANEL_ID = "orchestrator:fleet";
const SOURCE = "pi-orchestrator";
const MAX_ROWS = 24;
const MAX_ROW_CHARS = 160;

interface PanelEvents {
	on(channel: string, handler: (data: unknown) => void): () => void;
	emit(channel: string, data: unknown): void;
}

export interface FleetPanelRow {
	text: string;
	role?: "primary" | "accent" | "muted" | "dim" | "working" | "caution" | "error";
}
interface FleetPanelContent { rows: (string | FleetPanelRow)[] }

/** Left-aligned text, not key/value fields: blank labels right-align in Atelier. */
export function renderFleetPanel(
	tasks: RunningTask[],
	agentNames: string[],
	mode: OrchestratorMode,
	stats?: SessionStatsSnapshot,
): { rows: FleetPanelRow[] } {
	const rows: FleetPanelRow[] = [];
	let groups: FleetPanelRow[][];
	const statFor = (name: string) => stats?.perAgent[name];
	const statLine = (name: string): FleetPanelRow[] | undefined => {
		const stat = statFor(name);
		if (!stat || stat.runs === 0) return undefined;
		const failed = stat.failed > 0;
		return [
			{ text: `${name} · ${stat.runs} run${stat.runs === 1 ? "" : "s"}${failed ? `, ${stat.failed} failed` : ""}`, role: failed ? "caution" : "primary" },
			{ text: `↑${formatTokens(stat.input)} ↓${formatTokens(stat.output)} · turn ${stat.turns}`, role: "muted" },
		];
	};
	if (tasks.length === 0) {
		// Idle: the live list is empty, so show what the session has spent per agent.
		rows.push({ text: `${mode.toUpperCase()} · idle`, role: "muted" });
		groups = agentNames.map((name) => statLine(name) ?? [{ text: `• ${name}`, role: "primary" }]);
		const idleTotals = stats?.totals;
		if (idleTotals && idleTotals.runs > 0) {
			groups.push([{
				text: `session · ${idleTotals.runs} run${idleTotals.runs === 1 ? "" : "s"} · ↑${formatTokens(idleTotals.input)} ↓${formatTokens(idleTotals.output)}${idleTotals.failed ? ` · ${idleTotals.failed} failed` : ""}`,
				role: idleTotals.failed ? "caution" : "accent",
			}]);
		}
		if (!groups.length) rows.push({ text: "(empty fleet)", role: "muted" });
	} else {
		const [title, counts] = fleetHeaderLines(tasks);
		rows.push({ text: title, role: "accent" }, {
			text: counts,
			role: tasks.some((t) => t.state === "delivery-failed") ? "error"
				: tasks.some((t) => t.state === "delivery-pending") ? "caution" : "working",
		});
		groups = tasks.map((task) => {
			if (task.state === "queued") return [{ text: `${task.agent} · queued`, role: "muted" }];
			if (task.state === "delivery-pending") return [{ text: `${task.agent} · result pending`, role: "caution" }];
			if (task.state === "delivery-failed") return [{ text: `${task.agent} · delivery failed`, role: "error" }];
			return [
				{ text: `${task.agent} · turn ${task.toolTurns}`, role: "primary" },
				{ text: `ctx ${formatTokens(task.contextTokens)} · ↑${formatTokens(task.inputTokens)} ↓${formatTokens(task.outputTokens)}`, role: "muted" },
			];
		});
	}
	// While running, keep the live rows first and append the session tally at the end.
	const totals = stats?.totals;
	if (tasks.length > 0 && totals && totals.runs > 0) {
		groups = [...groups, [{
			text: `session · ${totals.runs} run${totals.runs === 1 ? "" : "s"} · ↑${formatTokens(totals.input)} ↓${formatTokens(totals.output)}`,
			role: "dim",
		}]];
	}
	for (let i = 0; i < groups.length; i++) {
		// Leave space for an overflow notice, and never split a Worker's details.
		const limit = MAX_ROWS - (i < groups.length - 1 ? 1 : 0);
		if (rows.length + groups[i].length > limit) {
			rows.push({ text: `More: ${groups.length - i} ${tasks.length ? "runs" : "agents"}`, role: "dim" });
			break;
		}
		rows.push(...groups[i]);
	}
	return { rows };
}

function plainText(text: string): string {
	return Array.from(stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ")).slice(0, MAX_ROW_CHARS).join("");
}

/** Presentation only: read the current fleet on each update/discovery request. */
export function createFleetPanel(events: PanelEvents | undefined, getContent: () => FleetPanelContent) {
	let active = false;
	let revision = 0; // Keep increasing across sessions on this event bus.
	let unsubscribe: (() => void) | undefined;

	function update(requestId?: string): void {
		if (!active || !events) return;
		try {
			const { rows: lines } = getContent();
			const bounded = lines.length > MAX_ROWS
				? [...lines.slice(0, MAX_ROWS - 1), `… ${lines.length - MAX_ROWS + 1} more`]
				: lines;
			const rows = bounded.map((row) => typeof row === "string" ? plainText(row) : {
				text: plainText(row.text), ...(row.role ? { role: row.role } : {}),
			});
			events.emit(CHANNEL, {
				version: 1, type: "register", source: SOURCE, revision: ++revision,
				panel: { id: PANEL_ID, title: "Orchestrator Fleet", rows },
				...(requestId === undefined ? {} : { requestId }),
			});
		} catch { /* Optional UI must never affect run execution or Result delivery. */ }
	}

	function dispose(): void {
		if (!active) return;
		active = false;
		try { unsubscribe?.(); } catch { /* Continue with unregister even if unsubscribe fails. */ }
		unsubscribe = undefined;
		try {
			events?.emit(CHANNEL, { version: 1, type: "unregister", source: SOURCE, revision: ++revision, id: PANEL_ID });
		} catch { /* Atelier may be absent or already shut down. */ }
	}

	return {
		start(): void {
			dispose();
			if (!events) return;
			active = true;
			try {
				unsubscribe = events.on(CHANNEL, (data) => {
					if (!data || typeof data !== "object" || Array.isArray(data)) return;
					const event = data as Record<string, unknown>;
					if (event.version !== 1 || event.type !== "discover" || typeof event.requestId !== "string") return;
					const id = event.requestId;
					// Atelier bounds correlation tokens and rejects controls/unpaired surrogates.
					if (!id.trim() || id.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(id) || !id.isWellFormed()) return;
					update(id);
				});
				update();
			} catch { dispose(); }
		},
		update: () => update(),
		dispose,
	};
}
