import { persist, createJSONStorage, subscribeWithSelector } from "zustand/middleware";
import { create } from "zustand";

type SpeedUnit = "metric" | "imperial";

type SettingsStore = {
	delay: number;
	setDelay: (delay: number) => void;

	speedUnit: SpeedUnit;
	setSpeedUnit: (speedUnit: SpeedUnit) => void;

	showCornerNumbers: boolean;
	setShowCornerNumbers: (showCornerNumbers: boolean) => void;

	carMetrics: boolean;
	setCarMetrics: (carMetrics: boolean) => void;

	tableHeaders: boolean;
	setTableHeaders: (tableHeaders: boolean) => void;

	showBestSectors: boolean;
	setShowBestSectors: (showBestSectors: boolean) => void;

	showMiniSectors: boolean;
	setShowMiniSectors: (showMiniSectors: boolean) => void;

	oledMode: boolean;
	setOledMode: (oledMode: boolean) => void;

	useSafetyCarColors: boolean;
	setUseSafetyCarColors: (useSafetyCarColors: boolean) => void;

	favoriteDrivers: string[];
	setFavoriteDrivers: (favoriteDrivers: string[]) => void;
	removeFavoriteDriver: (driver: string) => void;

	raceControlChime: boolean;
	setRaceControlChime: (raceControlChime: boolean) => void;

	raceControlChimeVolume: number;
	setRaceControlChimeVolume: (raceControlChimeVolume: number) => void;

	delayIsPaused: boolean;
	setDelayIsPaused: (delayIsPaused: boolean) => void;

	// Circle of Doom settings
	circleScale: "piecewise" | "spread" | "fixed";
	setCircleScale: (mode: "piecewise" | "spread" | "fixed") => void;
	circleG1: number; // seconds for first segment
	setCircleG1: (g1: number) => void;
	circleG2: number; // seconds for second segment end
	setCircleG2: (g2: number) => void;
	circleFixedSeconds: number; // seconds represented by 360° when fixed
	setCircleFixedSeconds: (sec: number) => void;

	// Circle: limit displayed drivers (0 = tutti)
	circleTopN: number;
	setCircleTopN: (n: number) => void;

	// Circle/Vertical layout
	circleLayout: "circle" | "vertical";
	setCircleLayout: (layout: "circle" | "vertical") => void;

	// Vertical connectors (adjacent gaps)
	showVerticalConnectors: boolean;
	setShowVerticalConnectors: (v: boolean) => void;
};

export const useSettingsStore = create<SettingsStore>()(
	subscribeWithSelector(
		persist(
			(set) => ({
				delay: 0,
				setDelay: (delay: number) => set({ delay }),

				speedUnit: "metric",
				setSpeedUnit: (speedUnit: SpeedUnit) => set({ speedUnit }),

				showCornerNumbers: false,
				setShowCornerNumbers: (showCornerNumbers: boolean) => set({ showCornerNumbers }),

				carMetrics: false,
				setCarMetrics: (carMetrics: boolean) => set({ carMetrics }),

				tableHeaders: false,
				setTableHeaders: (tableHeaders: boolean) => set({ tableHeaders }),

				showBestSectors: true,
				setShowBestSectors: (showBestSectors: boolean) => set({ showBestSectors }),

				showMiniSectors: true,
				setShowMiniSectors: (showMiniSectors: boolean) => set({ showMiniSectors }),

				oledMode: false,
				setOledMode: (oledMode: boolean) => set({ oledMode }),

				useSafetyCarColors: true,
				setUseSafetyCarColors: (useSafetyCarColors: boolean) => set({ useSafetyCarColors }),

				favoriteDrivers: [],
				setFavoriteDrivers: (favoriteDrivers: string[]) => set({ favoriteDrivers }),
				removeFavoriteDriver: (driver: string) =>
					set((state) => ({ favoriteDrivers: state.favoriteDrivers.filter((d) => d !== driver) })),

				raceControlChime: false,
				setRaceControlChime: (raceControlChime: boolean) => set({ raceControlChime }),

				raceControlChimeVolume: 50,
				setRaceControlChimeVolume: (raceControlChimeVolume: number) => set({ raceControlChimeVolume }),

				delayIsPaused: true,
				setDelayIsPaused: (delayIsPaused: boolean) => set({ delayIsPaused }),

				// Circle of Doom defaults
				circleScale: "piecewise",
				setCircleScale: (mode) => set({ circleScale: mode }),
				circleG1: 3,
				setCircleG1: (g1: number) => set({ circleG1: g1 }),
				circleG2: 15,
				setCircleG2: (g2: number) => set({ circleG2: g2 }),
				circleFixedSeconds: 30,
				setCircleFixedSeconds: (sec: number) => set({ circleFixedSeconds: sec }),

				circleTopN: 0,
				setCircleTopN: (n: number) => set({ circleTopN: n }),

				circleLayout: "circle",
				setCircleLayout: (layout) => set({ circleLayout: layout }),

				showVerticalConnectors: true,
				setShowVerticalConnectors: (v: boolean) => set({ showVerticalConnectors: v }),
			}),
			{
				name: "settings-storage",
				storage: createJSONStorage(() => localStorage),
				onRehydrateStorage: (state) => {
					return () => state.setDelayIsPaused(false);
				},
			},
		),
	),
);
