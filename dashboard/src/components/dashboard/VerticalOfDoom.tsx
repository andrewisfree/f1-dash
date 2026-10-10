"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";

import {
	computeGapsSeconds,
	createGapScale,
	formatCompactLap,
	getOrderedTimingDrivers,
	parseLapsDown,
	type GapScale,
} from "@/lib/gaps";
import { getTrackStatusMessage } from "@/lib/getTrackStatusMessage";
import { getCutoffPosition, inDangerZone } from "@/lib/qualifying";
import { describeTrend, formatSigned, getPitWindow, isNeutralized, isOffLeadLap, type Trend } from "@/lib/race";
import { getDriverFlags, type DriverFlags } from "@/lib/raceControl";
import { tireIcon } from "@/lib/tires";
import { useDataStore } from "@/stores/useDataStore";
import { useLapHistoryStore } from "@/stores/useLapHistoryStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import Badge from "@/components/driver/Badge";
import TrendText from "@/components/driver/TrendText";
import type { Driver, Sector, Stint, TimingDataDriver } from "@/types/state.type";

const TRACK_HEIGHT = 1040;
const MIN_LABEL_GAP = 34;
const MIN_TICK_GAP = 16;
const TICKS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90];
type DriverPoint = {
	driver: TimingDataDriver;
	gap: number;
	rel: number;
	rawY: number;
	labelY: number;
};

function hasDRS(drs: number | undefined) {
	return typeof drs === "number" && drs > 9;
}

function sectorClass(sector?: Sector) {
	if (!sector?.Value) return "bg-zinc-800";
	if (sector.OverallFastest) return "bg-violet-600";
	if (sector.PersonalFastest) return "bg-emerald-500";
	return "bg-amber-400";
}

function spreadLabels(points: Omit<DriverPoint, "labelY">[]): DriverPoint[] {
	const placed: DriverPoint[] = [];

	for (const point of points) {
		const previous = placed[placed.length - 1];
		const minY = previous ? previous.labelY + MIN_LABEL_GAP : 0;
		placed.push({ ...point, labelY: Math.max(point.rawY, minY) });
	}

	const overflow = placed.length ? placed[placed.length - 1].labelY - TRACK_HEIGHT : 0;
	if (overflow <= 0) return placed;

	for (let i = placed.length - 1; i >= 0; i--) {
		const next = placed[i + 1];
		const maxY = next ? next.labelY - MIN_LABEL_GAP : TRACK_HEIGHT;
		placed[i] = { ...placed[i], labelY: Math.min(placed[i].labelY, maxY) };
	}

	return placed;
}

