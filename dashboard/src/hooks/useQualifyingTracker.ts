"use client";

import { useEffect } from "react";

import type { State } from "@/types/state.type";

import { getBestSectors } from "@/lib/qualifyingBoard";

import { useDataStore } from "@/stores/useDataStore";
import { useQualifyingStore, type Crossings } from "@/stores/useQualifyingStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

// the lap count also steps at the pit exit, anything shorter is not a lap
const MIN_OUT_LAP_MS = 45_000;
// longer than this the car stopped or the session was interrupted
const MAX_OUT_LAP_MS = 300_000;
// mini sector of a lap through the pit lane
const SEGMENT_PIT = 2064;
// a sector this far from the driver's best is not used to learn the mini sectors
const FRACTION_SECTOR_RATIO = 0.1;

type Seen = Crossings & { statuses: number[] };

/**
 * measures how long out laps take, to know until when leaving the pits is still worth it, and
 * when each mini sector lights up, to follow a push lap between the sector times
 */
export const useQualifyingTracker = () => {
	useEffect(() => {
		const exits = new Map<string, { at: number; lap: number }>();
		const inPit = new Map<string, boolean>();
		const seen = new Map<string, Seen>();
		let lastDelay = useSettingsStore.getState().delay;

		const record = (state: State | null) => {
			const lines = state?.TimingData?.Lines;
			if (!lines || !state.SessionInfo) return;

			const store = useQualifyingStore.getState();
			const sessionKey = state.SessionInfo.Key ?? null;

			if (store.sessionKey !== sessionKey) {
				exits.clear();
				inPit.clear();
				seen.clear();
				store.reset(sessionKey);
			}

			if (state.SessionInfo.Type !== "Qualifying") return;

			// the state shown is delayed, a changed delay breaks the laps in progress
			const delay = useSettingsStore.getState().delay;
			const now = Date.now() - delay * 1000;
			if (delay !== lastDelay) {
				exits.clear();
				seen.clear();
			}
			lastDelay = delay;

			const measured: number[] = [];
			let crossed = false;

			for (const driver of Object.values(lines)) {
				const nr = driver.RacingNumber;
				if (trackSegments(nr, driver.Sectors ?? [], getBestSectors(state.TimingStats, nr), now)) crossed = true;

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
			if (crossed) {
				store.setCrossings(
					Object.fromEntries(
						Array.from(seen).map(([nr, { lapStart, times }]) => [nr, { lapStart, times: [...times] }]),
					),
				);
			}
		};

		// true when a mini sector of the driver lit up or went out
		const trackSegments = (
			nr: string,
			sectors: { Segments?: { Status: number }[] }[],
			bestSectors: (number | null)[],
			now: number,
		) => {
			const sizes = sectors.map((sector) => (sector.Segments ?? []).length);
			const statuses = sectors.flatMap((sector) => (sector.Segments ?? []).map((segment) => segment.Status));
			const entry = seen.get(nr);

			// mini sectors already lit when the page opened have no time
			if (!entry || entry.statuses.length !== statuses.length) {
				seen.set(nr, { lapStart: null, times: statuses.map(() => null), statuses });
				return true;
			}

			const last = statuses.length - 1;
			let changed = false;

			// the line: the last mini sector goes out and the lap starts again from the first
			if (last >= 0 && entry.statuses[last] !== 0 && statuses[last] === 0) {
				entry.lapStart = entry.times[last];
				entry.times = statuses.map(() => null);
				entry.statuses = statuses.map(() => 0);
				changed = true;
			}

			const before = entry.statuses;
			for (let i = 0; i < statuses.length; i++) {
				if (before[i] === 0 && statuses[i] !== 0) entry.times[i] = now;
				else if (before[i] !== 0 && statuses[i] === 0) entry.times[i] = null;
				else continue;
				changed = true;
			}
			entry.statuses = statuses;

			// a sector just ended, its mini sectors say how the time is spread over it
			let offset = 0;
			sizes.forEach((size, sector) => {
				const from = offset;
				offset += size;

				const end = from + size - 1;
				if (size === 0 || before[end] !== 0 || statuses[end] === 0) return;
				if (statuses.slice(from, from + size).some((status) => status === SEGMENT_PIT)) return;

				const start = sector === 0 ? entry.lapStart : entry.times[from - 1];
				const times = entry.times.slice(from, from + size);
				const best = bestSectors[sector];
				if (start == null || !best || times.some((time) => time === null)) return;

				const total = (times[size - 1] as number) - start;
				if (Math.abs(total / 1000 / best - 1) > FRACTION_SECTOR_RATIO) return;

				useQualifyingStore.getState().addFractions(
					`${sector}/${size}`,
					times.map((time) => ((time as number) - start) / total),
				);
			});

			return changed;
		};

		return useDataStore.subscribe((store, prev) => {
			if (store.state !== prev.state) record(store.state);
		});
	}, []);
};
