import type { TimingAppDataDriver } from "@/types/state.type";

import { classifyLaps, FUEL_EFFECT, linearSlope, median, type PracticeLap } from "@/lib/practice";

import type { LapSample } from "@/stores/useLapHistoryStore";

// the fewest timed laps on a set for a reference pace and a trend
const MIN_STINT_LAPS = 4;

export type LapLogRow = PracticeLap & {
	// against the typical lap on the same set, negative when faster, null for laps left out
	delta: number | null;
	// why the lap is left out of the pace
	reason: string | null;
};

const timed = (lap: PracticeLap) => (lap.kind === "push" || lap.kind === "long") && !lap.outlier;

function reasonFor(lap: PracticeLap, previous: PracticeLap | undefined, next: PracticeLap | undefined) {
	if (lap.kind === "cool") return "slow lap";
	if (lap.kind === "long" && lap.outlier) return "traffic";
	if (lap.kind !== "pit") return null;
	if (lap.lapTime === null) return "no time";
	// the stint count steps around a stop
	if ((previous && previous.stint !== lap.stint) || (next && next.stint !== lap.stint)) return "pit";
	return "pit, SC or flag";
}

/**
 * the laps of a driver with how each compares to the typical lap on its set
 */
export function buildLapLog(
	samples: LapSample[] | undefined,
	appData: TimingAppDataDriver | undefined,
	currentLap: number | undefined,
): LapLogRow[] {
	const laps = classifyLaps(samples, appData, currentLap);

	const all = laps.filter(timed).map((lap) => lap.lapTime!);
	const fallback = all.length > 0 ? median(all) : null;
	const references = new Map<number, number | null>();

	const reference = (stint: number) => {
		if (!references.has(stint)) {
			const times = laps.filter((lap) => lap.stint === stint && timed(lap)).map((lap) => lap.lapTime!);
			references.set(stint, times.length >= MIN_STINT_LAPS ? median(times) : fallback);
		}
		return references.get(stint)!;
	};

	return laps.map((lap, index) => {
		const reason = reasonFor(lap, laps[index - 1], laps[index + 1]);
		const ref = reason === null ? reference(lap.stint) : null;

		return { ...lap, reason, delta: ref !== null && lap.lapTime !== null ? lap.lapTime - ref : null };
	});
}

/**
 * tyre loss per lap on one set, from its timed laps with the fuel burn added back
 */
export function getStintDegradation(rows: PracticeLap[], stint: number): number | null {
	const laps = rows.filter((lap) => lap.stint === stint && timed(lap));
	if (laps.length < MIN_STINT_LAPS) return null;

	const slope = linearSlope(laps.map((lap) => ({ x: lap.tyreAge ?? lap.lap, y: lap.lapTime! })));
	return slope !== null ? slope + FUEL_EFFECT : null;
}
