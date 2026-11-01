import type { LapSample } from "@/stores/useLapHistoryStore";

// a car this close on the lap before a stop is the one the stop is played against
const RIVAL_SECONDS = 3;
// the rival has this many laps to answer, later it is another strategy
const ANSWER_LAPS = 8;
// laps a decided undercut stays in the row
const SHOWN_LAPS = 5;

export type Undercut = {
	rival: string;
	// undercut for the car that stopped first, overcut for the one that stayed out
	role: "undercut" | "overcut";
	// seconds won on the rival, negative when lost; while the rival has not stopped, what it would be
	// if the rival stopped now and lost the usual time
	gain: number;
	done: boolean;
};

type Stop = { lap: number; stint: number };

// the lap the new set first shows, the stop is around it
function getStops(samples: LapSample[]): Stop[] {
	const stops: Stop[] = [];
	for (let i = 1; i < samples.length; i++) {
		if (samples[i].stint > samples[i - 1].stint) stops.push({ lap: samples[i].lap, stint: samples[i].stint });
	}
	return stops;
}

/**
 * the undercut and overcut in progress or just decided, for both cars of every pair: the gap between
 * the two on the lap before the first stop against the gap once both have stopped and run their out lap
 */
export function getUndercuts(
	history: Record<string, LapSample[]>,
	currentLap: number | null,
	pitLoss: number,
): Map<string, Undercut> {
	const result = new Map<string, Undercut>();
	if (currentLap === null) return result;

	const gapAt = (nr: string, lap: number) => history[nr]?.find((sample) => sample.lap === lap)?.gap ?? null;
	const lastCommon = (a: string, b: string) => {
		const laps = new Set(history[b]?.filter((sample) => sample.lapTime !== null).map((sample) => sample.lap));
		return history[a]?.filter((sample) => sample.lapTime !== null && laps.has(sample.lap)).at(-1)?.lap ?? null;
	};
	// how much the first car lost on the second over the laps after one and up to another, from the lap
	// times: the gaps to the leader of two cars jump apart when the leader stops between their two lines
	const lost = (first: string, second: string, from: number, to: number) => {
		let total = 0;
		for (let lap = from + 1; lap <= to; lap++) {
			const own = history[first]?.find((sample) => sample.lap === lap)?.lapTime;
			const theirs = history[second]?.find((sample) => sample.lap === lap)?.lapTime;
			if (own == null || theirs == null) return null;
			total += own - theirs;
		}
		return total;
	};

	const pairs: {
		first: string;
		second: string;
		before: number;
		reference: number;
		stop: number;
		answer: Stop | null;
	}[] = [];

	for (const [first, samples] of Object.entries(history)) {
		const stop = getStops(samples).at(-1);
		if (!stop) continue;

		// two laps before the new set shows, ahead of the in lap
		const reference = stop.lap - 2;
		const own = gapAt(first, reference);
		if (own === null) continue;

		let best: (typeof pairs)[number] | null = null;
		for (const [second, other] of Object.entries(history)) {
			if (second === first) continue;
			const theirs = gapAt(second, reference);
			if (theirs === null || Math.abs(own - theirs) > RIVAL_SECONDS) continue;

			// the rival must still be on the set it had then: a stop before is another fight
			const theirStops = getStops(other);
			if (theirStops.some((entry) => entry.lap > reference - 2 && entry.lap <= stop.lap)) continue;

			const answer = theirStops.find((entry) => entry.lap > stop.lap) ?? null;
			if (answer && answer.lap - stop.lap > ANSWER_LAPS) continue;
			if (!answer && currentLap - stop.lap > ANSWER_LAPS) continue;

			const pair = { first, second, before: own - theirs, reference, stop: stop.lap, answer };
			if (!best || Math.abs(pair.before) < Math.abs(best.before)) best = pair;
		}
		if (best) pairs.push(best);
	}

	for (const pair of pairs) {
		let gain: number | null = null;
		let done = false;

		if (pair.answer) {
			// both out laps run
			const after = pair.answer.lap + 1;
			const change = lost(pair.first, pair.second, pair.reference, after);
			if (change === null || currentLap - after > SHOWN_LAPS) continue;

			gain = -change;
			done = true;
		} else {
			const lap = lastCommon(pair.first, pair.second);
			// the out lap of the first car is not run yet
			const change = lap !== null && lap > pair.stop ? lost(pair.first, pair.second, pair.reference, lap) : null;
			if (change === null) continue;

			gain = pitLoss - change;
		}

		// the newest fight of a car wins
		const previous = [result.get(pair.first), result.get(pair.second)];
		if (previous.some((entry) => entry?.done === false && done)) continue;

		result.set(pair.first, { rival: pair.second, role: "undercut", gain, done });
		result.set(pair.second, { rival: pair.first, role: "overcut", gain: -gain, done });
	}

	return result;
}
