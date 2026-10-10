"use client";

import { useMemo, type ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";

import type { Sector, TimingDataDriver } from "@/types/state.type";

import { computeGapsSeconds, getOrderedTimingDrivers, parseLapSeconds, parseLapsDown } from "@/lib/gaps";
import { describeTrend, formatSigned, getPitWindow, isNeutralized, isOffLeadLap, type Trend } from "@/lib/race";
import { getDriverFlags } from "@/lib/raceControl";
import { tireIcon } from "@/lib/tires";

import { useDataStore } from "@/stores/useDataStore";
import { useLapHistoryStore, type LapSample } from "@/stores/useLapHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

import { RaceControlMessage } from "@/components/dashboard/RaceControlMessage";
import RadioMessage from "@/components/dashboard/RadioMessage";
import Badge from "@/components/driver/Badge";
import DriverCarMetrics from "@/components/driver/DriverCarMetrics";
import DriverHistoryTires from "@/components/driver/DriverHistoryTires";
import LapChart, { type LapChartSeries } from "@/components/driver/LapChart";
import TrendText from "@/components/driver/TrendText";
import Footer from "@/components/Footer";

// chart colors follow the role, the selected driver and the cars around it
const COLOR_DRIVER = "#3987e5";
const COLOR_AHEAD = "#d95926";
const COLOR_BEHIND = "#199e70";

const LAP_LOG_SIZE = 20;

type Props = {
	nr: string | null;
};

type Rival = {
	driver: TimingDataDriver;
	role: "ahead" | "behind";
	interval: number | null;
	trend: Trend | null;
};

function formatLap(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	const rest = (seconds - minutes * 60).toFixed(3).padStart(6, "0");
	return minutes > 0 ? `${minutes}:${rest}` : rest;
}

function sectorClass(sector?: Sector) {
	if (!sector?.Value) return "text-zinc-600";
	if (sector.OverallFastest) return "text-violet-400";
	if (sector.PersonalFastest) return "text-emerald-400";
	return "text-amber-300";
}

function delta(own?: string, other?: string): number | null {
	const a = parseLapSeconds(own);
	const b = parseLapSeconds(other);
	return a !== null && b !== null ? a - b : null;
}

// gap between two cars per lap, only for laps both have a known gap to the leader
function gapSeries(own: LapSample[] | undefined, other: LapSample[] | undefined) {
	const otherByLap = new Map((other ?? []).map((sample) => [sample.lap, sample]));

	return (own ?? []).flatMap((sample) => {
		const rival = otherByLap.get(sample.lap);
		return sample.gap !== null && rival && rival.gap !== null
			? [{ lap: sample.lap, value: Math.abs(sample.gap - rival.gap) }]
			: [];
	});
}

// laps with a pit stop or behind the safety car would flatten the rest of the chart
function lapTimeSeries(samples: LapSample[] | undefined) {
	return (samples ?? []).flatMap((sample) =>
		sample.clean && sample.lapTime !== null ? [{ lap: sample.lap, value: sample.lapTime }] : [],
	);
}

export default function DriverFocus({ nr: requested }: Props) {
	const state = useDataStore((store) => store.state);
	const carsData = useDataStore((store) => store.carsData);
	const history = useLapHistoryStore((store) => store.laps);
	const favoriteDrivers = useSettingsStore((store) => store.favoriteDrivers);
	const pitLoss = useSettingsStore((store) => store.verticalPitLoss);

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

	const rivals = useMemo(() => {
		if (!driver) return [];

		// gaps to the leader only compare between cars on the lead lap
		const comparable = (other: TimingDataDriver) => !isRace || (!isOffLeadLap(driver) && !isOffLeadLap(other));

		return [
			{ other: ordered[index - 1], role: "ahead" as const },
			{ other: ordered[index + 1], role: "behind" as const },
		].flatMap(({ other, role }): Rival[] => {
			if (!other) return [];

			const interval = comparable(other)
				? Math.abs((gaps.get(driver.RacingNumber) ?? 0) - (gaps.get(other.RacingNumber) ?? 0))
				: null;
			const [ahead, behind] = role === "ahead" ? [other, driver] : [driver, other];
			const trend =
				isRace && !neutralized && interval !== null
					? describeTrend(history[behind.RacingNumber], history[ahead.RacingNumber], interval, lapsRemaining)
					: null;

			return [{ driver: other, role, interval, trend }];
		});
	}, [driver, gaps, history, index, isRace, lapsRemaining, neutralized, ordered]);

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

		const label = (rival: Rival) => `${state?.DriverList?.[rival.driver.RacingNumber]?.Tla} (${rival.role})`;
		const color = (rival: Rival) => (rival.role === "ahead" ? COLOR_AHEAD : COLOR_BEHIND);

		const gap: LapChartSeries[] = rivals.map((rival) => ({
			key: rival.role,
			label: `Gap to ${label(rival)}`,
			color: color(rival),
			points: gapSeries(history[nr], history[rival.driver.RacingNumber]),
		}));

		const lapTime: LapChartSeries[] = [
			{
				key: "driver",
				label: state?.DriverList?.[nr]?.Tla ?? nr,
				color: COLOR_DRIVER,
				points: lapTimeSeries(history[nr]),
			},
			...rivals.map((rival) => ({
				key: rival.role,
				label: label(rival),
				color: color(rival),
				points: lapTimeSeries(history[rival.driver.RacingNumber]),
			})),
		];

		return { gap, lapTime };
	}, [history, nr, rivals, state?.DriverList]);

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
	const lapLog = samples.slice(-LAP_LOG_SIZE).reverse();
	const rivalGap = (sample: LapSample, role: Rival["role"]) => {
		const rival = rivals.find((entry) => entry.role === role);
		const other = rival && history[rival.driver.RacingNumber]?.find((entry) => entry.lap === sample.lap);
		return sample.gap !== null && other && other.gap !== null ? Math.abs(sample.gap - other.gap).toFixed(3) : "-";
	};

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
						className={clsx("flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1", {
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

				<div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
					{isRace && (
						<Tile label="Grid">
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

					<Tile label="Last lap" note={`Best ${driver.BestLapTime?.Value || "-"}`}>
						<span
							className={clsx({
								"text-violet-400": driver.LastLapTime?.OverallFastest,
								"text-emerald-400": driver.LastLapTime?.PersonalFastest && !driver.LastLapTime?.OverallFastest,
							})}
						>
							{driver.LastLapTime?.Value || "-"}
						</span>
					</Tile>

					<Tile
						label="Best lap rank"
						note={
							topSpeed?.Value ? `Top speed ${topSpeed.Value}${topSpeed.Position ? ` (P${topSpeed.Position})` : ""}` : ""
						}
					>
						{stats?.PersonalBestLapTime?.Position ? `P${stats.PersonalBestLapTime.Position}` : "-"}
					</Tile>

					<Tile
						label="Tyre"
						note={isRace ? `${Math.max(0, stints.length - 1)} stop${stints.length === 2 ? "" : "s"}` : ""}
					>
						<span className="flex items-center gap-1.5">
							<Image src={tireIcon(stint?.Compound)} alt={stint?.Compound ?? "unknown tire"} width={22} height={22} />
							{stint?.TotalLaps ?? 0}L
						</span>
					</Tile>

					<Tile label="Sectors">
						<span className="flex gap-2 text-sm">
							{driver.Sectors.slice(0, 3).map((sector, sectorIndex) => (
								<span key={`sector.${sectorIndex}`} className={clsx("tabular-nums", sectorClass(sector))}>
									{sector.Value || "-"}
								</span>
							))}
						</span>
					</Tile>
				</div>

				{stints.length > 0 && (
					<div className="mt-3">
						<DriverHistoryTires stints={stints} />
					</div>
				)}
			</div>

			<div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
				{rivals.map((rival) => {
					const other = rival.driver;
					const otherStints = state.TimingAppData?.Lines[other.RacingNumber]?.Stints ?? [];
					const otherStint = otherStints[otherStints.length - 1];
					const tyreAge = (otherStint?.TotalLaps ?? 0) - (stint?.TotalLaps ?? 0);
					const lastLap = delta(driver.LastLapTime?.Value, other.LastLapTime?.Value);
					const bestLap = delta(driver.BestLapTime?.Value, other.BestLapTime?.Value);

					return (
						<Card key={`rival.${rival.role}`} title={rival.role === "ahead" ? "Car ahead" : "Car behind"}>
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
								<Fact label={`Last lap vs ${tla(other.RacingNumber)}`}>
									<Delta value={lastLap} />
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
					<Card title="Gap to the cars around, seconds">
						<LapChart
							series={charts.gap}
							format={(value) => value.toFixed(1)}
							emptyText="Gaps are recorded lap by lap while the dashboard is open."
						/>
					</Card>

					<Card title="Lap times, pit and safety car laps left out">
						<LapChart
							series={charts.lapTime}
							format={formatLap}
							emptyText="Lap times are recorded lap by lap while the dashboard is open."
						/>
					</Card>
				</div>
			)}

			<div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
				<Card title="Lap log" className="max-h-[26rem] overflow-y-auto">
					{lapLog.length === 0 && <p className="text-sm text-zinc-600">No laps recorded yet.</p>}

					{lapLog.length > 0 && (
						<table className="w-full text-right text-sm tabular-nums">
							<thead className="text-xs text-zinc-500">
								<tr>
									<th className="text-left font-normal">Lap</th>
									<th className="font-normal">Pos</th>
									<th className="font-normal">Time</th>
									<th className="font-normal">Ahead</th>
									<th className="font-normal">Behind</th>
								</tr>
							</thead>
							<tbody>
								{lapLog.map((sample) => (
									<tr key={`lap.${sample.lap}`} className={clsx({ "text-zinc-500": !sample.clean })}>
										<td className="text-left">{sample.lap}</td>
										<td>P{sample.position}</td>
										<td>{sample.lapTime !== null ? formatLap(sample.lapTime) : "-"}</td>
										<td>{rivalGap(sample, "ahead")}</td>
										<td>{rivalGap(sample, "behind")}</td>
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

function Card({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
	return (
		<div className={clsx("rounded-lg border border-zinc-800 p-3", className)}>
			<p className="mb-2 text-xs text-zinc-500">{title}</p>
			{children}
		</div>
	);
}

function Tile({ label, note, children }: { label: string; note?: string; children: ReactNode }) {
	return (
		<div className="rounded-md bg-zinc-900/60 px-2.5 py-2">
			<p className="text-xs text-zinc-500">{label}</p>
			<div className="text-lg leading-tight font-semibold tabular-nums">{children}</div>
			{note && <p className="text-xs text-zinc-500 tabular-nums">{note}</p>}
		</div>
	);
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-zinc-500">{label}</span>
			<span className="tabular-nums">{children}</span>
		</div>
	);
}

// negative means the selected driver is faster
function Delta({ value }: { value: number | null }) {
	if (value === null) return <span className="text-zinc-600">-</span>;

	return (
		<span className={clsx({ "text-emerald-400": value < 0, "text-red-400": value > 0 })}>{formatSigned(value)}</span>
	);
}
