import type { LapSample } from "@/stores/useLapHistoryStore";

// clean laps around a stop that give the pace of the driver, and the fewest on each side
const PACE_LAPS = 4;
const MIN_PACE_LAPS = 2;
// stops measured before the race replaces the setting
const MIN_STOPS = 2;
// a slow stop or a drive through is not what a stop costs
const MIN_LOSS = 10;
const MAX_LOSS = 45;
// the field runs slower under safety car and virtual safety car, a stop costs about this share of a green one;
// not measured, a race has too few stops under neutralization
const NEUTRALIZED_SHARE: Record<string, number> = { "4": 0.5, "6": 0.6, "7": 0.6 };

export type Stop = {
	nr: string;
	// the in lap
	lap: number;
	// seconds lost to the pace of the driver
	loss: number;
};

export type StopRating = Stop & {
	// against the median stop of the race, negative when quicker
	delta: number | null;
	// the quickest stop of the race so far
	best: boolean;
	chip: string;
};

// stop against the median of the race, from much quicker to much slower
const STOP_HEAT = [
	{ upTo: -1, chip: "bg-emerald-500/40 text-emerald-100" },
	{ upTo: -0.3, chip: "bg-emerald-500/20 text-emerald-200" },
	{ upTo: 0.3, chip: "bg-zinc-800 text-zinc-200" },
	{ upTo: 1, chip: "bg-red-500/20 text-red-200" },
	{ upTo: 2.5, chip: "bg-red-500/35 text-red-100" },
	{ upTo: Infinity, chip: "bg-red-600/55 text-white" },
];

export type PitLoss = {
	// seconds a stop costs now, with the track status applied
	loss: number;
	// seconds a stop costs under green flag
	green: number;
	// stops the green loss was measured on, 0 when it is the setting
	stops: number;
	// the stop is cheaper because the field is neutralized
	neutralized: "SC" | "VSC" | null;
};

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * what the stops of this race cost: in lap and out lap against two laps at the pace of the driver
 * around the stop, stops close to a neutralization have no clean laps around them and are left out
 */
export function measureStops(history: Record<string, LapSample[]>): Stop[] {
	const stops: Stop[] = [];

	for (const [nr, samples] of Object.entries(history)) {
		for (let i = 1; i < samples.length; i++) {
			if (samples[i].stint <= samples[i - 1].stint) continue;

			// the new set shows on the lap after the stop or on the one that ends in the pit lane,
			// the in lap and the out lap are the two laps not clean around it
			const first = !samples[i - 1].clean ? i - 1 : !samples[i].clean ? i : -1;
			const inLap = samples[first];
			const outLap = samples[first + 1];
			if (first < 0 || !outLap || outLap.clean || outLap.lap !== inLap.lap + 1) continue;
			if (inLap.lapTime === null || outLap.lapTime === null) continue;

			const pace = (from: number, to: number) =>
				samples
					.slice(Math.max(0, from), Math.max(0, to))
					.filter((sample) => sample.clean && sample.lapTime !== null)
					.map((sample) => sample.lapTime as number);
			const before = pace(first - PACE_LAPS, first);
			const after = pace(first + 2, first + 2 + PACE_LAPS);
			if (before.length < MIN_PACE_LAPS || after.length < MIN_PACE_LAPS) continue;

			const loss = inLap.lapTime + outLap.lapTime - (median(before) + median(after));
			if (loss >= MIN_LOSS && loss <= MAX_LOSS) stops.push({ nr, lap: inLap.lap, loss });
		}
	}

	return stops;
}

/**
 * the last measured stop of every driver against the other stops of the race: purple the quickest,
 * green quicker and red slower than the median, the stronger the further from it
 */
export function rateStops(stops: Stop[]): Map<string, StopRating> {
	const result = new Map<string, StopRating>();
	const middle = stops.length >= MIN_STOPS ? median(stops.map((stop) => stop.loss)) : null;
	const quickest = Math.min(...stops.map((stop) => stop.loss));

	for (const stop of stops) {
		const last = result.get(stop.nr);
		if (last && last.lap > stop.lap) continue;

		const delta = middle !== null ? stop.loss - middle : null;
		const best = middle !== null && stop.loss === quickest;
		const chip = best
			? "bg-violet-500/30 text-violet-100"
			: delta === null
				? "bg-zinc-800 text-zinc-200"
				: STOP_HEAT.find((step) => delta <= step.upTo)!.chip;
		result.set(stop.nr, { ...stop, delta, best, chip });
	}

	return result;
}

export function getPitLoss(stops: Stop[], setting: number, trackStatus?: string): PitLoss {
	const losses = stops.map((stop) => stop.loss);
	const green = losses.length >= MIN_STOPS ? median(losses) : setting;
	const share = NEUTRALIZED_SHARE[trackStatus ?? ""] ?? 1;

	return {
		loss: green * share,
		green,
		stops: losses.length >= MIN_STOPS ? losses.length : 0,
		neutralized: trackStatus === "4" ? "SC" : trackStatus === "6" || trackStatus === "7" ? "VSC" : null,
	};
}
