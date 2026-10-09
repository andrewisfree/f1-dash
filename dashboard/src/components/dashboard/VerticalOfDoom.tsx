"use client";

import { useMemo } from "react";
import Image from "next/image";
import clsx from "clsx";

import { computeGapsSeconds, formatCompactLap, getOrderedTimingDrivers, mapGapToUnit, type GapScale } from "@/lib/gaps";
import { inDangerZone } from "@/lib/qualifying";
import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { Sector, TimingDataDriver } from "@/types/state.type";

const TRACK_HEIGHT = 1040;
const MIN_LABEL_GAP = 34;

type DriverPoint = {
	driver: TimingDataDriver;
	gap: number;
	rawY: number;
	labelY: number;
	overMax: boolean;
};

function hasDRS(drs: number | undefined) {
	return typeof drs === "number" && drs > 9;
}

function tireIcon(compound?: string) {
	const normalized = compound?.toLowerCase();
	return ["soft", "medium", "hard", "intermediate", "wet"].includes(normalized ?? "")
		? `/tires/${normalized}.svg`
		: "/tires/unknown.svg";
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
	const favoriteDrivers = useSettingsStore((store) => store.favoriteDrivers);
	const scaleMode = useSettingsStore((store) => store.verticalScale);
	const topN = useSettingsStore((store) => store.verticalTopN);
	const fixedSeconds = useSettingsStore((store) => store.verticalFixedSeconds);
	const battleSeconds = useSettingsStore((store) => store.verticalBattleSeconds);
	const showConnectors = useSettingsStore((store) => store.verticalConnectors);

	const ordered = useMemo(() => getOrderedTimingDrivers(state?.TimingData?.Lines), [state?.TimingData?.Lines]);
	const visible = useMemo(() => {
		const count = topN > 0 ? Math.min(topN, ordered.length) : ordered.length;
		return ordered.slice(0, count);
	}, [ordered, topN]);
	const gaps = useMemo(
		() => computeGapsSeconds(ordered, state?.TimingData?.SessionPart),
		[ordered, state?.TimingData?.SessionPart],
	);

	const spreadSeconds = useMemo(() => {
		const values = visible.map((driver) => gaps.get(driver.RacingNumber) ?? 0).filter(Number.isFinite);
		return Math.max(1, values.length ? Math.max(...values) : fixedSeconds);
	}, [fixedSeconds, gaps, visible]);

	const scale: GapScale = useMemo(
		() => ({
			mode: scaleMode,
			battleSeconds,
			fixedSeconds,
			spreadSeconds,
		}),
		[battleSeconds, fixedSeconds, scaleMode, spreadSeconds],
	);

	const baseSeconds =
		scaleMode === "fixed"
			? Math.max(1, fixedSeconds)
			: scaleMode === "battle"
				? Math.max(1, spreadSeconds)
				: spreadSeconds;

	const points = useMemo(() => {
		const rawPoints = visible.map((driver) => {
			const gap = gaps.get(driver.RacingNumber) ?? 0;
			const unit = mapGapToUnit(gap, scale);

			return {
				driver,
				gap,
				rawY: Math.round(unit * TRACK_HEIGHT),
				overMax: gap > baseSeconds,
			};
		});

		return spreadLabels(rawPoints);
	}, [baseSeconds, gaps, scale, visible]);

	if (!state?.TimingData || !state.DriverList) {
		return (
			<div className="grid h-full min-h-[40rem] place-items-center rounded-lg border border-zinc-800 p-4">
				<div className="h-48 w-48 animate-pulse rounded-full border border-zinc-800" />
			</div>
		);
	}

	const sessionPart = state.TimingData.SessionPart;

	return (
		<div className="flex h-full min-h-[42rem] flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
			<div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
				<div>
					<h2 className="text-lg font-semibold">Vertical of Doom</h2>
					<p className="text-xs text-zinc-500">
						{scaleMode === "battle"
							? `Battle scale: first ${battleSeconds}s expanded`
							: scaleMode === "fixed"
								? `Fixed scale: ${fixedSeconds}s full height`
								: `Spread scale: ${spreadSeconds.toFixed(1)}s full height`}
					</p>
				</div>

				<div className="flex items-center gap-2 text-xs text-zinc-500">
					<span>{visible.length} drivers</span>
					<span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
					<span>DRS active</span>
				</div>
			</div>

			<div className="relative flex-1 overflow-x-hidden overflow-y-auto px-3 py-4">
				<div className="relative mx-auto min-h-[1040px] w-full max-w-5xl">
					<div className="absolute top-0 bottom-0 left-5 w-px bg-zinc-800" />
					<div className="absolute top-0 left-2 h-px w-7 bg-zinc-600" />
					<div className="absolute bottom-0 left-2 h-px w-7 bg-zinc-600" />

					{[1, 2, 3, 5, 10, 15, 20, 30].map((tick) => {
						if (tick > baseSeconds && scaleMode !== "battle") return null;
						const y = mapGapToUnit(tick, scale) * TRACK_HEIGHT;
						if (y > TRACK_HEIGHT) return null;

						return (
							<div key={tick} className="absolute right-0 left-0" style={{ top: y }}>
								<div className="absolute left-3 h-px w-5 bg-zinc-700" />
								<div className="absolute left-10 -translate-y-1/2 text-[10px] text-zinc-600 tabular-nums">{tick}s</div>
								<div className="absolute right-0 left-24 h-px bg-zinc-900" />
							</div>
						);
					})}

					{sessionPart && sessionPart < 3 && (
						<div
							className="absolute right-0 left-24 rounded-md border border-red-900/60 bg-red-950/20"
							style={{ top: "72%", bottom: 0 }}
						>
							<div className="p-2 text-xs font-medium text-red-400">Elimination zone</div>
						</div>
					)}

					{showConnectors &&
						points.slice(1).map((point, index) => {
							const previous = points[index];
							const interval = point.gap - previous.gap;
							if (interval <= 0) return null;

							const catching = point.driver.IntervalToPositionAhead?.Catching;
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
											"bg-emerald-500/40": catching === true,
											"bg-red-500/40": catching === false,
											"bg-zinc-700/60": catching === undefined,
										})}
									/>
									<div
										className={clsx("absolute top-1/2 left-4 -translate-y-1/2 rounded px-1 py-px text-[10px] font-medium tabular-nums whitespace-nowrap bg-zinc-950/90", {
											"text-emerald-400": catching === true,
											"text-red-400": catching === false,
											"text-zinc-500": catching === undefined,
										})}
									>
										+{interval.toFixed(3)}
									</div>
								</div>
							);
						})}

					{points.map((point) => {
						const driver = point.driver;
						const meta = state.DriverList?.[driver.RacingNumber];
						const appData = state.TimingAppData?.Lines[driver.RacingNumber];
						const stint = appData?.Stints?.[appData.Stints.length - 1];
						const drsOn = hasDRS(carsData?.[driver.RacingNumber]?.Channels?.[45]);
						const favorite = favoriteDrivers.includes(driver.RacingNumber);
						const danger = sessionPart !== undefined && inDangerZone(parseInt(driver.Position), sessionPart);
						const inactive = driver.Retired || driver.Stopped || driver.KnockedOut;
						const labelPull = point.labelY - point.rawY;

						return (
							<div key={driver.RacingNumber}>
								<div
									className="absolute left-[17px] z-10 h-2 w-2 -translate-x-1/2 rounded-full"
									style={{ top: point.rawY, backgroundColor: `#${meta?.TeamColour ?? "71717a"}` }}
								/>
								{Math.abs(labelPull) > 2 && (
									<div
										className="absolute left-6 w-20 border-t border-dashed border-zinc-700/50"
										style={{
											top: point.rawY,
											transform: `translateY(${labelPull / 2}px) rotate(${labelPull > 0 ? 18 : -18}deg)`,
										}}
									/>
								)}

								<div
									className={clsx(
										"absolute right-0 left-24 grid min-h-8 grid-cols-[6.5rem_4rem_4rem_1fr_4rem_5rem] items-center gap-2 rounded-md border px-2 py-1 text-sm shadow-lg shadow-black/20",
										{
											"border-zinc-800 bg-zinc-900/95": !favorite && !danger,
											"border-sky-700 bg-sky-950/60": favorite,
											"border-red-800 bg-red-950/70": danger,
											"opacity-45": inactive,
										},
									)}
									style={{ top: Math.max(0, point.labelY - 16) }}
								>
									<div className="flex items-center gap-2 overflow-hidden">
										<span className="w-5 text-right text-xs text-zinc-500 tabular-nums">{driver.Position}</span>
										<span
											className="h-5 w-1 rounded-full"
											style={{ backgroundColor: `#${meta?.TeamColour ?? "71717a"}` }}
										/>
										<span className="font-mono text-base font-black">{meta?.Tla ?? driver.RacingNumber}</span>
									</div>

									<div className="text-right text-xs text-zinc-400 tabular-nums">
										{point.gap === 0 ? "LEADER" : `+${point.gap.toFixed(3)}`}
									</div>

									<div
										className={clsx(
											"rounded border px-1 py-0.5 text-center text-[10px] font-black",
											drsOn ? "border-emerald-500 text-emerald-400" : "border-zinc-700 text-zinc-600",
										)}
									>
										{driver.InPit || driver.PitOut ? "PIT" : "DRS"}
									</div>

									<div className="flex min-w-0 items-center gap-2">
										{driver.Sectors.slice(0, 3).map((sector, index) => (
											<span
												key={`${driver.RacingNumber}.sector.${index}`}
												className={clsx("h-1.5 w-5 rounded-full", sectorClass(sector))}
											/>
										))}
										<span className="truncate text-xs text-zinc-500">
											{driver.Cutoff ? "Cutoff" : inactive ? "Inactive" : ""}
										</span>
									</div>

									<div className="flex items-center justify-end gap-1">
										<Image
											src={tireIcon(stint?.Compound)}
											alt={stint?.Compound ?? "unknown tire"}
											width={18}
											height={18}
										/>
										<span className="text-xs text-zinc-500 tabular-nums">{stint?.TotalLaps ?? 0}L</span>
									</div>

									<div
										className={clsx("text-right text-xs font-medium tabular-nums", {
											"text-violet-400": driver.LastLapTime.OverallFastest,
											"text-emerald-400": driver.LastLapTime.PersonalFastest,
											"text-zinc-500": !driver.LastLapTime.Value,
										})}
									>
										{formatCompactLap(driver.LastLapTime.Value)}
									</div>
								</div>
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
