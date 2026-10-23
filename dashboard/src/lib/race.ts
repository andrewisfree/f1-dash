import type { TimingDataDriver } from "@/types/state.type";

import { parseLapsDown } from "@/lib/gaps";

import { getGapTrend, type LapSample } from "@/stores/useLapHistoryStore";

// slower gap changes than this are shown as stable
const MIN_TREND_RATE = 0.05;
const MAX_CATCH_LAPS = 30;
// laps averaged for the race pace
export const PACE_LAPS = 3;

// safety car, red flag and virtual safety car
export const isNeutralized = (status?: string) => ["4", "5", "6", "7"].includes(status ?? "");

// lapped and stopped cars have no usable gap to the leader
export const isOffLeadLap = (driver: TimingDataDriver) =>
	driver.Retired || driver.Stopped || parseLapsDown(driver.GapToLeader) > 0;

export function formatSigned(seconds: number, digits = 3) {
	return `${seconds < 0 ? "-" : "+"}${Math.abs(seconds).toFixed(digits)}`;
}

export type Trend = {
	text: string;
	tone: "closing" | "opening" | "stable";
	// change of the gap in seconds per lap, negative when closing
	rate: number;
	// laps until the gap is closed, null when opening or out of reach
	catchLaps: number | null;
};

export function describeTrend(
	behind: LapSample[] | undefined,
	ahead: LapSample[] | undefined,
	interval: number,
	lapsRemaining: number | null,
): Trend | null {
	const trend = getGapTrend(behind, ahead);
	if (!trend) return null;

	if (Math.abs(trend.rate) < MIN_TREND_RATE)
		return { text: "stable", tone: "stable", rate: trend.rate, catchLaps: null };

	const text = `${formatSigned(trend.rate, 2)}/L`;
	if (trend.rate > 0) return { text, tone: "opening", rate: trend.rate, catchLaps: null };

	const catchLaps = Math.ceil(interval / -trend.rate);
	const reachable = catchLaps <= Math.min(MAX_CATCH_LAPS, lapsRemaining ?? MAX_CATCH_LAPS);
	return {
		text: reachable ? `${text} · ${catchLaps}L` : text,
		tone: "closing",
		rate: trend.rate,
		catchLaps: reachable ? catchLaps : null,
	};
}

/**
 * average of the last clean laps, the pace without traffic, pit stops or safety car
 */
export function getPace(samples: LapSample[] | undefined, laps = PACE_LAPS): number | null {
	const times = (samples ?? [])
		.filter((sample) => sample.clean && sample.lapTime !== null)
		.slice(-laps)
		.map((sample) => sample.lapTime as number);

	if (times.length < laps) return null;
	return times.reduce((sum, time) => sum + time, 0) / laps;
}

export type StatusRival = {
	tla: string;
	trend: Trend | null;
};

export type Status = {
	text: string;
	tone: "attack" | "warning" | "neutral";
};

const perLap = (rate: number) => `${Math.abs(rate).toFixed(2)}s/lap`;

/**
 * one line on how the race is going, from the trends against the cars ahead and behind
 */
export function describeStatus(ahead: StatusRival | null, behind: StatusRival | null): Status | null {
	const threat = behind?.trend?.tone === "closing" ? ` · ${behind.tla} closing at ${perLap(behind.trend.rate)}` : "";

	if (ahead?.trend) {
		const { tla, trend } = ahead;
		if (trend.tone === "closing") {
			return trend.catchLaps !== null
				? { text: `Attacking ${tla}, catches in ${trend.catchLaps} laps${threat}`, tone: "attack" }
				: { text: `Closing on ${tla}, not enough laps to catch${threat}`, tone: "neutral" };
		}
		if (trend.tone === "opening") return { text: `Losing ground to ${tla}${threat}`, tone: "warning" };
		return { text: `Holding station behind ${tla}${threat}`, tone: "neutral" };
	}

	if (behind?.trend) {
		const { tla, trend } = behind;
		if (trend.tone === "closing")
			return { text: `Under attack from ${tla}, closing at ${perLap(trend.rate)}`, tone: "warning" };
		if (trend.tone === "opening") return { text: `Pulling away from ${tla}`, tone: "attack" };
		return { text: `Holding station ahead of ${tla}`, tone: "neutral" };
	}

	return null;
}

export type GapEntry = {
	nr: string;
	// gap to the leader in seconds
	gap: number;
};

export type PitWindow = {
	// gap to the leader after the stop
	gap: number;
	position: number;
	current: number;
	ahead: { nr: string; margin: number } | null;
	behind: { nr: string; margin: number } | null;
	// cars currently behind that would get ahead
	lostTo: string[];
};

/**
 * where a driver would rejoin after a pit stop, entries are the cars on the lead lap in race order
 */
export function getPitWindow(entries: GapEntry[], nr: string, pitLoss: number): PitWindow | null {
	const index = entries.findIndex((entry) => entry.nr === nr);
	if (index < 0 || pitLoss <= 0) return null;

	const gap = entries[index].gap + pitLoss;
	const others = entries.filter((entry) => entry.nr !== nr);
	const ahead = others.filter((entry) => entry.gap <= gap);
	const carAhead = ahead[ahead.length - 1];
	const carBehind = others[ahead.length];

	return {
		gap,
		position: ahead.length + 1,
		current: index + 1,
		ahead: carAhead ? { nr: carAhead.nr, margin: gap - carAhead.gap } : null,
		behind: carBehind ? { nr: carBehind.nr, margin: carBehind.gap - gap } : null,
		lostTo: ahead.slice(index).map((entry) => entry.nr),
	};
}
