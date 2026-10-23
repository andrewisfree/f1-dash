"use client";

import { useMemo } from "react";
import clsx from "clsx";

import type { TimingStats } from "@/types/state.type";

import { computeGapsSeconds, getOrderedTimingDrivers, parseLapSeconds } from "@/lib/gaps";
import { getTrackStatusMessage } from "@/lib/getTrackStatusMessage";
import { buildCarView, getMode, type CarView } from "@/lib/pitwall";
import { classifyLaps, formatLapTime, getLongRuns } from "@/lib/practice";
import {
	buildBoard,
	formatClock,
	getBestSectors,
	getOutLapMs,
	getPushLap,
	getRemainingMs,
} from "@/lib/qualifyingBoard";
import { formatSigned, isNeutralized, isOffLeadLap } from "@/lib/race";
import { getDriverFlags } from "@/lib/raceControl";
import { degradationTone, TONE_TEXT } from "@/lib/tones";

import { useDataStore } from "@/stores/useDataStore";
import { useLapHistoryStore } from "@/stores/useLapHistoryStore";
import { usePitWallStore } from "@/stores/usePitWallStore";
import { useQualifyingStore } from "@/stores/useQualifyingStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

import { useNow } from "@/hooks/useNow";

import { RaceControlMessage } from "@/components/dashboard/RaceControlMessage";
import RadioMessage from "@/components/dashboard/RadioMessage";
import { Card } from "@/components/panel/Panel";
import CarPanel from "@/components/pitwall/CarPanel";

const MODE_LABEL = { race: "Race", qualifying: "Qualifying", practice: "Practice" };