export default function VerticalOfDoom() {
	const state = useDataStore((store) => store.state);
	const carsData = useDataStore((store) => store.carsData);
	const history = useLapHistoryStore((store) => store.laps);
	const favoriteDrivers = useSettingsStore((store) => store.favoriteDrivers);
	const scaleMode = useSettingsStore((store) => store.verticalScale);
	const topN = useSettingsStore((store) => store.verticalTopN);
	const fixedSeconds = useSettingsStore((store) => store.verticalFixedSeconds);
	const battleSeconds = useSettingsStore((store) => store.verticalBattleSeconds);
	const showConnectors = useSettingsStore((store) => store.verticalConnectors);
	const pitLoss = useSettingsStore((store) => store.verticalPitLoss);

	const [selected, setSelected] = useState<string | null>(null);

	const sessionPart = state?.TimingData?.SessionPart;
	const noEntries = state?.TimingData?.NoEntries;
	const isRace = state?.SessionInfo?.Type === "Race";
	const neutralized = isNeutralized(state?.TrackStatus?.Status);
	const lapsRemaining = state?.LapCount ? state.LapCount.TotalLaps - state.LapCount.CurrentLap : null;

	const ordered = useMemo(() => getOrderedTimingDrivers(state?.TimingData?.Lines), [state?.TimingData?.Lines]);
	const gaps = useMemo(() => computeGapsSeconds(ordered, sessionPart), [ordered, sessionPart]);
	const flags = useMemo(
		() => getDriverFlags(state?.RaceControlMessages?.Messages),
		[state?.RaceControlMessages?.Messages],
	);

	// lapped and stopped cars have no usable gap, they are listed below the track
	const { onTrack, offTrack } = useMemo(() => {
		const count = topN > 0 ? Math.min(topN, ordered.length) : ordered.length;
		const visible = ordered.slice(0, count);
		const isOff = (driver: TimingDataDriver) => isRace && isOffLeadLap(driver);

		return { onTrack: visible.filter((driver) => !isOff(driver)), offTrack: visible.filter(isOff) };
	}, [isRace, ordered, topN]);

	const reference = selected && onTrack.some((driver) => driver.RacingNumber === selected) ? selected : null;
	const referenceGap = reference ? (gaps.get(reference) ?? 0) : 0;

	const scale: GapScale = useMemo(() => {
		const rels = onTrack.map((driver) => (gaps.get(driver.RacingNumber) ?? 0) - referenceGap).filter(Number.isFinite);
		let lo = Math.min(0, ...rels);
		let hi = Math.max(0, ...rels);

		if (scaleMode === "fixed") {
			const fixed = Math.max(1, fixedSeconds);
			lo = Math.max(lo, -fixed);
			hi = fixed;
		}

		return { mode: scaleMode, battleSeconds, lo, hi: Math.max(hi, lo + 1) };
	}, [battleSeconds, fixedSeconds, gaps, onTrack, referenceGap, scaleMode]);

	const toY = useMemo(() => {
		const toUnit = createGapScale(scale);
		return (rel: number) => Math.round(toUnit(rel) * TRACK_HEIGHT);
	}, [scale]);

	const points = useMemo(() => {
		const rawPoints = onTrack.map((driver) => {
			const gap = gaps.get(driver.RacingNumber) ?? 0;
			const rel = gap - referenceGap;

			return { driver, gap, rel, rawY: toY(rel) };
		});

		return spreadLabels(rawPoints);
	}, [gaps, onTrack, referenceGap, toY]);

	const ticks = useMemo(() => {
		const values = reference ? [0, ...TICKS.flatMap((tick) => [tick, -tick])] : TICKS;
		const placed: { value: number; y: number }[] = [];

		for (const value of values) {
			if (value < scale.lo || value > scale.hi) continue;

			const y = toY(value);
			if (placed.some((tick) => Math.abs(tick.y - y) < MIN_TICK_GAP)) continue;
			placed.push({ value, y });
		}

		return placed;
	}, [reference, scale, toY]);

	// trend of the gap to the car ahead, or to the reference driver when one is selected
	const trends = useMemo(() => {
		const result = new Map<string, { interval: Trend | null; reference: Trend | null }>();
		if (!isRace || neutralized) return result;

		const between = (a: DriverPoint, b: DriverPoint) => {
			const [ahead, behind] = a.gap <= b.gap ? [a, b] : [b, a];
			return describeTrend(
				history[behind.driver.RacingNumber],
				history[ahead.driver.RacingNumber],
				behind.gap - ahead.gap,
				lapsRemaining,
			);
		};

		const referencePoint = points.find((point) => point.driver.RacingNumber === reference);

		points.forEach((point, index) => {
			result.set(point.driver.RacingNumber, {
				interval: index > 0 ? between(points[index - 1], point) : null,
				reference: referencePoint && referencePoint !== point ? between(referencePoint, point) : null,
			});
		});

		return result;
	}, [history, isRace, lapsRemaining, neutralized, points, reference]);

	// positions once the pending time penalties are applied
	const penaltyPositions = useMemo(() => {
		const result = new Map<string, number>();
		if (!isRace) return result;

		const classified = points
			.map((point) => ({
				nr: point.driver.RacingNumber,
				time: point.gap + (flags.get(point.driver.RacingNumber)?.penalty ?? 0),
			}))
			.sort((a, b) => a.time - b.time);

		classified.forEach((entry, index) => result.set(entry.nr, index + 1));
		return result;
	}, [flags, isRace, points]);

	// where the reference driver would rejoin after a pit stop
	const pitWindow = useMemo(() => {
		if (!reference || !isRace) return null;

		const entries = points.map((point) => ({ nr: point.driver.RacingNumber, gap: point.gap }));
		return getPitWindow(entries, reference, pitLoss);
	}, [isRace, pitLoss, points, reference]);

	const cutoff = useMemo(() => {
		if (isRace || !sessionPart) return null;

		const position = getCutoffPosition(sessionPart, noEntries);
		const last = points.find((point) => parseInt(point.driver.Position) === position);
		const next = points.find((point) => parseInt(point.driver.Position) === (position ?? 0) + 1);
		if (!position || !last || !next) return null;

		return { position, gap: last.gap, y: (last.rawY + next.rawY) / 2 };
	}, [isRace, noEntries, points, sessionPart]);

	if (!state?.TimingData || !state.DriverList) {
		return (
			<div className="grid h-full min-h-[40rem] place-items-center rounded-lg border border-zinc-800 p-4">
				<div className="h-48 w-48 animate-pulse rounded-full border border-zinc-800" />
			</div>
		);
	}

	const drivers = state.DriverList;
	const tla = (nr: string) => drivers[nr]?.Tla ?? nr;
	const trackStatus = getTrackStatusMessage(state.TrackStatus?.Status ? parseInt(state.TrackStatus.Status) : undefined);
	const referenceIndex = points.findIndex((point) => point.driver.RacingNumber === reference);
	const referencePoint = points[referenceIndex];
	const span = scale.hi - scale.lo;

	const renderRow = (driver: TimingDataDriver, gapLabel: string, trend: Trend | null, extra?: RowExtra) => {
		const nr = driver.RacingNumber;
		const appData = state.TimingAppData?.Lines[nr];
		const position = parseInt(driver.Position);

		return (
			<DriverRow
				key={`row.${nr}`}
				driver={driver}
				meta={drivers[nr]}
				stint={appData?.Stints?.[appData.Stints.length - 1]}
				drsOn={hasDRS(carsData?.[nr]?.Channels?.[45])}
				gapLabel={gapLabel}
				trend={trend}
				flags={flags.get(nr)}
				penaltyPosition={penaltyPositions.get(nr)}
				favorite={favoriteDrivers.includes(nr)}
				danger={!isRace && sessionPart !== undefined && inDangerZone(position, sessionPart, noEntries)}
				selected={reference === nr}
				onSelect={extra?.onSelect}
				className={extra?.className}
				style={extra?.style}
			/>
		);
	};

	return (
		<div
			className={clsx("flex h-full min-h-[42rem] flex-col overflow-hidden rounded-lg border bg-zinc-950", {
				"border-zinc-800": !neutralized,
				"border-amber-500/70": neutralized && state.TrackStatus?.Status !== "5",
				"border-red-500/70": state.TrackStatus?.Status === "5",
			})}
		>
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
				<div>
					<h2 className="text-lg font-semibold">Vertical of Doom</h2>
					<p className="text-xs text-zinc-500">
						{scaleMode === "battle"
							? `Battle scale: ${battleSeconds}s around ${reference ? tla(reference) : "the leader"} expanded`
							: scaleMode === "fixed"
								? `Fixed scale: ${fixedSeconds}s full height`
								: `Spread scale: ${span.toFixed(1)}s full height`}
					</p>
				</div>

				<div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
					{state.LapCount && (
						<span className="tabular-nums">
							Lap {state.LapCount.CurrentLap}/{state.LapCount.TotalLaps}
						</span>
					)}
					{cutoff && (
						<span className="text-red-400 tabular-nums">
							Cutoff P{cutoff.position} +{cutoff.gap.toFixed(3)}
						</span>
					)}
					{trackStatus && (
						<span className="flex items-center gap-1">
							<span className={clsx("h-1.5 w-1.5 rounded-full", trackStatus.color)} />
							{trackStatus.message}
						</span>
					)}
					<span>{points.length + offTrack.length} drivers</span>
				</div>
			</div>

			{neutralized && (
				<div className="border-b border-zinc-800 bg-amber-950/40 px-3 py-1 text-xs text-amber-300">
					Field neutralized, gaps and trends are not representative.
				</div>
			)}

			{referencePoint ? (
				<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-zinc-800 bg-zinc-900/60 px-3 py-1.5 text-xs">
					<span className="flex items-center gap-1.5">
						<span
							className="h-4 w-1 rounded-full"
							style={{ backgroundColor: `#${drivers[referencePoint.driver.RacingNumber]?.TeamColour ?? "71717a"}` }}
						/>
						<span className="font-mono text-sm font-black">{tla(referencePoint.driver.RacingNumber)}</span>
						<span className="text-zinc-500">P{referencePoint.driver.Position}</span>
					</span>

					{[points[referenceIndex - 1], points[referenceIndex + 1]].map((rival, index) => {
						if (!rival) return null;
						const trend = trends.get(rival.driver.RacingNumber)?.reference;

						return (
							<span key={`rival.${rival.driver.RacingNumber}`} className="text-zinc-400 tabular-nums">
								<span className="text-zinc-500">{index === 0 ? "Ahead" : "Behind"} </span>
								{tla(rival.driver.RacingNumber)} {formatSigned(rival.rel)}
								{trend && <TrendText trend={trend} className="ml-1" />}
							</span>
						);
					})}

					{pitWindow && (
						<span className="text-sky-400 tabular-nums">
							<span className="text-sky-600">Pit {pitLoss}s </span>
							{pitWindow.position === pitWindow.current
								? `keeps P${pitWindow.position}`
								: `rejoins P${pitWindow.position}`}
							{pitWindow.ahead && `, ${pitWindow.ahead.margin.toFixed(1)}s behind ${tla(pitWindow.ahead.nr)}`}
							{pitWindow.behind && `, ${pitWindow.behind.margin.toFixed(1)}s ahead of ${tla(pitWindow.behind.nr)}`}
						</span>
					)}

					<span className="ml-auto flex items-center gap-1.5">
						<Link
							href={`/dashboard/driver/${referencePoint.driver.RacingNumber}`}
							className="rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-300"
						>
							Driver page
						</Link>
						<button
							type="button"
							className="cursor-pointer rounded border border-zinc-700 px-1.5 py-0.5 text-zinc-400"
							onClick={() => setSelected(null)}
						>
							Clear
						</button>
					</span>
				</div>
			) : (
				<div className="border-b border-zinc-800 px-3 py-1 text-xs text-zinc-600">
					Select a driver to see gaps{isRace && ", trends and the pit window"} relative to them.
				</div>
			)}

			<div className="relative flex-1 overflow-x-hidden overflow-y-auto px-2 py-4 sm:px-3">
				<div className="relative mx-auto min-h-[1040px] w-full max-w-5xl">
					<div className="absolute top-0 bottom-0 left-5 w-px bg-zinc-800" />
					<div className="absolute top-0 left-2 h-px w-7 bg-zinc-600" />
					<div className="absolute bottom-0 left-2 h-px w-7 bg-zinc-600" />

					{ticks.map((tick) => (
						<div key={`tick.${tick.value}`} className="absolute right-0 left-0" style={{ top: tick.y }}>
							<div className={clsx("absolute left-3 h-px w-5", tick.value === 0 ? "bg-zinc-400" : "bg-zinc-700")} />
							<div className="absolute left-10 -translate-y-1/2 text-[10px] text-zinc-600 tabular-nums">
								{reference && tick.value > 0 && "+"}
								{tick.value}s
							</div>
							<div className="absolute right-0 left-20 h-px bg-zinc-900 sm:left-24" />
						</div>
					))}

					{cutoff && (
						<div className="absolute right-0 left-0" style={{ top: cutoff.y }}>
							<div className="absolute right-0 left-3 border-t border-red-500/70" />
							<div className="absolute left-7 -translate-y-1/2 rounded bg-zinc-950 px-1 text-[10px] font-black text-red-400">
								CUT
							</div>
						</div>
					)}

					{pitWindow && (
						<div className="absolute right-0 left-0" style={{ top: toY(pitWindow.gap - referenceGap) }}>
							<div className="absolute right-0 left-3 border-t border-dashed border-sky-500/70" />
							<div className="absolute left-[17px] h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-sky-400 bg-zinc-950" />
							<div className="absolute left-7 -translate-y-1/2 rounded bg-zinc-950 px-1 text-[10px] font-black text-sky-400">
								PIT
							</div>
						</div>
					)}

					{showConnectors &&
						points.slice(1).map((point, index) => {
							const previous = points[index];
							const interval = point.gap - previous.gap;
							if (interval <= 0) return null;

							const tone = trends.get(point.driver.RacingNumber)?.interval?.tone;
							const feed = point.driver.IntervalToPositionAhead?.Catching;
							const catching = tone === "closing" || (tone === undefined && feed === true);
							const dropping = tone === "opening" || (tone === undefined && feed === false);

							return (
								<div
									key={`connector.${point.driver.RacingNumber}`}
									className="absolute left-[17px] w-px"
									style={{
										top: previous.rawY,
										height: Math.max(0, point.rawY - previous.rawY),
									}}
								>
									<div
										className={clsx("h-full w-px", {
											"bg-emerald-500/40": catching,
											"bg-red-500/40": dropping,
											"bg-zinc-700/60": !catching && !dropping,
										})}
									/>
									<div
										className={clsx(
											"absolute top-1/2 left-4 -translate-y-1/2 rounded bg-zinc-950/90 px-1 py-px text-[10px] font-medium whitespace-nowrap tabular-nums",
											{
												"text-emerald-400": catching,
												"text-red-400": dropping,
												"text-zinc-500": !catching && !dropping,
											},
										)}
									>
										+{interval.toFixed(3)}
									</div>
								</div>
							);
						})}

					{points.map((point) => {
						const driver = point.driver;
						const nr = driver.RacingNumber;
						const teamColour = `#${drivers[nr]?.TeamColour ?? "71717a"}`;
						const penalty = isRace ? (flags.get(nr)?.penalty ?? 0) : 0;
						const labelPull = point.labelY - point.rawY;
						const trend = trends.get(nr);

						const gapLabel = reference
							? nr === reference
								? "REF"
								: formatSigned(point.rel)
							: point.gap === 0
								? "LEADER"
								: `+${point.gap.toFixed(3)}`;

						return (
							<div key={nr}>
								<div
									className="absolute left-[17px] z-10 h-2 w-2 -translate-x-1/2 rounded-full"
									style={{ top: point.rawY, backgroundColor: teamColour }}
								/>
								{penalty > 0 && (
									<div
										title={`${tla(nr)} with ${penalty}s penalty`}
										className="absolute left-[17px] z-10 h-2.5 w-2.5 -translate-x-1/2 rounded-full border-2 bg-zinc-950"
										style={{ top: toY(point.rel + penalty), borderColor: teamColour }}
									/>
								)}
								{Math.abs(labelPull) > 2 && (
									<div
										className="absolute left-6 w-16 border-t border-dashed border-zinc-700/50 sm:w-20"
										style={{
											top: point.rawY,
											transform: `translateY(${labelPull / 2}px) rotate(${labelPull > 0 ? 18 : -18}deg)`,
										}}
									/>
								)}

								{renderRow(driver, gapLabel, (reference ? trend?.reference : trend?.interval) ?? null, {
									className: "absolute right-0 left-20 sm:left-24",
									style: { top: point.labelY - 16 },
									onSelect: () => setSelected(nr === reference ? null : nr),
								})}
							</div>
						);
					})}
				</div>

				{offTrack.length > 0 && (
					<div className="mx-auto mt-6 flex w-full max-w-5xl flex-col gap-0.5 border-t border-zinc-800 pt-3 pl-20 sm:pl-24">
						<p className="mb-1 text-xs text-zinc-500">Lapped and out of the race</p>

						{offTrack.map((driver) => {
							const out = driver.Retired || driver.Stopped;
							return renderRow(driver, out ? "OUT" : `+${parseLapsDown(driver.GapToLeader)}L`, null);
						})}
					</div>
				)}
			</div>
		</div>
	);
}

