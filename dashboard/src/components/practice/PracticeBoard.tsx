"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";

import { getTrackStatusMessage } from "@/lib/getTrackStatusMessage";
import { classifyLaps, getLongRuns, type PracticeLap } from "@/lib/practice";
import { getRemainingMs } from "@/lib/qualifyingBoard";

import { useDataStore } from "@/stores/useDataStore";
import { useLapHistoryStore } from "@/stores/useLapHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

import BestLaps from "@/components/practice/BestLaps";
import type { Compound } from "@/components/practice/CompoundFilter";
import LongRuns from "@/components/practice/LongRuns";

const COMPOUND_ORDER: Compound[] = ["SOFT", "MEDIUM", "HARD", "INTERMEDIATE", "WET"];

function useNow(interval: number) {
	const [now, setNow] = useState<number>(() => Date.now());

	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), interval);
		return () => clearInterval(timer);
	}, [interval]);

	return now;
}

function formatClock(ms: number) {
	const seconds = Math.max(0, Math.ceil(ms / 1000));
	const minutes = Math.floor(seconds / 60);
	return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export default function PracticeBoard() {
	const state = useDataStore((store) => store.state);
	const history = useLapHistoryStore((store) => store.laps);
	const delay = useSettingsStore((store) => store.delay);
	const now = useNow(1000);

	const lines = state?.TimingData?.Lines;
	const appData = state?.TimingAppData?.Lines;

	const laps = useMemo(() => {
		const result: Record<string, PracticeLap[]> = {};
		for (const [nr, driver] of Object.entries(lines ?? {})) {
			result[nr] = classifyLaps(history[nr], appData?.[nr], driver.NumberOfLaps);
		}
		return result;
	}, [appData, history, lines]);

	const runs = useMemo(
		() => Object.entries(laps).flatMap(([nr, driverLaps]) => getLongRuns(nr, driverLaps, appData?.[nr])),
		[appData, laps],
	);

	// only the compounds run in the session are offered as filters
	const compounds = useMemo(() => {
		const used = new Set(
			Object.values(appData ?? {}).flatMap((driver) => (driver.Stints ?? []).map((stint) => stint.Compound)),
		);
		return COMPOUND_ORDER.filter((compound) => used.has(compound));
	}, [appData]);

	if (!state?.TimingData || !state.DriverList || !state.SessionInfo) {
		return (
			<div className="flex flex-col gap-2">
				<div className="h-20 animate-pulse rounded-lg bg-zinc-900" />
				<div className="h-96 animate-pulse rounded-lg bg-zinc-900" />
			</div>
		);
	}

	const practice = state.SessionInfo.Type === "Practice";
	const trackStatus = getTrackStatusMessage(state.TrackStatus?.Status ? parseInt(state.TrackStatus.Status) : undefined);
	const running = state.SessionStatus?.Status === "Started";
	// the state shown is delayed, so is its clock
	const remaining = getRemainingMs(state.ExtrapolatedClock, now - delay * 1000);
	const seen = Object.values(history).reduce((sum, driverLaps) => sum + driverLaps.length, 0);
	const onTrack = Object.values(state.TimingData.Lines).filter(
		(driver) => !driver.InPit && !driver.Stopped && !driver.Retired,
	).length;

	return (
		<>
			<div className="rounded-lg border border-zinc-800 p-3">
				<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
					<div className="flex items-end gap-3">
						<span className="text-2xl leading-none font-black">{state.SessionInfo.Name ?? "Practice"}</span>
						<span className="text-4xl leading-none font-black tabular-nums">
							{remaining !== null ? formatClock(remaining) : "-:--"}
						</span>
					</div>

					<div className="flex items-center gap-3 text-xs text-zinc-400">
						{running && <span>{onTrack} on track</span>}
						{!running && <span>{state.SessionStatus?.Status ?? "Not running"}</span>}
						{trackStatus && (
							<span className="flex items-center gap-1">
								<span className={clsx("h-1.5 w-1.5 rounded-full", trackStatus.color)} />
								{trackStatus.message}
							</span>
						)}
					</div>
				</div>

				<p className="mt-2 text-xs text-zinc-500">
					{!practice && "Made for free practice, the current session works too. "}
					Tyres and long runs come from the {seen} laps seen on this page, laps run before it was opened are missing.
				</p>
			</div>

			<BestLaps state={state} laps={laps} runs={runs} compounds={compounds} />
			<LongRuns state={state} runs={runs} compounds={compounds} />
		</>
	);
}