export default function PitWall() {
	const state = useDataStore((store) => store.state);
	const history = useLapHistoryStore((store) => store.laps);
	const favoriteDrivers = useSettingsStore((store) => store.favoriteDrivers);
	const pitLoss = useSettingsStore((store) => store.verticalPitLoss);
	const selectedTeam = usePitWallStore((store) => store.team);
	const setTeam = usePitWallStore((store) => store.setTeam);
	const delay = useSettingsStore((store) => store.delay);
	const outLaps = useQualifyingStore((store) => store.outLaps);
	const now = useNow(1000);

	const lines = state?.TimingData?.Lines;
	const drivers = state?.DriverList;
	const appData = state?.TimingAppData?.Lines;
	const mode = getMode(state?.SessionInfo?.Type);

	const ordered = useMemo(() => getOrderedTimingDrivers(lines), [lines]);
	const gaps = useMemo(
		() => computeGapsSeconds(ordered, state?.TimingData?.SessionPart),
		[ordered, state?.TimingData?.SessionPart],
	);
	const flags = useMemo(
		() => getDriverFlags(state?.RaceControlMessages?.Messages),
		[state?.RaceControlMessages?.Messages],
	);
	const board = useMemo(() => buildBoard(state?.TimingData), [state?.TimingData]);

	// long runs of every driver, to rank the team against the others
	const runs = useMemo(
		() =>
			ordered.flatMap((driver) => {
				const nr = driver.RacingNumber;
				return getLongRuns(nr, classifyLaps(history[nr], appData?.[nr], driver.NumberOfLaps), appData?.[nr]);
			}),
		[appData, history, ordered],
	);

	const teams = useMemo(() => {
		const byName = new Map<string, { name: string; colour: string; cars: string[] }>();
		// the driver list also carries partial entries without a team
		const listed = Object.values(drivers ?? {}).filter((driver) => driver?.RacingNumber && driver.TeamName);
		for (const driver of listed.sort((a, b) => a.Line - b.Line)) {
			const team = byName.get(driver.TeamName) ?? { name: driver.TeamName, colour: driver.TeamColour, cars: [] };
			team.cars.push(driver.RacingNumber);
			byName.set(driver.TeamName, team);
		}
		return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
	}, [drivers]);

	if (!state?.TimingData || !drivers || !lines || !state.SessionInfo) {
		return (
			<div className="flex flex-col gap-2">
				<div className="h-12 animate-pulse rounded-lg bg-zinc-900" />
				<div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
					<div className="h-96 animate-pulse rounded-lg bg-zinc-900" />
					<div className="h-96 animate-pulse rounded-lg bg-zinc-900" />
				</div>
			</div>
		);
	}

	const favoriteTeam = favoriteDrivers.map((nr) => drivers[nr]?.TeamName).find(Boolean);
	const team =
		teams.find((entry) => entry.name === selectedTeam) ??
		teams.find((entry) => entry.name === favoriteTeam) ??
		teams[0];
	const tla = (nr: string) => drivers[nr]?.Tla ?? nr;
	const lapsRemaining = state.LapCount ? state.LapCount.TotalLaps - state.LapCount.CurrentLap : null;

	const leadLap = ordered
		.filter((entry) => !isOffLeadLap(entry))
		.map((entry) => ({ nr: entry.RacingNumber, gap: gaps.get(entry.RacingNumber) ?? 0 }));

	const cars = (team?.cars ?? [])
		.filter((nr) => lines[nr])
		.map((nr) =>
			buildCarView(nr, {
				ordered,
				gaps,
				leadLap,
				history,
				stints: Object.fromEntries(Object.entries(appData ?? {}).map(([key, value]) => [key, value.Stints ?? []])),
				runs,
				mode,
				neutralized: isNeutralized(state.TrackStatus?.Status),
				lapsRemaining,
				pitLoss,
				isOffLeadLap,
			}),
		)
		.filter((car): car is CarView => car !== null);

	const numbers = cars.map((car) => car.nr);
	const messages = (state.RaceControlMessages?.Messages ?? [])
		.filter((msg) => numbers.some((nr) => new RegExp(`\\b${nr} \\(`).test(msg.Message)))
		.sort((a, b) => b.Utc.localeCompare(a.Utc))
		.slice(0, 20);
	const radios = (state.TeamRadio?.Captures ?? [])
		.filter((capture) => numbers.includes(capture.RacingNumber))
		.sort((a, b) => b.Utc.localeCompare(a.Utc))
		.slice(0, 10);
	const gmtOffset = state.SessionInfo.GmtOffset;
	const trackStatus = getTrackStatusMessage(state.TrackStatus?.Status ? parseInt(state.TrackStatus.Status) : undefined);
	const weather = state.WeatherData;
	const raining = weather?.Rainfall !== undefined && weather.Rainfall !== "0";

	// the state shown is delayed, so is its clock
	const remaining = mode === "qualifying" ? getRemainingMs(state.ExtrapolatedClock, now - delay * 1000) : null;
	const outLap = getOutLapMs(outLaps, board.fastest);
	const lastCall =
		remaining !== null && outLap !== null && state.SessionStatus?.Status === "Started" ? remaining - outLap : null;

	return (
		<>
			<div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 p-2">
				<div className="no-scrollbar flex gap-1 overflow-x-auto">
					{teams.map((entry) => (
						<button
							key={`team.${entry.name}`}
							type="button"
							onClick={() => setTeam(entry.name)}
							className={clsx(
								"flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-1.5 text-sm",
								entry.name === team?.name ? "border-zinc-200 bg-zinc-800" : "border-transparent hover:bg-zinc-900",
							)}
						>
							<span className="h-4 w-1.5 rounded-full" style={{ backgroundColor: `#${entry.colour}` }} />
							{entry.name}
						</button>
					))}
				</div>

				<div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400">
					<span className="font-semibold text-zinc-200">{state.SessionInfo.Name ?? MODE_LABEL[mode]}</span>
					{mode === "race" && state.LapCount && (
						<span className="tabular-nums">
							Lap {state.LapCount.CurrentLap}/{state.LapCount.TotalLaps}
						</span>
					)}
					{trackStatus && (
						<span className="flex items-center gap-1">
							<span className={clsx("h-1.5 w-1.5 rounded-full", trackStatus.color)} />
							{trackStatus.message}
						</span>
					)}
					{weather && (
						<span className="tabular-nums">
							Track {weather.TrackTemp}° · Air {weather.AirTemp}° · Wind {weather.WindSpeed} m/s
						</span>
					)}
					{remaining !== null && (
						<span className="font-semibold text-zinc-200 tabular-nums">
							{board.part ? `Q${board.part} ` : ""}
							{formatClock(remaining)}
						</span>
					)}
					{lastCall !== null && (
						<span
							className={clsx("rounded px-1.5 py-0.5 font-semibold tabular-nums", {
								"bg-zinc-800 text-zinc-200": lastCall > 60_000,
								"bg-amber-500/20 text-amber-300": lastCall > 0 && lastCall <= 60_000,
								"bg-red-500/20 text-red-300": lastCall <= 0,
							})}
						>
							{lastCall > 0 ? `Last call ${formatClock(lastCall)}` : "Too late to start a lap"}
						</span>
					)}
					{raining && <span className="rounded bg-sky-500/20 px-1.5 py-0.5 font-semibold text-sky-300">RAIN</span>}
				</div>
			</div>

			<div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
				{cars.map((car) => {
					const row = board.rows.find((entry) => entry.driver.RacingNumber === car.nr) ?? null;

					return (
						<CarPanel
							key={`car.${car.nr}`}
							car={car}
							mode={mode}
							meta={drivers[car.nr]}
							stats={state.TimingStats?.Lines?.[car.nr]}
							flags={flags.get(car.nr)}
							tla={tla}
							pitLoss={pitLoss}
							qualifying={{
								row,
								push:
									mode === "qualifying" && row
										? getPushLap(row, getBestSectors(state.TimingStats, car.nr), board.rows)
										: null,
								cutoff: board.cutoff,
								lastCall,
							}}
						/>
					);
				})}
			</div>

			{cars.length === 2 && <Teammates cars={cars as [CarView, CarView]} timingStats={state.TimingStats} tla={tla} />}

			<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
				<Card title="Race control about the team" className="max-h-[24rem] overflow-y-auto">
					{messages.length === 0 && <p className="text-sm text-zinc-600">No messages about these cars.</p>}
					{gmtOffset && (
						<ul className="flex flex-col gap-1">
							{messages.map((msg) => (
								<RaceControlMessage key={`msg.${msg.Utc}.${msg.Message}`} msg={msg} gmtOffset={gmtOffset} />
							))}
						</ul>
					)}
				</Card>

				<Card title="Team radio" className="max-h-[24rem] overflow-y-auto">
					{radios.length === 0 && <p className="text-sm text-zinc-600">No team radio yet.</p>}
					{gmtOffset && (
						<ul className="flex flex-col gap-2">
							{radios.map((capture) => {
								const meta = drivers[capture.RacingNumber];
								return meta ? (
									<RadioMessage
										key={`radio.${capture.Utc}`}
										driver={meta}
										capture={capture}
										basePath={`https://livetiming.formula1.com/static/${state.SessionInfo?.Path}`}
										gmtOffset={gmtOffset}
									/>
								) : null;
							})}
						</ul>
					)}
				</Card>
			</div>
		</>
	);
}

