"use client";

import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";

import type { TimingDataDriver } from "@/types/state.type";

import { computeGapsSeconds, getOrderedTimingDrivers, parseLapSeconds, parseLapsDown } from "@/lib/gaps";
import { buildLapLog, getStintDegradation } from "@/lib/lapLog";
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
import { tireIcon } from "@/lib/tires";
import {
	degradationTone,
	deltaTone,
	heatChip,
	lapTone,
	rivalTone,
	sectorTone,
	TONE_BORDER,
	TONE_CHIP,
	TONE_TEXT,
	tyreWear,
} from "@/lib/tones";

import { useDataStore } from "@/stores/useDataStore";
import { useLapHistoryStore, type LapSample } from "@/stores/useLapHistoryStore";
import { useRivalStore } from "@/stores/useRivalStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

import { RaceControlMessage } from "@/components/dashboard/RaceControlMessage";
import RadioMessage from "@/components/dashboard/RadioMessage";
import Badge from "@/components/driver/Badge";
import DriverCarMetrics from "@/components/driver/DriverCarMetrics";
import LapChart, { type LapChartPoint, type LapChartSeries } from "@/components/driver/LapChart";
import TrendText from "@/components/driver/TrendText";
import Footer from "@/components/Footer";
import { Card, Delta, Fact, GapBar, StintStrip, Tile, TyreWearBar } from "@/components/panel/Panel";

// chart colors follow the role, the selected driver and the cars compared with it
// green and purple are left to improved and best laps
const COLOR_DRIVER = "#3987e5";
const COLOR_AHEAD = "#c98500";
const COLOR_BEHIND = "#d55181";

// smaller changes of the gap are timing noise
const MIN_GAIN = 0.02;

const LAP_LOG_SIZE = 20;

type Props = {
	nr: string | null;
};

