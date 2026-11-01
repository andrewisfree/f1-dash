import { create } from "zustand";

export type SectorLap = {
	// seconds of the three sectors, null until the sector is done
	times: (number | null)[];
	// when the page saw the lap end, for the lap delta shown for a moment
	done: number | null;
};

// per car, per lap
export type SectorLaps = Record<string, Record<number, SectorLap>>;

type SectorStore = {
	laps: SectorLaps;
	setLaps: (laps: SectorLaps) => void;
};

export const useSectorStore = create<SectorStore>()((set) => ({
	laps: {},
	setLaps: (laps) => set({ laps }),
}));
