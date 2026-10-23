import { persist } from "zustand/middleware";
import { create } from "zustand";

type PitWallStore = {
	// team followed on the pit wall page, by its name in the driver list
	team: string | null;
	setTeam: (team: string | null) => void;
};

export const usePitWallStore = create<PitWallStore>()(
	persist(
		(set) => ({
			team: null,
			setTeam: (team: string | null) => set({ team }),
		}),
		{
			name: "pit-wall",
		},
	),
);
