"use client";

import { useEffect } from "react";

import type { State } from "@/types/state.type";

import { parseLapSeconds } from "@/lib/gaps";

import { useDataStore } from "@/stores/useDataStore";
import { useSectorStore, type SectorLaps } from "@/stores/useSectorStore";

// the lap in progress and the ones before it that a comparison may still need
const KEPT_LAPS = 3;

/**
 * keeps the sector times of every car lap by lap while the dashboard is open, the feed only holds the lap in
 * progress; a lap is followed from its first sector, a page opened in the middle of a lap starts with the next one
 */
export const useSectorTimes = () => {
	useEffect(() => {
		// the sector values last seen, a different one is a sector just done
		const seen = new Map<string, string[]>();
		// the lap of the last sector recorded, the next sectors belong to it
		const lapOf = new Map<string, number>();
		let sessionKey: number | null = null;

		const record = (state: State | null) => {
			const lines = state?.TimingData?.Lines;
			if (!lines) return;

			const key = state.SessionInfo?.Key ?? null;
			if (key !== sessionKey) {
				sessionKey = key;
				seen.clear();
				lapOf.clear();
				useSectorStore.getState().setLaps({});
			}

			let next: SectorLaps | null = null;

			for (const [nr, line] of Object.entries(lines)) {
				const values = (line.Sectors ?? []).slice(0, 3).map((sector) => sector?.Value ?? "");
				const previous = seen.get(nr);
				seen.set(nr, values);
				// the values found on the first look were set at an unknown moment
				if (!previous) continue;

				values.forEach((value, index) => {
					if (!value || value === previous[index]) return;

					const seconds = parseLapSeconds(value);
					// the first sector opens a lap, the lap count has already stepped at the line
					const lap = index === 0 ? (line.NumberOfLaps ?? 0) + 1 : lapOf.get(nr);
					if (seconds === null || lap === undefined) return;
					lapOf.set(nr, lap);

					next ??= { ...useSectorStore.getState().laps };
					const car = Object.fromEntries(
						Object.entries(next[nr] ?? {}).filter(([number]) => Number(number) > lap - KEPT_LAPS),
					);
					const entry = car[lap] ?? { times: [null, null, null], done: null };
					const times = [...entry.times];
					times[index] = seconds;

					car[lap] = { times, done: index === 2 ? Date.now() : entry.done };
					next[nr] = car;
				});
			}

			if (next) useSectorStore.getState().setLaps(next);
		};

		record(useDataStore.getState().state);
		return useDataStore.subscribe((store, prev) => {
			if (store.state !== prev.state) record(store.state);
		});
	}, []);
};
