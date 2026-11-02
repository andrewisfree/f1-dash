import { persist } from "zustand/middleware";
import { create } from "zustand";

type RivalStore = {
	// driver the driver page keeps comparing with, null follows the cars ahead and behind
	rival: string | null;
	setRival: (rival: string | null) => void;
};

export const useRivalStore = create<RivalStore>()(
	persist(
		(set) => ({
			rival: null,
			setRival: (rival: string | null) => set({ rival }),
		}),
		{
			name: "driver-rival",
		},
	),
);