type TeammatesProps = {
	cars: [CarView, CarView];
	timingStats: TimingStats | undefined;
	tla: (nr: string) => string;
};

/**
 * the two cars of the team side by side, the better value of each row in green
 */
function Teammates({ cars: [first, second], timingStats, tla }: TeammatesProps) {
	const stats = timingStats?.Lines;
	const sectors = (nr: string) => getBestSectors(timingStats, nr);
	const speed = (nr: string) => {
		const value = stats?.[nr]?.BestSpeeds?.ST?.Value;
		return value ? parseFloat(value) : null;
	};
	const sameCompound = first.longRun && second.longRun && first.longRun.compound === second.longRun.compound;

	const rows: {
		label: string;
		a: number | null;
		b: number | null;
		format: (value: number) => string;
		higherIsBetter?: boolean;
	}[] = [
		{
			label: "Best lap",
			a: parseLapSeconds(first.driver.BestLapTime?.Value),
			b: parseLapSeconds(second.driver.BestLapTime?.Value),
			format: formatLapTime,
		},
		...[0, 1, 2].map((index) => ({
			label: `Best S${index + 1}`,
			a: sectors(first.nr)[index] ?? null,
			b: sectors(second.nr)[index] ?? null,
			format: (value: number) => value.toFixed(3),
		})),
		{
			label: "Top speed",
			a: speed(first.nr),
			b: speed(second.nr),
			format: (value) => `${value}`,
			higherIsBetter: true,
		},
		{ label: "Pace, 3 laps", a: first.pace, b: second.pace, format: formatLapTime },
		{
			label: sameCompound ? `Long run, ${first.longRun!.compound?.toLowerCase()}` : "Long run",
			a: sameCompound ? first.longRun!.average : null,
			b: sameCompound ? second.longRun!.average : null,
			format: formatLapTime,
		},
	];

	const degA = first.degradation(first.stints.length);
	const degB = second.degradation(second.stints.length);

	return (
		<Card title={`${tla(first.nr)} against ${tla(second.nr)}, the better of the two in green`}>
			<div className="grid grid-cols-[1fr_auto_1fr] gap-x-3 gap-y-1 text-sm tabular-nums">
				{rows.map((row) => {
					const delta = row.a !== null && row.b !== null ? row.a - row.b : null;
					const aBetter = delta !== null && Math.abs(delta) > 0.0005 && (row.higherIsBetter ? delta > 0 : delta < 0);
					const bBetter = delta !== null && Math.abs(delta) > 0.0005 && !aBetter;

					return (
						<div key={`mate.${row.label}`} className="contents">
							<span className={clsx("text-right", aBetter ? "font-semibold text-emerald-400" : "text-zinc-300")}>
								{row.a !== null ? row.format(row.a) : "-"}
							</span>
							<span className="text-center text-xs text-zinc-500">
								{row.label}
								{delta !== null && Math.abs(delta) > 0.0005 && (
									<span className="ml-1 text-zinc-400">
										{row.higherIsBetter
											? Math.abs(delta).toFixed(0)
											: formatSigned(Math.abs(delta), 3).replace("+", "")}
									</span>
								)}
							</span>
							<span className={clsx(bBetter ? "font-semibold text-emerald-400" : "text-zinc-300")}>
								{row.b !== null ? row.format(row.b) : "-"}
							</span>
						</div>
					);
				})}
				<span className={clsx("text-right", TONE_TEXT[degradationTone(degA)])}>
					{degA !== null ? formatSigned(degA, 2) : "-"}
				</span>
				<span className="text-center text-xs text-zinc-500">Deg this set</span>
				<span className={TONE_TEXT[degradationTone(degB)]}>{degB !== null ? formatSigned(degB, 2) : "-"}</span>
			</div>
		</Card>
	);
}