type Rival = {
	driver: TimingDataDriver;
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

function delta(own?: string, other?: string): number | null {
	const a = parseLapSeconds(own);
	const b = parseLapSeconds(other);
	return a !== null && b !== null ? a - b : null;
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

		// a pinned rival stays compared however the positions change
		const candidates: { other: TimingDataDriver | undefined; role: Rival["role"] }[] = pinned
			? [{ other: pinned, role: parseInt(pinned.Position) < parseInt(driver.Position) ? "ahead" : "behind" }]
			: [
					{ other: ordered[index - 1], role: "ahead" },
					{ other: ordered[index + 1], role: "behind" },
				];

		return candidates.flatMap(({ other, role }): Rival[] => {
			if (!other) return [];

			const interval = comparable(other)
				? Math.abs((gaps.get(driver.RacingNumber) ?? 0) - (gaps.get(other.RacingNumber) ?? 0))
				: null;
			const [ahead, behind] = role === "ahead" ? [other, driver] : [driver, other];
			const trend =
				isRace && !neutralized && interval !== null
					? describeTrend(history[behind.RacingNumber], history[ahead.RacingNumber], interval, lapsRemaining)
					: null;

			return [{ driver: other, role, pinned: !!pinned, interval, trend, pace: getPace(history[other.RacingNumber]) }];
		});
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

	const charts = useMemo(() => {
		if (!nr) return { gap: [], lapTime: [] };

		const timingLines = state?.TimingData?.Lines;
		const statsLines = state?.TimingStats?.Lines;
		const name = (number: string) => state?.DriverList?.[number]?.Tla ?? number;
		const label = (rival: Rival) =>
			rival.pinned ? name(rival.driver.RacingNumber) : `${name(rival.driver.RacingNumber)} (${rival.role})`;
		const color = (rival: Rival) => (rival.pinned || rival.role === "ahead" ? COLOR_AHEAD : COLOR_BEHIND);
		// the fastest lap of the session, if this driver holds it
		const fastest = (number: string) =>
			statsLines?.[number]?.PersonalBestLapTime?.Position === 1
				? parseLapSeconds(timingLines?.[number]?.BestLapTime?.Value)
				: null;

		const gap: LapChartSeries[] = rivals.map((rival) => ({
			key: rival.role,
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
				key: rival.role,
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
	const stats = state.TimingStats?.Lines[nr];
	const driverFlags = flags.get(nr);
	const carData = carsData?.[nr]?.Channels;

	const position = parseInt(driver.Position);
	const gridPosition = appData?.GridPos ? parseInt(appData.GridPos) : NaN;
	const gained = isRace && Number.isFinite(gridPosition) ? gridPosition - position : null;
	const lapsDown = parseLapsDown(driver.GapToLeader);
	const gapToLeader = gaps.get(nr) ?? 0;
	const out = driver.Retired || driver.Stopped;

	const topSpeed = (stats?.BestSpeeds as Record<string, { Value: string; Position?: number }> | undefined)?.ST;
	const samples = history[nr] ?? [];
	const pace = getPace(samples);
	const logRows = buildLapLog(samples, appData, driver.NumberOfLaps);
	const degradation = (stintNumber: number) => getStintDegradation(logRows, stintNumber);
	const currentDegradation = degradation(stints.length);
	const wear = tyreWear(stint);
	const rank = stats?.PersonalBestLapTime?.Position;

	const aheadRival = rivals.find((rival) => rival.role === "ahead");
	const behindRival = rivals.find((rival) => rival.role === "behind");
	const status =
		isRace && !out
			? describeStatus(
					aheadRival ? { tla: tla(aheadRival.driver.RacingNumber), trend: aheadRival.trend } : null,
					behindRival ? { tla: tla(behindRival.driver.RacingNumber), trend: behindRival.trend } : null,
				)
			: null;
	const aheadPace = aheadRival?.pace ?? null;
	const paceVsAhead = pace !== null && aheadPace !== null ? pace - aheadPace : null;
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
							{paceVsAhead !== null && aheadRival && (
								<span>
									Pace {formatSigned(paceVsAhead, 2)}s vs {tla(aheadRival.driver.RacingNumber)}
								</span>
							)}
						</p>
					</div>
				)}

				<div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
					{isRace && (
						<Tile label="Grid" tone={gained === null || gained === 0 ? "neutral" : gained > 0 ? "gain" : "loss"}>
							{Number.isFinite(gridPosition) ? `P${gridPosition}` : "-"}
							{gained !== null && gained !== 0 && (
								<span className={clsx("ml-1.5 text-sm", gained > 0 ? "text-emerald-400" : "text-red-400")}>
									{gained > 0 ? `+${gained}` : gained}
								</span>
							)}
						</Tile>
					)}

					<Tile label={isRace ? "Gap to leader" : "Gap to fastest"}>
						{out ? "OUT" : lapsDown > 0 ? `+${lapsDown}L` : position === 1 ? "-" : `+${gapToLeader.toFixed(3)}`}
					</Tile>

					<Tile label="Last lap" note={`Best ${driver.BestLapTime?.Value || "-"}`} tone={lapTone(driver.LastLapTime)}>
						{driver.LastLapTime?.Value || "-"}
					</Tile>

					<Tile
						label="Best lap rank"
						tone={rank === 1 ? "best" : rank !== undefined && rank <= 3 ? "gain" : "neutral"}
						note={
							topSpeed?.Value ? `Top speed ${topSpeed.Value}${topSpeed.Position ? ` (P${topSpeed.Position})` : ""}` : ""
						}
					>
						{stats?.PersonalBestLapTime?.Position ? `P${stats.PersonalBestLapTime.Position}` : "-"}
					</Tile>

					<Tile
						label="Tyre"
						tone={wear?.tone}
						note={
							<>
								<TyreWearBar stint={stint} />
								{isRace && `${Math.max(0, stints.length - 1)} stop${stints.length === 2 ? "" : "s"}`}
								{currentDegradation !== null && (
									<span
										className={TONE_TEXT[degradationTone(currentDegradation)]}
										title="Tyre loss per lap on this set, fuel burn added back"
									>
										{`${isRace ? " · " : ""}deg ${formatSigned(currentDegradation, 2)}s/lap`}
									</span>
								)}
							</>
						}
					>
						<span className="flex items-center gap-1.5">
							<Image src={tireIcon(stint?.Compound)} alt={stint?.Compound ?? "unknown tire"} width={22} height={22} />
							{stint?.TotalLaps ?? 0}L
						</span>
					</Tile>

					<Tile label="Sectors">
						<span className="flex flex-wrap gap-1 text-sm">
							{driver.Sectors.slice(0, 3).map((sector, sectorIndex) => (
								<span
									key={`sector.${sectorIndex}`}
									className={clsx("rounded px-1 tabular-nums", TONE_CHIP[sectorTone(sector)])}
								>
									{sector.Value || "-"}
								</span>
							))}
						</span>
					</Tile>
				</div>

				{stints.length > 0 && (
					<div className="mt-3">
						<StintStrip stints={stints} degradation={degradation} />
					</div>
				)}
			</div>

			<label className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 px-3 py-2 text-sm">
				<span className="text-zinc-500">Compare with</span>
				<select
					className="rounded-lg bg-zinc-900 px-2 py-1.5 text-sm"
					value={pinned?.RacingNumber ?? ""}
					onChange={(event) => setPinnedRival(event.target.value || null)}
				>
					<option value="">The cars ahead and behind</option>
					{ordered
						.filter((entry) => entry.RacingNumber !== nr)
						.map((entry) => (
							<option key={`rival.option.${entry.RacingNumber}`} value={entry.RacingNumber}>
								P{entry.Position} {tla(entry.RacingNumber)}
							</option>
						))}
				</select>
				{pinned && <span className="text-zinc-500">stays fixed when positions change</span>}
			</label>

			<div className={clsx("grid grid-cols-1 gap-2", { "lg:grid-cols-2": rivals.length > 1 })}>
				{rivals.map((rival) => {
					const other = rival.driver;
					const otherStints = state.TimingAppData?.Lines[other.RacingNumber]?.Stints ?? [];
					const otherStint = otherStints[otherStints.length - 1];
					const tyreAge = (otherStint?.TotalLaps ?? 0) - (stint?.TotalLaps ?? 0);
					const paceDelta = pace !== null && rival.pace !== null ? pace - rival.pace : null;
					const bestLap = delta(driver.BestLapTime?.Value, other.BestLapTime?.Value);
					const tone = rivalTone(rival.trend, rival.role);

					return (
						<Card
							key={`rival.${rival.role}`}
							className={clsx("border-l-4", TONE_BORDER[tone])}
							title={`${rival.pinned ? "Pinned rival, " : "Car "}${rival.role}`}
							action={
								<button
									type="button"
									className="cursor-pointer rounded border border-zinc-700 px-3 py-1 text-sm text-zinc-400"
									onClick={() => setPinnedRival(rival.pinned ? null : other.RacingNumber)}
								>
									{rival.pinned ? "Unpin" : "Pin"}
								</button>
							}
						>
							<div className="flex flex-wrap items-center justify-between gap-2">
								<Link href={`/dashboard/driver/${other.RacingNumber}`} className="flex items-center gap-2">
									<span className="text-sm text-zinc-500 tabular-nums">P{other.Position}</span>
									<span
										className="h-6 w-1 rounded-full"
										style={{ backgroundColor: `#${drivers[other.RacingNumber]?.TeamColour ?? "71717a"}` }}
									/>
									<span className="font-mono text-xl font-black">{tla(other.RacingNumber)}</span>
								</Link>

								<div className="text-right tabular-nums">
									<p className="text-xl leading-tight font-semibold">
										{rival.interval !== null ? `${rival.interval.toFixed(3)}s` : "-"}
									</p>
									{rival.trend && <TrendText trend={rival.trend} className="text-xs" />}
								</div>
							</div>

							{rival.interval !== null && (
								<div className="mt-2">
									<GapBar gap={rival.interval} tone={tone} />
								</div>
							)}

							<div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
								<Fact label="Tyre">
									<span className="flex items-center gap-1">
										<Image
											src={tireIcon(otherStint?.Compound)}
											alt={otherStint?.Compound ?? "unknown tire"}
											width={16}
											height={16}
										/>
										{otherStint?.TotalLaps ?? 0}L
										{tyreAge !== 0 && (
											<span className="text-zinc-500">
												, {Math.abs(tyreAge)}L {tyreAge > 0 ? "older" : "fresher"}
											</span>
										)}
									</span>
								</Fact>
								<Fact label="Stops">{Math.max(0, otherStints.length - 1)}</Fact>
								<Fact label={`Pace (3 laps) vs ${tla(other.RacingNumber)}`}>
									<Delta value={paceDelta} />
								</Fact>
								<Fact label={`Best lap vs ${tla(other.RacingNumber)}`}>
									<Delta value={bestLap} />
								</Fact>
								{[0, 1, 2].map((sectorIndex) => (
									<Fact key={`sector.${sectorIndex}`} label={`Sector ${sectorIndex + 1}`}>
										<Delta value={delta(driver.Sectors[sectorIndex]?.Value, other.Sectors[sectorIndex]?.Value)} />
									</Fact>
								))}
							</div>
						</Card>
					);
				})}
			</div>

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