type RowExtra = {
	className?: string;
	style?: CSSProperties;
	onSelect?: () => void;
};

type DriverRowProps = RowExtra & {
	driver: TimingDataDriver;
	meta: Driver | undefined;
	stint: Stint | undefined;
	drsOn: boolean;
	gapLabel: string;
	trend: Trend | null;
	flags: DriverFlags | undefined;
	penaltyPosition: number | undefined;
	favorite: boolean;
	danger: boolean;
	selected: boolean;
};

function DriverRow({
	driver,
	meta,
	stint,
	drsOn,
	gapLabel,
	trend,
	flags,
	penaltyPosition,
	favorite,
	danger,
	selected,
	className,
	style,
	onSelect,
}: DriverRowProps) {
	const inPit = driver.InPit || driver.PitOut;

	return (
		<div
			onClick={onSelect}
			style={style}
			className={clsx(
				"grid min-h-8 grid-cols-[4.25rem_4.25rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm shadow-lg shadow-black/20 select-none sm:grid-cols-[5rem_4.5rem_minmax(0,1fr)_auto_2.75rem] sm:gap-2",
				className,
				{
					"cursor-pointer": onSelect,
					"border-zinc-800 bg-zinc-900/95": !favorite && !danger && !selected,
					"border-sky-700 bg-sky-950/60": favorite && !selected,
					"border-red-800 bg-red-950/70": danger && !selected,
					"border-zinc-200 bg-zinc-800": selected,
					"opacity-45": driver.KnockedOut || driver.Retired || driver.Stopped,
				},
			)}
		>
			<div className="flex flex-col gap-0.5 overflow-hidden">
				<div className="flex items-center gap-1.5">
					<span className="w-4 text-right text-xs text-zinc-500 tabular-nums">{driver.Position}</span>
					<span
						className="h-5 w-1 shrink-0 rounded-full"
						style={{ backgroundColor: `#${meta?.TeamColour ?? "71717a"}` }}
					/>
					<span className="font-mono text-base leading-5 font-black">{meta?.Tla ?? driver.RacingNumber}</span>
				</div>

				{/* narrow screens have no room for the sectors next to the badges */}
				<div className="flex gap-0.5 md:hidden">
					{driver.Sectors.slice(0, 3).map((sector, index) => (
						<span
							key={`${driver.RacingNumber}.sector.small.${index}`}
							className={clsx("h-1 flex-1 rounded-full", sectorClass(sector))}
						/>
					))}
				</div>
			</div>

			<div className="text-right leading-tight tabular-nums">
				<div className="text-xs text-zinc-400">{gapLabel}</div>
				{trend && trend.tone !== "stable" && <TrendText trend={trend} className="block text-[10px]" />}
			</div>

			<div className="flex min-w-0 items-center gap-1 overflow-hidden">
				{inPit && <Badge className="border-sky-500 text-sky-400">{driver.PitOut ? "OUT" : "PIT"}</Badge>}
				{!inPit && drsOn && <Badge className="border-emerald-500 text-emerald-400">DRS</Badge>}
				{flags && flags.penalty > 0 && (
					<Badge className="border-red-500 text-red-400">
						+{flags.penalty}s
						{penaltyPosition !== undefined && penaltyPosition !== parseInt(driver.Position) && ` P${penaltyPosition}`}
					</Badge>
				)}
				{flags?.investigation && <Badge className="border-amber-500 text-amber-400">INV</Badge>}
				{flags?.warning && <Badge className="border-zinc-300 text-zinc-200">B/W</Badge>}
				{flags && flags.trackLimits > 0 && (
					<Badge
						className={flags.trackLimits >= 3 ? "border-amber-500 text-amber-400" : "border-zinc-700 text-zinc-400"}
					>
						TL{flags.trackLimits}
					</Badge>
				)}
				{driver.Cutoff && <span className="truncate text-xs text-zinc-500">Cutoff</span>}

				<div className="ml-auto hidden items-center gap-1 md:flex">
					{driver.Sectors.slice(0, 3).map((sector, index) => (
						<span
							key={`${driver.RacingNumber}.sector.${index}`}
							className={clsx("h-1.5 w-5 rounded-full", sectorClass(sector))}
						/>
					))}
				</div>
			</div>

			<div className="flex items-center justify-end gap-1">
				<Image src={tireIcon(stint?.Compound)} alt={stint?.Compound ?? "unknown tire"} width={18} height={18} />
				<span className="text-xs text-zinc-500 tabular-nums">{stint?.TotalLaps ?? 0}L</span>
			</div>

			<div
				className={clsx("hidden text-right text-xs font-medium tabular-nums sm:block", {
					"text-violet-400": driver.LastLapTime.OverallFastest,
					"text-emerald-400": driver.LastLapTime.PersonalFastest,
					"text-zinc-500": !driver.LastLapTime.Value,
				})}
			>
				{formatCompactLap(driver.LastLapTime.Value)}
			</div>
		</div>
	);
}
