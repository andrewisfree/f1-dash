import { createJSONStorage, persist } from "zustand/middleware";
import { create } from "zustand";

export type LapSample = {
	lap: number;
	position: number;
	// gap to the leader in seconds when the lap was completed, null if lapped or unknown
	gap: number | null;
	lapTime: number | null;
	// the lap improved the best of the driver when it was set
	personalBest?: boolean;
	stint: number;
	// false if the lap had a pit stop or was run under safety car, vsc or red flag
	clean: boolean;
};

type LapHistoryStore = {
	sessionKey: number | null;
	laps: Record<string, LapSample[]>;

	reset: (sessionKey: number | null) => void;
	addSamples: (samples: Record<string, LapSample>) => void;
	dropAfter: (nr: string, lap: number) => void;
	// adds the laps recorded by the server, up to the lap shown for every driver
	mergeRecorded: (
		sessionKey: number | null,
		recorded: Record<string, LapSample[]>,
		shownLaps: Record<string, number>,
	) => void;
};

// kept in local storage so a reload during a session does not lose the laps seen so far
export const useLapHistoryStore = create<LapHistoryStore>()(
	persist(
		(set) => ({
			sessionKey: null,
			laps: {},

			reset: (sessionKey) => set({ sessionKey, laps: {} }),
			addSamples: (samples) =>
				set((prev) => {
					const laps = { ...prev.laps };

					for (const [nr, sample] of Object.entries(samples)) {
						laps[nr] = [...(laps[nr] ?? []).filter((existing) => existing.lap < sample.lap), sample];
					}

					return { laps };
				}),
			mergeRecorded: (sessionKey, recorded, shownLaps) =>
				set((prev) => {
					if (prev.sessionKey !== sessionKey) return prev;

					const laps = { ...prev.laps };
					let changed = false;

					for (const [nr, samples] of Object.entries(recorded)) {
						const shown = shownLaps[nr];
						if (shown === undefined) continue;

						// the server saw the whole session, its sample wins over the one seen here
						const byLap = new Map((laps[nr] ?? []).map((sample) => [sample.lap, sample]));
						for (const sample of samples) {
							if (sample.lap > shown) continue;

							const current = byLap.get(sample.lap);
							if (current && JSON.stringify(current) === JSON.stringify(sample)) continue;

							byLap.set(sample.lap, sample);
							changed = true;
						}

						laps[nr] = Array.from(byLap.values()).sort((a, b) => a.lap - b.lap);
					}

					return changed ? { laps } : prev;
				}),
			dropAfter: (nr, lap) =>
				set((prev) => {
					const current = prev.laps[nr];
					if (!current?.some((sample) => sample.lap > lap)) return prev;

					return { laps: { ...prev.laps, [nr]: current.filter((sample) => sample.lap <= lap) } };
				}),
		}),
		{
			name: "lap-history",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ sessionKey, laps }) => ({ sessionKey, laps }),
		},
	),
);

export type GapTrend = {
	// change of the gap between the two cars in seconds per lap, negative when closing
	rate: number;
	laps: number;
};

// the trend reads the last laps of the stint both cars are on: enough to ignore one lap in traffic,
// few enough to notice tyres going off within a couple of laps
const TREND_LAPS = 5;
const MIN_TREND_LAPS = 2;
// a trend whose newest lap is older than this, after a safety car or a long outage, says nothing about now
const MAX_TREND_AGE = 2;

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function getGapTrend(behind: LapSample[] | undefined, ahead: LapSample[] | undefined): GapTrend | null {
	if (!behind?.length || !ahead?.length) return null;

	// laps after a stop of either car, undisturbed for both
	const currentStint = (samples: LapSample[]) =>
		samples.filter((sample) => sample.clean && sample.gap !== null && sample.stint === samples.at(-1)!.stint);
	const aheadByLap = new Map(currentStint(ahead).map((sample) => [sample.lap, sample.gap as number]));
	const points = currentStint(behind)
		.filter((sample) => aheadByLap.has(sample.lap))
		.map((sample) => ({ lap: sample.lap, delta: (sample.gap as number) - (aheadByLap.get(sample.lap) as number) }));

	const lastLap = points.at(-1)?.lap;
	if (lastLap === undefined || behind.at(-1)!.lap - lastLap > MAX_TREND_AGE) return null;

	const recent = points.filter((point) => lastLap - point.lap < TREND_LAPS);
	const laps = lastLap - recent[0].lap;
	if (laps < MIN_TREND_LAPS) return null;

	// the median of the slopes between every two laps (Theil-Sen), one lap in traffic does not move it
	const slopes: number[] = [];
	for (let i = 0; i < recent.length; i++) {
		for (let j = i + 1; j < recent.length; j++) {
			slopes.push((recent[j].delta - recent[i].delta) / (recent[j].lap - recent[i].lap));
		}
	}

	return { rate: median(slopes), laps };
}
