"use client";

import { useEffect } from "react";

import type { State } from "@/types/state.type";

import { useDataStore } from "@/stores/useDataStore";
import { useQualifyingStore } from "@/stores/useQualifyingStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

// the lap count also steps at the pit exit, anything shorter is not a lap
const MIN_OUT_LAP_MS = 45_000;
// longer than this the car stopped or the session was interrupted
const MAX_OUT_LAP_MS = 300_000;

/**
 * measures how long out laps take, to know until when leaving the pits is still worth it
 */
export const useQualifyingTracker = () => {
	useEffect(() => {
		const exits = new Map<string, { at: number; lap: number }>();
		const inPit = new Map<string, boolean>();
		let lastDelay = useSettingsStore.getState().delay;

		const record = (state: State | null) => {
			const lines = state?.TimingData?.Lines;
			if (!lines || !state.SessionInfo) return;

			const store = useQualifyingStore.getState();
			const sessionKey = state.SessionInfo.Key ?? null;

			if (store.sessionKey !== sessionKey) {
				exits.clear();
				inPit.clear();
				store.reset(sessionKey);
			}

			if (state.SessionInfo.Type !== "Qualifying") return;

			// the state shown is delayed, a changed delay breaks the laps in progress
			const delay = useSettingsStore.getState().delay;
			const now = Date.now() - delay * 1000;
			if (delay !== lastDelay) exits.clear();
			lastDelay = delay;

			const measured: number[] = [];

			for (const driver of Object.values(lines)) {
				const nr = driver.RacingNumber;
				const lap = driver.NumberOfLaps;
				const wasInPit = inPit.get(nr);
				inPit.set(nr, !!driver.InPit);

				if (typeof lap !== "number") continue;

				if (driver.InPit || driver.Stopped) {
					exits.delete(nr);
					continue;
				}

				if (wasInPit) {
					exits.set(nr, { at: now, lap });
					continue;
				}

				const exit = exits.get(nr);
				if (!exit || lap <= exit.lap) continue;

				const duration = now - exit.at;
				if (duration < MIN_OUT_LAP_MS) {
					exit.lap = lap;
					continue;
				}

				exits.delete(nr);
				if (duration < MAX_OUT_LAP_MS) measured.push(duration);
			}

			if (measured.length > 0) store.addOutLaps(measured);
		};

		return useDataStore.subscribe((store, prev) => {
			if (store.state !== prev.state) record(store.state);
		});
	}, []);
};
