"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";

import type { Stint, TimingDataDriver } from "@/types/state.type";

import { computeGapsSeconds, getOrderedTimingDrivers, parseLapSeconds, parseLapsDown } from "@/lib/gaps";
import { buildLapLog, getStintDegradation, type LapLogRow } from "@/lib/lapLog";
import { formatLapTime, practiceDigits } from "@/lib/practice";
import {
	describeStatus,
	describeTrend,
	formatSigned,
	getPace,
	getPitWindow,
	isNeutralized,
	isOffLeadLap,
	type Trend,
} from "@/lib/race";
import { getDriverFlags } from "@/lib/raceControl";
import { describeUndercut, getUndercuts } from "@/lib/undercut";
import { tireIcon } from "@/lib/tires";
import {
	degradationTone,
	deltaTone,
	heatChip,
	lapTone,
	rivalTone,
	sectorTone,
	TONE_CHIP,
	TONE_TEXT,
} from "@/lib/tones";

import { useDataStore } from "@/stores/useDataStore";
import { useLapHistoryStore, type LapSample } from "@/stores/useLapHistoryStore";
import { useNow } from "@/hooks/useNow";
import { useRivalStore } from "@/stores/useRivalStore";
import { useSectorStore, type SectorLap } from "@/stores/useSectorStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

import { RaceControlMessage } from "@/components/dashboard/RaceControlMessage";
import RadioMessage from "@/components/dashboard/RadioMessage";
import Badge from "@/components/driver/Badge";
import DriverCarMetrics from "@/components/driver/DriverCarMetrics";
import LapChart, { type LapChartPoint, type LapChartSeries } from "@/components/driver/LapChart";
import Footer from "@/components/Footer";
import { Card, Delta, StintStrip } from "@/components/panel/Panel";

// chart colors follow the role, the selected driver and the cars compared with it
// green and purple are left to improved and best laps
const COLOR_DRIVER = "#3987e5";
const COLOR_AHEAD = "#c98500";
const COLOR_BEHIND = "#d55181";

// smaller changes of the gap are timing noise
const MIN_GAIN = 0.02;

const COLOR_PINNED = "#a1a1aa";

const LAP_LOG_SIZE = 20;

// the lap delta stays this long once both cars crossed the line
const LAP_FLASH_MS = 4000;
// a smaller change of the gap over the stint is shown as even, and fewer laps say nothing yet
const STINT_CHANGE_SECONDS = 0.3;
const STINT_CHANGE_LAPS = 3;

type Props = {
	nr: string | null;
};

type Rival = {
	driver: TimingDataDriver;
	// the car right ahead, right behind or one pinned anywhere
	key: "ahead" | "behind" | "pinned";
	role: "ahead" | "behind";
	pinned: boolean;
	interval: number | null;
	trend: Trend | null;
	// race pace of the rival, see getPace
	pace: number | null;
};

function formatLap(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	const rest = (seconds - minutes * 60).toFixed(3).padStart(6, "0");
	return minutes > 0 ? `${minutes}:${rest}` : rest;
}

// gap to another car per lap, positive while that car is ahead
// only for laps both have a known gap to the leader
function gapSeries(own: LapSample[] | undefined, other: LapSample[] | undefined): LapChartPoint[] {
	const otherByLap = new Map((other ?? []).map((sample) => [sample.lap, sample]));

	const points: LapChartPoint[] = (own ?? []).flatMap((sample) => {
		const rival = otherByLap.get(sample.lap);
		return sample.gap !== null && rival && rival.gap !== null
			? [{ lap: sample.lap, value: sample.gap - rival.gap }]
			: [];
	});

	// a falling value means time gained on the other car, whether it is ahead or behind
	let best: LapChartPoint | null = null;
	let bestGain = MIN_GAIN;

	for (let i = 1; i < points.length; i++) {
		if (points[i].lap - points[i - 1].lap !== 1) continue;

		const gain = points[i - 1].value - points[i].value;
		if (gain <= MIN_GAIN) continue;

		points[i].tone = "improved";
		if (gain > bestGain) {
			best = points[i];
			bestGain = gain;
		}
	}

	if (best) best.tone = "best";
	return points;
}

// laps with a pit stop or behind the safety car would flatten the rest of the chart
function lapTimeSeries(samples: LapSample[] | undefined, fastest: number | null): LapChartPoint[] {
	return (samples ?? []).flatMap((sample): LapChartPoint[] => {
		if (!sample.clean || sample.lapTime === null) return [];

		const isFastest = fastest !== null && Math.abs(sample.lapTime - fastest) < 0.0005;
		const tone = isFastest ? "best" : sample.personalBest ? "improved" : undefined;

		return [{ lap: sample.lap, value: sample.lapTime, tone }];
	});
}

