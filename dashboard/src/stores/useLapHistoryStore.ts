import { createJSONStorage, persist } from "zustand/middleware";
import { create } from "zustand";

export type LapSample = {
	lap: number;
	position: number;
	// gap to the leader in seconds when the lap was completed, null if lapped or unknown
	gap: number | null;
	lapTime: number | null;
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

const MAX_TREND_LAPS = 3;
const MIN_TREND_LAPS = 2;

export function getGapTrend(behind: LapSample[] | undefined, ahead: LapSample[] | undefined): GapTrend | null {
	if (!behind?.length || !ahead?.length) return null;

	const aheadByLap = new Map(ahead.map((sample) => [sample.lap, sample]));
	const delta = (sample: LapSample) => {
		const other = aheadByLap.get(sample.lap);
		return other && sample.gap !== null && other.gap !== null ? sample.gap - other.gap : null;
	};

	let lastIndex = behind.length - 1;
	while (lastIndex >= 0 && delta(behind[lastIndex]) === null) lastIndex--;
	if (lastIndex < 0) return null;

	const last = behind[lastIndex];
	const lastDelta = delta(last) as number;

	let trend: GapTrend | null = null;

	for (let i = lastIndex; i > 0 && last.lap - behind[i - 1].lap <= MAX_TREND_LAPS; i--) {
		// laps after the base one must be undisturbed for both cars
		if (!behind[i].clean || !aheadByLap.get(behind[i].lap)?.clean) break;
		if (behind[i].lap - behind[i - 1].lap !== 1) break;

		const baseDelta = delta(behind[i - 1]);
		if (baseDelta === null) break;

		const laps = last.lap - behind[i - 1].lap;
		if (laps >= MIN_TREND_LAPS) trend = { rate: (lastDelta - baseDelta) / laps, laps };
	}

	return trend;
}
