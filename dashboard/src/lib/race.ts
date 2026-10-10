import type { TimingDataDriver } from "@/types/state.type";

import { parseLapsDown } from "@/lib/gaps";

import { getGapTrend, type LapSample } from "@/stores/useLapHistoryStore";

// slower gap changes than this are shown as stable
const MIN_TREND_RATE = 0.05;
const MAX_CATCH_LAPS = 30;

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
};

export function describeTrend(
	behind: LapSample[] | undefined,
	ahead: LapSample[] | undefined,
	interval: number,
	lapsRemaining: number | null,
): Trend | null {
	const trend = getGapTrend(behind, ahead);
	if (!trend) return null;

	if (Math.abs(trend.rate) < MIN_TREND_RATE) return { text: "stable", tone: "stable" };

	const text = `${formatSigned(trend.rate, 2)}/L`;
	if (trend.rate > 0) return { text, tone: "opening" };

	const catchLaps = Math.ceil(interval / -trend.rate);
	const reachable = catchLaps <= Math.min(MAX_CATCH_LAPS, lapsRemaining ?? MAX_CATCH_LAPS);
	return { text: reachable ? `${text} · ${catchLaps}L` : text, tone: "closing" };
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
