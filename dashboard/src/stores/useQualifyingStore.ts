import { createJSONStorage, persist } from "zustand/middleware";
import { create } from "zustand";

const MAX_OUT_LAPS = 30;

type QualifyingStore = {
	sessionKey: number | null;
	// milliseconds from the pit exit to the line, of the out laps seen in this session
	outLaps: number[];

	reset: (sessionKey: number | null) => void;
	addOutLaps: (outLaps: number[]) => void;
};

export const useQualifyingStore = create<QualifyingStore>()(
	persist(
		(set) => ({
			sessionKey: null,
			outLaps: [],

			reset: (sessionKey) => set({ sessionKey, outLaps: [] }),
			addOutLaps: (outLaps) => set((prev) => ({ outLaps: [...prev.outLaps, ...outLaps].slice(-MAX_OUT_LAPS) })),
		}),
		{
			name: "qualifying",
			storage: createJSONStorage(() => localStorage),
			partialize: ({ sessionKey, outLaps }) => ({ sessionKey, outLaps }),
		},
	),
);
