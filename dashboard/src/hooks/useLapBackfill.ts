"use client";

import { useEffect } from "react";

import type { RecordedLaps } from "@/server/lapRecorder";

import { useDataStore } from "@/stores/useDataStore";
import { useLapHistoryStore } from "@/stores/useLapHistoryStore";

const INTERVAL_MS = 30_000;
// lets the lap history switch to a new session first
const SESSION_WAIT_MS = 2000;

/**
 * fills the lap history with the laps the server recorded, also those run before the page was opened
 */
export const useLapBackfill = () => {
	useEffect(() => {
		let stopped = false;

		const backfill = async () => {
			const sessionKey = useDataStore.getState().state?.SessionInfo?.Key ?? null;
			if (sessionKey === null || useLapHistoryStore.getState().sessionKey !== sessionKey) return;

			try {
				const response = await fetch("/api/laps", { cache: "no-store" });
				if (!response.ok) return;

				const recorded = (await response.json()) as RecordedLaps;
				if (stopped || recorded.sessionKey !== sessionKey) return;

				// the state shown is delayed, the laps after it are not shown yet
				const lines = useDataStore.getState().state?.TimingData?.Lines ?? {};
				const shownLaps = Object.fromEntries(
					Object.values(lines)
						.filter((driver) => typeof driver.NumberOfLaps === "number")
						.map((driver) => [driver.RacingNumber, driver.NumberOfLaps]),
				);

				useLapHistoryStore.getState().mergeRecorded(sessionKey, recorded.laps, shownLaps);
			} catch {
				// the server may not record, the laps seen here are still kept
			}
		};

		const timer = setInterval(backfill, INTERVAL_MS);
		let wait: ReturnType<typeof setTimeout> | null = null;

		const unsubscribe = useDataStore.subscribe((store, prev) => {
			if (store.state?.SessionInfo?.Key === prev.state?.SessionInfo?.Key) return;

			if (wait) clearTimeout(wait);
			wait = setTimeout(backfill, SESSION_WAIT_MS);
		});

		return () => {
			stopped = true;
			clearInterval(timer);
			if (wait) clearTimeout(wait);
			unsubscribe();
		};
	}, []);
};