export default function DriverFocus({ nr: requested }: Props) {
	const state = useDataStore((store) => store.state);
	const carsData = useDataStore((store) => store.carsData);
	const history = useLapHistoryStore((store) => store.laps);
	const favoriteDrivers = useSettingsStore((store) => store.favoriteDrivers);
	const pitLoss = useSettingsStore((store) => store.verticalPitLoss);
	const pinnedRival = useRivalStore((store) => store.rival);
	const setPinnedRival = useRivalStore((store) => store.setRival);
	// the set whose laps show under the stints, the current one until another is picked
	const [pickedStint, setPickedStint] = useState<{ nr: string; stint: number | null } | null>(null);
	const sectorLaps = useSectorStore((store) => store.laps);
	const now = useNow(500);

	const lines = state?.TimingData?.Lines;
	const sessionPart = state?.TimingData?.SessionPart;
	const isRace = state?.SessionInfo?.Type === "Race";
	const neutralized = isNeutralized(state?.TrackStatus?.Status);
	const lapsRemaining = state?.LapCount ? state.LapCount.TotalLaps - state.LapCount.CurrentLap : null;

	const ordered = useMemo(() => getOrderedTimingDrivers(lines), [lines]);
	const gaps = useMemo(() => computeGapsSeconds(ordered, sessionPart), [ordered, sessionPart]);
	const flags = useMemo(
		() => getDriverFlags(state?.RaceControlMessages?.Messages),
		[state?.RaceControlMessages?.Messages],
	);

	const nr =
		(requested && lines?.[requested] ? requested : null) ??
		favoriteDrivers.find((favorite) => lines?.[favorite]) ??
		ordered[0]?.RacingNumber ??
		null;

	const index = ordered.findIndex((driver) => driver.RacingNumber === nr);
	const driver = ordered[index];
	const pinned =
		pinnedRival && pinnedRival !== nr ? ordered.find((entry) => entry.RacingNumber === pinnedRival) : undefined;

	const rivals = useMemo(() => {
		if (!driver) return [];

		// gaps to the leader only compare between cars on the lead lap
		const comparable = (other: TimingDataDriver) => !isRace || (!isOffLeadLap(driver) && !isOffLeadLap(other));

		// a pinned rival stays compared however the positions change, next to the cars around
		const candidates: { other: TimingDataDriver | undefined; key: Rival["key"] }[] = [
			{ other: ordered[index - 1], key: "ahead" },
			{ other: ordered[index + 1], key: "behind" },
		];
		if (pinned && !candidates.some(({ other }) => other?.RacingNumber === pinned.RacingNumber)) {
			candidates.push({ other: pinned, key: "pinned" });
		}

		const found = candidates.flatMap(({ other, key }): Rival[] => {
			if (!other) return [];
			const role = parseInt(other.Position) < parseInt(driver.Position) ? "ahead" : "behind";

			const interval = comparable(other)
				? Math.abs((gaps.get(driver.RacingNumber) ?? 0) - (gaps.get(other.RacingNumber) ?? 0))
				: null;
			const [ahead, behind] = role === "ahead" ? [other, driver] : [driver, other];
			const trend =
				isRace && !neutralized && interval !== null
					? describeTrend(history[behind.RacingNumber], history[ahead.RacingNumber], interval, lapsRemaining)
					: null;

			return [
				{
					driver: other,
					key,
					role,
					pinned: other.RacingNumber === pinned?.RacingNumber,
					interval,
					trend,
					pace: getPace(history[other.RacingNumber]),
				},
			];
		});
		return found.sort((a, b) => parseInt(a.driver.Position) - parseInt(b.driver.Position));
	}, [driver, gaps, history, index, isRace, lapsRemaining, neutralized, ordered, pinned]);

	const leadLap = useMemo(
		() =>
			ordered
				.filter((entry) => !isOffLeadLap(entry))
				.map((entry) => ({ nr: entry.RacingNumber, gap: gaps.get(entry.RacingNumber) ?? 0 })),
		[gaps, ordered],
	);

	const pitWindow = useMemo(
		() => (isRace && nr ? getPitWindow(leadLap, nr, pitLoss) : null),
		[isRace, leadLap, nr, pitLoss],
	);

	const undercuts = useMemo(
		() => getUndercuts(history, state?.LapCount?.CurrentLap ?? null, pitLoss),
		[history, pitLoss, state?.LapCount?.CurrentLap],
	);

	const charts = useMemo(() => {
		if (!nr) return { gap: [], lapTime: [] };

		const timingLines = state?.TimingData?.Lines;
		const statsLines = state?.TimingStats?.Lines;
		const name = (number: string) => state?.DriverList?.[number]?.Tla ?? number;
		const label = (rival: Rival) =>
			rival.key === "pinned" ? name(rival.driver.RacingNumber) : `${name(rival.driver.RacingNumber)} (${rival.key})`;
		const color = (rival: Rival) =>
			rival.key === "pinned" ? COLOR_PINNED : rival.key === "ahead" ? COLOR_AHEAD : COLOR_BEHIND;
		// the fastest lap of the session, if this driver holds it
		const fastest = (number: string) =>
			statsLines?.[number]?.PersonalBestLapTime?.Position === 1
				? parseLapSeconds(timingLines?.[number]?.BestLapTime?.Value)
				: null;

		const gap: LapChartSeries[] = rivals.map((rival) => ({
			key: rival.key,
			label: label(rival),
			color: color(rival),
			points: gapSeries(history[nr], history[rival.driver.RacingNumber]),
		}));

		const lapTime: LapChartSeries[] = [
			{
				key: "driver",
				label: name(nr),
				color: COLOR_DRIVER,
				points: lapTimeSeries(history[nr], fastest(nr)),
			},
			...rivals.map((rival) => ({
				key: rival.key,
				label: label(rival),
				color: color(rival),
				points: lapTimeSeries(history[rival.driver.RacingNumber], fastest(rival.driver.RacingNumber)),
			})),
		];

		return { gap, lapTime };
	}, [history, nr, rivals, state?.DriverList, state?.TimingData?.Lines, state?.TimingStats?.Lines]);

	if (!state?.TimingData || !state.DriverList || !driver || !nr) {
		return (
			<div className="flex flex-col gap-2">
				<div className="h-10 animate-pulse rounded-lg bg-zinc-900" />
				<div className="h-40 animate-pulse rounded-lg bg-zinc-900" />
				<div className="h-64 animate-pulse rounded-lg bg-zinc-900" />
			</div>
		);
	}

	const drivers = state.DriverList;
	const meta = drivers[nr];
	const tla = (number: string) => drivers[number]?.Tla ?? number;
	const teamColour = `#${meta?.TeamColour ?? "71717a"}`;

	const appData = state.TimingAppData?.Lines[nr];
	const stints = appData?.Stints ?? [];
	const stint = stints[stints.length - 1];
	const driverFlags = flags.get(nr);
	const carData = carsData?.[nr]?.Channels;

	const position = parseInt(driver.Position);
	const gridPosition = appData?.GridPos ? parseInt(appData.GridPos) : NaN;
	const gained = isRace && Number.isFinite(gridPosition) ? gridPosition - position : null;
	const lapsDown = parseLapsDown(driver.GapToLeader);
	const gapToLeader = gaps.get(nr) ?? 0;
	const out = driver.Retired || driver.Stopped;

	const samples = history[nr] ?? [];
	const pace = getPace(samples);
	const logRows = buildLapLog(samples, appData, driver.NumberOfLaps);
	const degradation = (stintNumber: number) => getStintDegradation(logRows, stintNumber);
	const currentDegradation = degradation(stints.length);
	const shownStint = pickedStint?.nr === nr ? pickedStint.stint : stints.length || null;

	const aheadRival = rivals.find((rival) => rival.key === "ahead");
	const behindRival = rivals.find((rival) => rival.key === "behind");
	const status =
		isRace && !out
			? describeStatus(
					aheadRival ? { tla: tla(aheadRival.driver.RacingNumber), trend: aheadRival.trend } : null,
					behindRival ? { tla: tla(behindRival.driver.RacingNumber), trend: behindRival.trend } : null,
				)
			: null;
	const lapText = isRace && state.LapCount ? `Lap ${state.LapCount.CurrentLap}/${state.LapCount.TotalLaps}` : null;

	const lapLog = logRows.slice(-LAP_LOG_SIZE).reverse();
	const gapColumns = charts.gap.map((series) => ({
		series,
		byLap: new Map(series.points.map((point) => [point.lap, point])),
	}));

	const messages = (state.RaceControlMessages?.Messages ?? [])
		.filter((msg) => new RegExp(`\\b${nr} \\(`).test(msg.Message))
		.sort((a, b) => b.Utc.localeCompare(a.Utc));
	const radios = (state.TeamRadio?.Captures ?? [])
		.filter((capture) => capture.RacingNumber === nr)
		.sort((a, b) => b.Utc.localeCompare(a.Utc))
		.slice(0, 10);
	const gmtOffset = state.SessionInfo?.GmtOffset;

	return (
		<div className="flex w-full flex-col gap-2">
			<div className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-zinc-800 p-1.5">
				{ordered.map((entry) => (
					<Link
						key={`select.${entry.RacingNumber}`}
						href={`/dashboard/driver/${entry.RacingNumber}`}
						className={clsx("flex shrink-0 items-center gap-1 rounded-md border px-2 py-1.5", {
							"border-zinc-200 bg-zinc-800": entry.RacingNumber === nr,
							"border-transparent hover:bg-zinc-900": entry.RacingNumber !== nr,
						})}
					>
						<span className="text-xs text-zinc-500 tabular-nums">{entry.Position}</span>
						<span
							className="h-4 w-1 rounded-full"
							style={{ backgroundColor: `#${drivers[entry.RacingNumber]?.TeamColour ?? "71717a"}` }}
						/>
						<span className="font-mono text-sm font-black">{tla(entry.RacingNumber)}</span>
					</Link>
				))}
			</div>

			<div className="rounded-lg border border-zinc-800 p-3">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-3">
						<span className="text-5xl leading-none font-black tabular-nums">P{driver.Position}</span>
						<span className="h-12 w-1.5 rounded-full" style={{ backgroundColor: teamColour }} />
						<div>
							<p className="text-xl leading-tight font-semibold">{meta?.FullName ?? tla(nr)}</p>
							<p className="text-sm text-zinc-500">
								{meta?.TeamName} · #{nr}
							</p>
						</div>
					</div>

					<div className="flex flex-wrap items-center gap-1.5">
						{out && <Badge className="border-zinc-500 text-zinc-300">OUT</Badge>}
						{(driver.InPit || driver.PitOut) && (
							<Badge className="border-sky-500 text-sky-400">{driver.PitOut ? "PIT EXIT" : "IN PIT"}</Badge>
						)}
						{driverFlags && driverFlags.penalty > 0 && (
							<Badge className="border-red-500 text-red-400">+{driverFlags.penalty}s PENALTY</Badge>
						)}
						{driverFlags?.investigation && <Badge className="border-amber-500 text-amber-400">INVESTIGATION</Badge>}
						{driverFlags?.warning && <Badge className="border-zinc-300 text-zinc-200">BLACK AND WHITE</Badge>}
						{driverFlags && driverFlags.trackLimits > 0 && (
							<Badge
								className={
									driverFlags.trackLimits >= 3 ? "border-amber-500 text-amber-400" : "border-zinc-700 text-zinc-400"
								}
							>
								TRACK LIMITS {driverFlags.trackLimits}
							</Badge>
						)}
						{carData && <DriverCarMetrics carData={carData} />}
					</div>
				</div>

				{(status || lapText) && (
					<div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
						{status && (
							<p
								className={clsx("font-semibold", {
									"text-emerald-400": status.tone === "attack",
									"text-red-400": status.tone === "warning",
									"text-zinc-300": status.tone === "neutral",
								})}
							>
								{status.text}
							</p>
						)}
						<p className="ml-auto flex gap-3 text-zinc-500 tabular-nums">
							{lapText && <span>{lapText}</span>}
							{!out && position > 1 && (
								<span>{lapsDown > 0 ? `+${lapsDown}L` : `+${gapToLeader.toFixed(1)}s`} to the leader</span>
							)}
						</p>
					</div>
				)}

				{stints.length > 0 && (
					<div className="mt-3">
						<StintStrip
							stints={stints}
							degradation={degradation}
							selected={shownStint}
							onSelect={(number) => setPickedStint({ nr, stint: number === shownStint ? null : number })}
						/>
						{shownStint !== null && (
							<StintLaps
								rows={logRows.filter((row) => row.stint === shownStint)}
								digits={practiceDigits(state.SessionInfo?.Type)}
							/>
						)}
					</div>
				)}
			</div>

			<label className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm">
				<span className="text-zinc-500">Pin a third car</span>
				<select
					className="rounded-lg bg-zinc-900 px-2 py-1.5 text-sm"
					value={pinned?.RacingNumber ?? ""}
					onChange={(event) => setPinnedRival(event.target.value || null)}
				>
					<option value="">Nobody</option>
					{ordered
						.filter((entry) => entry.RacingNumber !== nr)
						.map((entry) => (
							<option key={`rival.option.${entry.RacingNumber}`} value={entry.RacingNumber}>
								P{entry.Position} {tla(entry.RacingNumber)}
							</option>
						))}
				</select>
				{pinned && <span className="text-zinc-500">stays in the table when positions change</span>}
			</label>

			{rivals.length > 0 && (
				<Card title={`Around ${tla(nr)}: gap, trend, sectors and lap against each car`} className="overflow-x-auto">
					<table className="w-full text-right text-sm whitespace-nowrap tabular-nums [&_td]:px-1.5 [&_th]:px-1.5">
						<thead className="text-xs text-zinc-500">
							<tr>
								<th className="text-left font-normal">Car</th>
								<th className="font-normal" title={`seconds to ${tla(nr)}, negative when ahead`}>
									Gap
								</th>
								<th className="font-normal" title="change of the gap per lap, green when it goes the right way">
									Trend
								</th>
								<th
									className="hidden text-center font-normal sm:table-cell"
									title={`time ${tla(nr)} gained or lost in each sector of this lap, the lap at the line`}
								>
									Sectors
								</th>
								<th className="font-normal">Tyre</th>
								<th className="hidden font-normal md:table-cell">Last lap</th>
								<th
									className="hidden font-normal md:table-cell"
									title={`pace of ${tla(nr)} over the last 3 laps against the other car`}
								>
									Pace
								</th>
								<th
									className="hidden font-normal lg:table-cell"
									title="change of the gap since both cars are on their current sets"
								>
									Stint
								</th>
								<th className="hidden text-left font-normal lg:table-cell">Box</th>
							</tr>
						</thead>
						<tbody>
							{[
								...rivals.filter((rival) => rival.role === "ahead"),
								null,
								...rivals.filter((rival) => rival.role === "behind"),
							].map((rival) => {
								if (rival === null) {
									return (
										<tr key="self" className="bg-zinc-800/70 font-semibold">
											<td className="rounded-l px-1.5 py-1 text-left">
												<span className="mr-1 text-xs text-zinc-500">P{driver.Position}</span>
												<span className="font-mono font-black">{tla(nr)}</span>
												{gained !== null && gained !== 0 && (
													<span
														className={clsx("ml-1 text-[10px]", gained > 0 ? "text-emerald-400" : "text-red-400")}
														title="places since the start"
													>
														{gained > 0 ? `▲${gained}` : `▼${-gained}`}
													</span>
												)}
											</td>
											<td className="text-zinc-600">-</td>
											<td />
											<td className="hidden px-1 sm:table-cell">
												<span className="flex justify-center gap-0.5 text-xs">
													{driver.Sectors.slice(0, 3).map((sector, sectorIndex) => (
														<span
															key={`own.sector.${sectorIndex}`}
															className={clsx("w-14 rounded px-0.5 text-center", TONE_CHIP[sectorTone(sector)])}
														>
															{sector.Value || "·"}
														</span>
													))}
												</span>
											</td>
											<td>
												<TyreCell stint={stint} />
											</td>
											<td className={clsx("hidden md:table-cell", TONE_TEXT[lapTone(driver.LastLapTime)])}>
												{driver.LastLapTime?.Value || "-"}
											</td>
											<td className="hidden md:table-cell" title="average of the last 3 clean laps">
												{pace !== null ? formatLapTime(pace, 1) : "-"}
											</td>
											<td
												className={clsx(
													"hidden lg:table-cell",
													currentDegradation !== null
														? TONE_TEXT[degradationTone(currentDegradation)]
														: "text-zinc-600",
												)}
												title="tyre loss per lap on this set, fuel burn added back"
											>
												{currentDegradation !== null ? `deg ${formatSigned(currentDegradation, 2)}` : "-"}
											</td>
											<td className="hidden rounded-r px-1.5 text-left lg:table-cell">
												{pitWindow && !out ? (
													pitWindow.position === pitWindow.current ? (
														<span className="text-emerald-400">free stop</span>
													) : (
														<span className="text-zinc-300" title="where a stop now rejoins">
															P{pitWindow.position}
															{pitWindow.ahead && (
																<span className="font-normal text-zinc-500">
																	, {pitWindow.ahead.margin.toFixed(1)}s behind {tla(pitWindow.ahead.nr)}
																</span>
															)}
														</span>
													)
												) : (
													"-"
												)}
											</td>
										</tr>
									);
								}

								const other = rival.driver;
								const otherStints = state.TimingAppData?.Lines[other.RacingNumber]?.Stints ?? [];
								const otherStint = otherStints[otherStints.length - 1];
								const tyreAge = (otherStint?.TotalLaps ?? 0) - (stint?.TotalLaps ?? 0);
								const paceDelta = pace !== null && rival.pace !== null ? pace - rival.pace : null;
								const tone = rivalTone(rival.trend, rival.role);
								const duel = sectorDuel(
									sectorLaps[nr],
									sectorLaps[other.RacingNumber],
									(driver.NumberOfLaps ?? 0) + 1,
									now,
								);
								const change = stintChange(history[nr], history[other.RacingNumber]);
								// closer to the car ahead is good, closer to the car behind is not
								const changeTone =
									change === null || Math.abs(change.change) < STINT_CHANGE_SECONDS
										? "neutral"
										: change.change < 0 === (rival.role === "ahead")
											? "gain"
											: "loss";
								const undercut = undercuts.get(nr);
								const fight = undercut?.rival === other.RacingNumber ? undercut : undefined;

								return (
									<tr key={`rival.${other.RacingNumber}`} className="border-t border-zinc-800/60">
										<td className="px-1.5 py-1 text-left">
											<button
												type="button"
												className={clsx(
													"mr-1 cursor-pointer",
													rival.pinned ? "text-amber-400" : "text-zinc-700 hover:text-zinc-400",
												)}
												title={rival.pinned ? "unpin" : "pin, it stays compared when positions change"}
												onClick={() => setPinnedRival(rival.pinned ? null : other.RacingNumber)}
											>
												{rival.pinned ? "★" : "☆"}
											</button>
											<Link href={`/dashboard/driver/${other.RacingNumber}`}>
												<span className="mr-1 text-xs text-zinc-500">P{other.Position}</span>
												<span
													className="mr-1 inline-block h-3 w-1 rounded-full align-middle"
													style={{ backgroundColor: `#${drivers[other.RacingNumber]?.TeamColour ?? "71717a"}` }}
												/>
												<span className="font-mono font-black">{tla(other.RacingNumber)}</span>
											</Link>
										</td>
										<td className="font-semibold">
											{rival.interval !== null
												? formatSigned(rival.role === "ahead" ? -rival.interval : rival.interval, 3)
												: "-"}
										</td>
										<td className={clsx("text-xs", TONE_TEXT[tone])}>
											{rival.trend && rival.trend.tone !== "stable" ? `${formatSigned(rival.trend.rate, 2)}/L` : ""}
											{rival.trend?.drsLaps != null && (
												<span className="ml-1 font-black" title="laps until within a second at this rate">
													DRS in {rival.trend.drsLaps}L
												</span>
											)}
										</td>
										<td className="hidden px-1 sm:table-cell">
											<SectorDuelCell duel={duel} />
										</td>
										<td>
											<TyreCell stint={otherStint} age={tyreAge} />
										</td>
										<td className={clsx("hidden md:table-cell", TONE_TEXT[lapTone(other.LastLapTime)])}>
											{other.LastLapTime?.Value || "-"}
										</td>
										<td className="hidden md:table-cell">
											<Delta value={paceDelta} digits={2} />
										</td>
										<td className={clsx("hidden lg:table-cell", TONE_TEXT[changeTone])}>
											{change !== null ? `${formatSigned(change.change, 1)}s/${change.laps}L` : "-"}
										</td>
										<td className="hidden px-1.5 text-left lg:table-cell">
											{fight ? (
												<span className={fight.gain >= 0 ? "text-emerald-400" : "text-red-400"}>
													{describeUndercut(fight, tla)} {formatSigned(fight.gain, 1)}
												</span>
											) : (
												""
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</Card>
			)}

			{pitWindow && !out && (
				<Card title={`Pit window, ${pitLoss}s lost`}>
					<p className="text-sm">
						{pitWindow.position === pitWindow.current ? (
							<span className="font-semibold text-emerald-400">Free stop, keeps P{pitWindow.position}</span>
						) : (
							<span className="font-semibold">
								Rejoins P{pitWindow.position}, loses {pitWindow.position - pitWindow.current} place
								{pitWindow.position - pitWindow.current > 1 && "s"}
							</span>
						)}
						{pitWindow.ahead && (
							<span className="text-zinc-400 tabular-nums">
								{" "}
								· {pitWindow.ahead.margin.toFixed(1)}s behind {tla(pitWindow.ahead.nr)}
							</span>
						)}
						{pitWindow.behind && (
							<span className="text-zinc-400 tabular-nums">
								{" "}
								· {pitWindow.behind.margin.toFixed(1)}s ahead of {tla(pitWindow.behind.nr)}
							</span>
						)}
					</p>
					{pitWindow.lostTo.length > 0 && (
						<p className="mt-1 text-sm text-zinc-500">Would drop behind: {pitWindow.lostTo.map(tla).join(", ")}</p>
					)}
				</Card>
			)}

			{isRace && (
				<div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
					<Card
						title={
							pinned
								? `Gap to ${tla(pinned.RacingNumber)} in seconds, above zero ${tla(pinned.RacingNumber)} is ahead`
								: `Gap in seconds, above zero the other car is ahead of ${tla(nr)}`
						}
					>
						<LapChart
							series={charts.gap}
							format={(value) => formatSigned(value, 1)}
							zero
							highlight="segments"
							tones={{ improved: `${tla(nr)} gained`, best: "Biggest gain" }}
							emptyText="Gaps are recorded lap by lap while the dashboard is open."
						/>
					</Card>

					<Card title="Lap times, pit and safety car laps left out">
						<LapChart
							series={charts.lapTime}
							format={formatLap}
							highlight="markers"
							tones={{ improved: "Personal best", best: "Fastest lap" }}
							emptyText="Lap times are recorded lap by lap while the dashboard is open."
						/>
					</Card>
				</div>
			)}

			{/* tablets: the lap log takes the full width, race control and radio share the row below */}
			<div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
				<Card title="Lap log" className="max-h-[26rem] overflow-y-auto md:col-span-2 xl:col-span-1">
					{lapLog.length === 0 && <p className="text-sm text-zinc-600">No laps recorded yet.</p>}

					{lapLog.length > 0 && (
						<table className="w-full text-right text-sm tabular-nums">
							<thead className="text-xs text-zinc-500">
								<tr>
									<th className="text-left font-normal">Lap</th>
									<th className="font-normal">Pos</th>
									<th className="font-normal">Time</th>
									<th className="font-normal" title="against the typical lap on the same set">
										vs set
									</th>
									{gapColumns.map(({ series }) => (
										<th key={`gap.head.${series.key}`} className="font-normal">
											{series.label}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{lapLog.map((row) => (
									<tr key={`lap.${row.lap}`} className={clsx({ "text-zinc-500": row.reason !== null })}>
										<td className="py-0.5 text-left">{row.lap}</td>
										<td>P{row.position}</td>
										<td>
											<span
												className={clsx(
													"inline-block min-w-[4.5rem] rounded px-1 text-center",
													row.reason !== null
														? TONE_CHIP.excluded
														: row.personalBest
															? TONE_CHIP.gain
															: heatChip(row.delta),
												)}
											>
												{row.lapTime !== null ? formatLap(row.lapTime) : "-"}
											</span>
										</td>
										<td className={row.reason !== null ? "text-xs" : TONE_TEXT[deltaTone(row.delta, 0.1)]}>
											{row.reason ?? (row.delta !== null ? formatSigned(row.delta, 2) : "-")}
										</td>
										{gapColumns.map(({ series, byLap }) => {
											const point = byLap.get(row.lap);
											const previous = byLap.get(row.lap - 1);
											const change = point && previous ? point.value - previous.value : null;
											const tone = deltaTone(change, 0.05);

											return (
												<td key={`gap.${series.key}`} className={TONE_TEXT[tone]}>
													{point ? formatSigned(point.value) : "-"}
													{change !== null && tone !== "neutral" && (change < 0 ? " \u25BC" : " \u25B2")}
												</td>
											);
										})}
									</tr>
								))}
							</tbody>
						</table>
					)}
				</Card>

				<Card title="Race control" className="max-h-[26rem] overflow-y-auto">
					{messages.length === 0 && <p className="text-sm text-zinc-600">No messages about this driver.</p>}

					{gmtOffset && (
						<ul className="flex flex-col gap-1">
							{messages.map((msg) => (
								<RaceControlMessage key={`msg.${msg.Utc}.${msg.Message}`} msg={msg} gmtOffset={gmtOffset} />
							))}
						</ul>
					)}
				</Card>

				<Card title="Team radio" className="max-h-[26rem] overflow-y-auto">
					{radios.length === 0 && <p className="text-sm text-zinc-600">No team radio yet.</p>}

					{gmtOffset && meta && (
						<ul className="flex flex-col gap-2">
							{radios.map((capture) => (
								<RadioMessage
									key={`radio.${capture.Utc}`}
									driver={meta}
									capture={capture}
									basePath={`https://livetiming.formula1.com/static/${state.SessionInfo?.Path}`}
									gmtOffset={gmtOffset}
								/>
							))}
						</ul>
					)}
				</Card>
			</div>

			<Footer />
		</div>
	);
}

/**
 * the laps of one set as chips, coloured against the typical lap on the set
 */
function StintLaps({ rows, digits }: { rows: LapLogRow[]; digits: number }) {
	if (rows.length === 0) return <p className="mt-1.5 text-xs text-zinc-600">No laps recorded on this set.</p>;

	return (
		<div className="mt-1.5 flex flex-wrap gap-1 text-xs">
			{rows.map((row) => (
				<span
					key={`lap.${row.lap}`}
					className={clsx(
						"rounded px-1 py-0.5 tabular-nums",
						row.reason !== null ? TONE_CHIP.excluded : row.personalBest ? TONE_CHIP.gain : heatChip(row.delta),
					)}
					title={`Lap ${row.lap}${row.tyreAge !== null ? `, tyre lap ${row.tyreAge}` : ""}${row.reason ? `, ${row.reason}` : row.delta !== null ? `, ${formatSigned(row.delta, 2)} vs the set` : ""}`}
				>
					<span className="mr-1 text-[10px] opacity-60">{row.lap}</span>
					{row.lapTime !== null ? formatLapTime(row.lapTime, digits) : "-"}
				</span>
			))}
		</div>
	);
}

type SectorDuel = {
	// the lap just finished by both cars, shown for a moment at the line
	lap: number | null;
	// the sectors of the lap in progress done by both cars
	sectors: (number | null)[];
};

/**
 * what the driver gained, negative, or lost, positive, on another car in each sector of the lap in progress, and
 * on the whole lap for a few seconds once both cars finished it
 */
function sectorDuel(
	own: Record<number, SectorLap> | undefined,
	theirs: Record<number, SectorLap> | undefined,
	lapInProgress: number,
	now: number,
): SectorDuel {
	const total = (entry: SectorLap) =>
		entry.times.every((time) => time !== null) ? entry.times.reduce<number>((sum, time) => sum + (time ?? 0), 0) : null;

	const finished = Object.keys(own ?? {})
		.map(Number)
		.filter((lap) => own?.[lap].done != null && theirs?.[lap]?.done != null)
		.sort((a, b) => b - a)[0];

	if (finished !== undefined) {
		const mine = own![finished];
		const other = theirs![finished];
		const a = total(mine);
		const b = total(other);
		if (a !== null && b !== null && now - Math.max(mine.done!, other.done!) < LAP_FLASH_MS) {
			return { lap: a - b, sectors: [] };
		}
	}

	const mine = own?.[lapInProgress];
	const other = theirs?.[lapInProgress];
	return {
		lap: null,
		sectors: [0, 1, 2].map((index) => {
			const a = mine?.times[index];
			const b = other?.times[index];
			return a != null && b != null ? a - b : null;
		}),
	};
}

function SectorDuelCell({ duel }: { duel: SectorDuel }) {
	if (duel.lap !== null) {
		return (
			<span
				className={clsx(
					"block animate-pulse rounded px-1 text-center text-xs font-black",
					TONE_CHIP[deltaTone(duel.lap, 0.01)],
				)}
			>
				Lap {formatSigned(duel.lap, 2)}
			</span>
		);
	}

	return (
		<span className="flex justify-center gap-0.5 text-xs">
			{duel.sectors.map((value, index) => (
				<span
					key={`duel.sector.${index}`}
					className={clsx(
						"w-14 rounded px-0.5 text-center",
						value === null ? "bg-zinc-900 text-zinc-700" : TONE_CHIP[deltaTone(value, 0.01)],
					)}
				>
					{value === null ? "·" : formatSigned(value, 2)}
				</span>
			))}
		</span>
	);
}

/**
 * how much the gap between two cars changed since both are on their current sets, negative when they got closer
 */
function stintChange(own: LapSample[] | undefined, other: LapSample[] | undefined) {
	const ownStint = own?.[own.length - 1]?.stint;
	const otherStint = other?.[other.length - 1]?.stint;
	const theirs = new Map(
		(other ?? [])
			.filter((sample) => sample.gap !== null && sample.stint === otherStint)
			.map((sample) => [sample.lap, sample.gap as number]),
	);
	const distances = (own ?? [])
		.filter((sample) => sample.gap !== null && sample.stint === ownStint && theirs.has(sample.lap))
		.map((sample) => Math.abs((sample.gap as number) - (theirs.get(sample.lap) as number)));

	if (distances.length - 1 < STINT_CHANGE_LAPS) return null;
	return { change: distances[distances.length - 1] - distances[0], laps: distances.length - 1 };
}

// the compound with the laps on the set and, for another car, how many laps more or fewer than the driver's set
function TyreCell({ stint, age }: { stint: Stint | undefined; age?: number }) {
	return (
		<span className="inline-flex items-center justify-end gap-1">
			<Image src={tireIcon(stint?.Compound)} alt={stint?.Compound ?? "unknown tire"} width={16} height={16} />
			{stint?.TotalLaps ?? 0}L
			{age !== undefined && age !== 0 && (
				<span
					className={clsx("text-xs", age > 0 ? "text-emerald-400" : "text-red-400")}
					title={`${Math.abs(age)} laps ${age > 0 ? "older" : "fresher"} than the driver's set`}
				>
					{age > 0 ? `+${age}` : age}
				</span>
			)}
		</span>
	);
}
