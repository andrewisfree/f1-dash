import type { Stint, TimingDataDriver } from "@/types/state.type";

import { buildLapLog, getStintDegradation, type LapLogRow } from "@/lib/lapLog";
import { LONG_RUN_LAPS, type LongRun } from "@/lib/practice";
import { describeTrend, getPace, getPitWindow, type GapEntry, type PitWindow, type Trend } from "@/lib/race";
import { tyreWear } from "@/lib/tones";

import type { LapSample } from "@/stores/useLapHistoryStore";

export type Mode = "race" | "qualifying" | "practice";

export function getMode(type: string | undefined): Mode {
	if (type === "Race") return "race";
	if (type === "Qualifying") return "qualifying";
	return "practice";
}

// closer than this a stop of one of the two cars can swap them
export const UNDERCUT_GAP = 3;

export type Battle = {
	nr: string;
	role: "ahead" | "behind";
	interval: number | null;
	trend: Trend | null;
	pace: number | null;
	stint: Stint | undefined;
};

export type Activity = { text: string; kind: "pit" | "out" | "push" | "long" | "cool" | "idle" };

export type CarView = {
	nr: string;
	driver: TimingDataDriver;
	stints: Stint[];
	stint: Stint | undefined;
	log: LapLogRow[];
	pace: number | null;
	degradation: (stint: number) => number | null;
	ahead: Battle | null;
	behind: Battle | null;
	pitWindow: PitWindow | null;
	undercut: { threat: Battle | null; chance: Battle | null };
	activity: Activity;
	compoundLaps: { compound: string; laps: number }[];
	longRun: LongRun | null;
	// place of the best long run among the best of every driver on the same compound
	longRunRank: number | null;
};

type Context = {
	ordered: TimingDataDriver[];
	gaps: Map<string, number>;
	leadLap: GapEntry[];
	history: Record<string, LapSample[]>;
	stints: Record<string, Stint[]>;
	runs: LongRun[];
	mode: Mode;
	neutralized: boolean;
	lapsRemaining: number | null;
	pitLoss: number;
	isOffLeadLap: (driver: TimingDataDriver) => boolean;
};

/**
 * what the driver is doing now, from the laps in a row on the current set
 */
function getActivity(driver: TimingDataDriver, log: LapLogRow[]): Activity {
	if (driver.Retired || driver.Stopped) return { text: "Stopped", kind: "idle" };
	if (driver.InPit) return { text: "In the pits", kind: "pit" };
	if (driver.PitOut) return { text: "Out lap", kind: "out" };

	const last = log[log.length - 1];
	if (!last) return { text: "On track", kind: "push" };
	if (last.kind === "cool") return { text: "Cool down lap", kind: "cool" };

	let run = 0;
	for (let index = log.length - 1; index >= 0; index--) {
		const lap = log[index];
		if (lap.stint !== last.stint || (lap.kind !== "push" && lap.kind !== "long")) break;
		run++;
	}

	if (run >= LONG_RUN_LAPS) return { text: `Long run, ${run} laps`, kind: "long" };
	if (run > 0) return { text: run === 1 ? "Push lap" : `${run} timed laps`, kind: "push" };
	return { text: "On track", kind: "push" };
}

function getCompoundLaps(stints: Stint[]) {
	const laps = new Map<string, number>();
	for (const stint of stints) {
		const compound = stint.Compound ?? "UNKNOWN";
		laps.set(compound, (laps.get(compound) ?? 0) + Math.max(0, (stint.TotalLaps ?? 0) - (stint.StartLaps ?? 0)));
	}
	return Array.from(laps.entries()).map(([compound, count]) => ({ compound, laps: count }));
}

export function buildCarView(nr: string, ctx: Context): CarView | null {
	const index = ctx.ordered.findIndex((entry) => entry.RacingNumber === nr);
	const driver = ctx.ordered[index];
	if (!driver) return null;

	const stints = ctx.stints[nr] ?? [];
	const stint = stints[stints.length - 1];
	const log = buildLapLog(
		ctx.history[nr],
		{ RacingNumber: nr, Stints: stints, Line: 0, GridPos: "" },
		driver.NumberOfLaps,
	);
	const isRace = ctx.mode === "race";

	const battle = (other: TimingDataDriver | undefined, role: Battle["role"]): Battle | null => {
		if (!other) return null;

		const comparable = !isRace || (!ctx.isOffLeadLap(driver) && !ctx.isOffLeadLap(other));
		const interval = comparable ? Math.abs((ctx.gaps.get(nr) ?? 0) - (ctx.gaps.get(other.RacingNumber) ?? 0)) : null;
		const [first, second] = role === "ahead" ? [other, driver] : [driver, other];
		const trend =
			isRace && !ctx.neutralized && interval !== null
				? describeTrend(ctx.history[second.RacingNumber], ctx.history[first.RacingNumber], interval, ctx.lapsRemaining)
				: null;
		const otherStints = ctx.stints[other.RacingNumber] ?? [];

		return {
			nr: other.RacingNumber,
			role,
			interval,
			trend,
			pace: getPace(ctx.history[other.RacingNumber]),
			stint: otherStints[otherStints.length - 1],
		};
	};

	const ahead = battle(ctx.ordered[index - 1], "ahead");
	const behind = battle(ctx.ordered[index + 1], "behind");

	// a car close behind gains by stopping first on fresh tyres once ours are worn,
	// a car close ahead on older tyres can be passed the same way
	const ownWear = tyreWear(stint)?.share ?? 0;
	const close = (other: Battle | null) => other !== null && other.interval !== null && other.interval < UNDERCUT_GAP;
	const undercut = {
		threat: isRace && close(behind) && ownWear >= 0.5 ? behind : null,
		chance:
			isRace &&
			close(ahead) &&
			(ahead!.stint?.TotalLaps ?? 0) >= (stint?.TotalLaps ?? 0) &&
			(tyreWear(ahead!.stint)?.share ?? 0) >= 0.5
				? ahead
				: null,
	};

	const runs = ctx.runs.filter((run) => run.nr === nr);
	const longRun = runs.reduce<LongRun | null>((best, run) => (!best || run.average < best.average ? run : best), null);
	let longRunRank: number | null = null;
	if (longRun) {
		const bestByDriver = new Map<string, number>();
		for (const run of ctx.runs) {
			if (run.compound !== longRun.compound) continue;
			bestByDriver.set(run.nr, Math.min(bestByDriver.get(run.nr) ?? Infinity, run.average));
		}
		longRunRank = Array.from(bestByDriver.values()).filter((average) => average < longRun.average).length + 1;
	}

	return {
		nr,
		driver,
		stints,
		stint,
		log,
		pace: getPace(ctx.history[nr]),
		degradation: (number: number) => getStintDegradation(log, number),
		ahead,
		behind,
		pitWindow: isRace ? getPitWindow(ctx.leadLap, nr, ctx.pitLoss) : null,
		undercut,
		activity: getActivity(driver, log),
		compoundLaps: getCompoundLaps(stints),
		longRun,
		longRunRank,
	};
}
