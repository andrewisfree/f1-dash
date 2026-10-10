"use client";

import { useEffect } from "react";

import type { State } from "@/types/state.type";

import { computeGapsSeconds, getOrderedTimingDrivers, parseLapSeconds, parseLapsDown } from "@/lib/gaps";
import { isNeutralized } from "@/lib/race";

import { useDataStore } from "@/stores/useDataStore";
import { useLapHistoryStore, type LapSample } from "@/stores/useLapHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

// gaps arrive slightly after the lap count, so wait before reading them
const SETTLE_MS = 1500;

type Tracker = {
	lastLap: number;
	pending: { lap: number; at: number; clean: boolean } | null;
	disturbed: boolean;
};

/**
 * records one sample per driver per completed lap, the base for gap trends
 */
export const useLapHistory = () => {
	useEffect(() => {
		const trackers = new Map<string, Tracker>();
		let lastDelay = useSettingsStore.getState().delay;

		const record = (state: State | null) => {
			const lines = state?.TimingData?.Lines;
			// without the session the stored laps can not be matched
			if (!lines || !state.SessionInfo) return;

			const history = useLapHistoryStore.getState();
			const sessionKey = state.SessionInfo.Key ?? null;

			if (history.sessionKey !== sessionKey) {
				trackers.clear();
				history.reset(sessionKey);
			}

			// the state shown is delayed, its clock stands still while the delay is paused
			const delay = useSettingsStore.getState().delay;
			const now = Date.now() - delay * 1000;
			// a smaller delay skips ahead, the laps completed in between were not seen
			const skipped = delay < lastDelay;
			lastDelay = delay;

			const isRace = state.SessionInfo?.Type === "Race";
			const neutralized = isNeutralized(state.TrackStatus?.Status);
			const ordered = getOrderedTimingDrivers(lines);
			const gaps = isRace ? computeGapsSeconds(ordered, state.TimingData?.SessionPart) : null;
			const samples: Record<string, LapSample> = {};

			for (const driver of ordered) {
				const nr = driver.RacingNumber;
				const lap = driver.NumberOfLaps;
				if (typeof lap !== "number") continue;

				const tracker = trackers.get(nr);
				if (!tracker) {
					history.dropAfter(nr, lap);
					trackers.set(nr, { lastLap: lap, pending: null, disturbed: true });
					continue;
				}

				if (lap < tracker.lastLap) {
					// a larger delay moved the state back, forget the laps that are not shown yet
					const undone = tracker.pending?.lap === lap + 1 ? tracker.pending : null;

					history.dropAfter(nr, lap);
					tracker.lastLap = lap;
					tracker.pending = null;
					// stepping back over a lap that just ended keeps what is known about it
					tracker.disturbed = undone ? !undone.clean : true;
				} else if (lap > tracker.lastLap) {
					const seen = !skipped && lap - tracker.lastLap === 1;

					tracker.pending = seen ? { lap, at: now, clean: !tracker.disturbed } : null;
					tracker.disturbed = !seen;
					tracker.lastLap = lap;
				} else if (skipped) {
					tracker.pending = null;
					tracker.disturbed = true;
				}

				if (neutralized || driver.InPit || driver.PitOut) tracker.disturbed = true;

				if (tracker.pending && now - tracker.pending.at >= SETTLE_MS) {
					const lapped = parseLapsDown(driver.GapToLeader) > 0;

					samples[nr] = {
						lap: tracker.pending.lap,
						position: parseInt(driver.Position),
						gap: lapped ? null : (gaps?.get(nr) ?? null),
						lapTime: parseLapSeconds(driver.LastLapTime?.Value),
						personalBest: !!(driver.LastLapTime?.PersonalFastest || driver.LastLapTime?.OverallFastest),
						stint: state.TimingAppData?.Lines?.[nr]?.Stints?.length ?? 0,
						clean: tracker.pending.clean,
					};

					tracker.pending = null;
				}
			}

			if (Object.keys(samples).length > 0) history.addSamples(samples);
		};

		return useDataStore.subscribe((store, prev) => {
			if (store.state !== prev.state) record(store.state);
		});
	}, []);
};
