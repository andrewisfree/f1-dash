import { createJSONStorage, persist } from "zustand/middleware";
import { create } from "zustand";

const MAX_OUT_LAPS = 30;
const MAX_FRACTIONS = 20;

export type Crossings = {
	// when the lap started, null when the page did not see the line
	lapStart: number | null;
	// when each mini sector of the lap lit up, flat over the three sectors, null when not seen
	times: (number | null)[];
};

type QualifyingStore = {
	sessionKey: number | null;
	// milliseconds from the pit exit to the line, of the out laps seen in this session
	outLaps: number[];
	// milliseconds of the delayed clock, per driver, the feed does not time the mini sectors
	crossings: Record<string, Crossings>;
	// share of the sector done at the end of each mini sector, on push sectors of any car, keyed by
	// sector and number of mini sectors
	fractions: Record<string, number[][]>;

	reset: (sessionKey: number | null) => void;
	addOutLaps: (outLaps: number[]) => void;
	setCrossings: (crossings: Record<string, Crossings>) => void;
	addFractions: (key: string, fractions: number[]) => void;
};

export const useQualifyingStore = create<QualifyingStore>()(
	persist(
		(set) => ({
			sessionKey: null,
			outLaps: [],
			crossings: {},
			fractions: {},

			reset: (sessionKey) => set({ sessionKey, outLaps: [], crossings: {}, fractions: {} }),
			addOutLaps: (outLaps) => set((prev) => ({ outLaps: [...prev.outLaps, ...outLaps].slice(-MAX_OUT_LAPS) })),
			setCrossings: (crossings) => set({ crossings }),
			addFractions: (key, fractions) =>
				set((prev) => ({
					fractions: { ...prev.fractions, [key]: [...(prev.fractions[key] ?? []), fractions].slice(-MAX_FRACTIONS) },
				})),
		}),
		{
			name: "qualifying",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ sessionKey, outLaps, fractions }) => ({ sessionKey, outLaps, fractions }),
		},
	),
);
