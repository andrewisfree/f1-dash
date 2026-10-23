"use client";

import { Fragment, useMemo, useState } from "react";
import clsx from "clsx";

import type { State } from "@/types/state.type";

import { formatLapTime, getBestLaps, getDeletedTimes, type LongRun, type PracticeLap } from "@/lib/practice";
import { formatSigned } from "@/lib/race";
import { degradationTone, heatChip, TONE_TEXT } from "@/lib/tones";

import Badge from "@/components/driver/Badge";
import CompoundFilter, { type Compound } from "@/components/practice/CompoundFilter";
import StintLaps from "@/components/practice/StintLaps";
import TyreTag from "@/components/practice/TyreTag";

type Props = {
	state: State;
	laps: Record<string, PracticeLap[]>;
	runs: LongRun[];
	compounds: Compound[];
};

type Sort = "lap" | "pace";

/**
 * best lap and race pace of every driver, with the tyres they were set on and what was left in the sectors
 */
export default function BestLaps({ state, laps, runs, compounds }: Props) {
	const [compound, setCompound] = useState<Compound | null>(null);
	const [sort, setSort] = useState<Sort>("lap");
	// drivers whose laps are open under their row
	const [open, setOpen] = useState<Set<string>>(() => new Set());
	const toggle = (nr: string) =>
		setOpen((current) => {
			const next = new Set(current);
			if (next.has(nr)) next.delete(nr);
			else next.add(nr);
			return next;
		});

	const lines = state.TimingData?.Lines ?? {};
	const appData = state.TimingAppData?.Lines;

	// the race pace of a driver is the average of the fastest long run
	const pace = useMemo(() => {
		const best = new Map<string, LongRun>();
		for (const run of runs) {
			if (compound && run.compound !== compound) continue;
			const current = best.get(run.nr);
			if (!current || run.average < current.average) best.set(run.nr, run);
		}
		return best;
	}, [compound, runs]);

	const fastestPace = Math.min(...Array.from(pace.values()).map((run) => run.average));
	const deleted = useMemo(
		() => getDeletedTimes(state.RaceControlMessages?.Messages),
		[state.RaceControlMessages?.Messages],
	);
	const rows = getBestLaps(lines, state.TimingStats?.Lines, laps, appData, compound, deleted);
	if (sort === "pace") {
		rows.sort(
			(a, b) =>
				(pace.get(a.driver.RacingNumber)?.average ?? Infinity) -
					(pace.get(b.driver.RacingNumber)?.average ?? Infinity) || (a.best ?? Infinity) - (b.best ?? Infinity),
		);
	}

	return (
		<div className="rounded-lg border border-zinc-800 p-2">
			<div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
				<p className="text-xs text-zinc-500">
					Best laps
					<span className="ml-2 text-zinc-600">
						{compound ? "best lap of each driver on this compound" : "ideal lap is the sum of the best sectors"}
					</span>
				</p>
				<div className="flex items-center gap-3">
					<div className="flex items-center gap-1 text-xs">
						<span className="text-zinc-600">Sort</span>
						{(["lap", "pace"] as const).map((option) => (
							<button
								key={`sort.${option}`}
								type="button"
								onClick={() => setSort(option)}
								className={clsx(
									"rounded px-2 py-0.5",
									sort === option ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300",
								)}
							>
								{option === "lap" ? "Best lap" : "Race pace"}
							</button>
						))}
					</div>
					<CompoundFilter compounds={compounds} value={compound} onChange={setCompound} />
				</div>
			</div>

			<div className="overflow-x-auto">
				<table className="w-full min-w-[820px] text-sm tabular-nums">
					<thead>
						<tr className="text-left text-[10px] tracking-wide text-zinc-500 uppercase">
							<th className="px-1 py-1 font-normal">Pos</th>
							<th className="px-1 py-1 font-normal">Driver</th>
							<th className="px-1 py-1 text-right font-normal">Best</th>
							<th className="px-1 py-1 text-right font-normal">Gap</th>
							<th className="px-1 py-1 font-normal">Tyre</th>
							<th
								className="border-l border-zinc-800 bg-zinc-900/60 px-1 py-1 text-right font-normal text-zinc-300"
								title="average of the fastest long run"
							>
								Race pace
							</th>
							<th className="bg-zinc-900/60 px-1 py-1 text-right font-normal">Gap</th>
							<th
								className="border-r border-zinc-800 bg-zinc-900/60 px-1 py-1 text-right font-normal"
								title="tyre loss per lap on that run, fuel burn added back"
							>
								Deg
							</th>
							<th className="px-1 py-1 text-right font-normal">Ideal</th>
							<th className="px-1 py-1 text-right font-normal">Left</th>
							<th className="px-1 py-1 text-right font-normal">S1</th>
							<th className="px-1 py-1 text-right font-normal">S2</th>
							<th className="px-1 py-1 text-right font-normal">S3</th>
							<th className="px-1 py-1 text-right font-normal">Trap</th>
							<th className="px-1 py-1 text-right font-normal">Laps</th>
						</tr>
					</thead>

					<tbody>
						{rows.map((row, index) => {
							const nr = row.driver.RacingNumber;
							const meta = state.DriverList?.[nr];
							const stints = appData?.[nr]?.Stints ?? [];
							const current = stints[stints.length - 1];
							// the ideal only counts with the session best, not with a compound filter
							const left = !compound && row.best !== null && row.ideal !== null ? row.best - row.ideal : null;
							const run = pace.get(nr);
							const paceGap = run ? run.average - fastestPace : null;
							const ranked = sort === "lap" ? row.best !== null : !!run;

							return (
								<Fragment key={`best.${nr}`}>
									<tr
										onClick={() => toggle(nr)}
										className={clsx("cursor-pointer border-t border-zinc-900 hover:bg-zinc-900/60", {
											"bg-zinc-900/80": open.has(nr),
										})}
										title="show or hide the laps of every set"
									>
										<td className="px-1 py-1 text-zinc-500">{ranked ? index + 1 : "-"}</td>
										<td className="px-1 py-1">
											<span className="flex items-center gap-1.5">
												<span
													className="h-4 w-1 shrink-0 rounded-full"
													style={{ backgroundColor: `#${meta?.TeamColour ?? "71717a"}` }}
												/>
												<span className="font-mono font-black">{meta?.Tla ?? nr}</span>
												{row.driver.InPit ? (
													<Badge className="border-zinc-700 text-zinc-400">PIT</Badge>
												) : (
													!row.driver.Stopped &&
													!row.driver.Retired && <Badge className="border-emerald-700 text-emerald-400">TRACK</Badge>
												)}
											</span>
										</td>
										<td
											className={clsx("px-1 py-1 text-right font-semibold", {
												"text-violet-400": row.gap === 0,
											})}
										>
											{formatLapTime(row.best)}
										</td>
										<td className="px-1 py-1 text-right">
											{row.gap ? (
												<span className={clsx("rounded px-1", heatChip(row.gap))}>+{row.gap.toFixed(3)}</span>
											) : (
												""
											)}
										</td>
										<td className="px-1 py-1">
											<TyreTag stint={row.stint} age={row.lap?.tyreAge} />
										</td>
										<td className="border-l border-zinc-800 bg-zinc-900/60 px-1 py-1 text-right">
											{run ? (
												<span className="inline-flex items-center gap-1.5">
													<TyreTag stint={appData?.[nr]?.Stints?.[run.stint - 1]} />
													<span className={clsx("font-semibold", paceGap === 0 ? "text-violet-400" : "text-zinc-100")}>
														{formatLapTime(run.average)}
													</span>
													<span className="text-[10px] text-zinc-500">{run.used}L</span>
												</span>
											) : (
												<span className="text-zinc-700">-</span>
											)}
										</td>
										<td className="bg-zinc-900/60 px-1 py-1 text-right text-zinc-400">
											{paceGap ? (
												<span className={clsx("rounded px-1", heatChip(paceGap))}>+{paceGap.toFixed(3)}</span>
											) : (
												""
											)}
										</td>
										<td
											className={clsx(
												"border-r border-zinc-800 bg-zinc-900/60 px-1 py-1 text-right",
												TONE_TEXT[degradationTone(run?.degradation ?? null)],
											)}
										>
											{run?.degradation != null ? formatSigned(run.degradation, 2) : ""}
										</td>
										<td className="px-1 py-1 text-right text-zinc-400">{compound ? "" : formatLapTime(row.ideal)}</td>
										<td
											className={clsx("px-1 py-1 text-right", {
												"text-amber-400": left !== null && left >= 0.2,
												"text-zinc-500": left !== null && left < 0.2,
											})}
										>
											{left !== null ? (Math.abs(left) < 0.0005 ? "0.000" : formatSigned(left)) : ""}
										</td>
										{[0, 1, 2].map((sectorIndex) => {
											const sector = row.sectors[sectorIndex];
											return (
												<td
													key={`sector.${sectorIndex}`}
													className={clsx(
														"px-1 py-1 text-right",
														sector?.fastest ? "text-violet-400" : "text-zinc-300",
													)}
												>
													{sector?.time != null ? sector.time.toFixed(3) : ""}
												</td>
											);
										})}
										<td
											className={clsx("px-1 py-1 text-right", row.speed.fastest ? "text-violet-400" : "text-zinc-400")}
										>
											{row.speed.value ?? ""}
										</td>
										<td className="px-1 py-1 text-right text-zinc-500">
											<span className="inline-flex items-center gap-1.5">
												{row.driver.NumberOfLaps ?? 0}
												<TyreTag stint={current} age={current?.TotalLaps} />
											</span>
										</td>
									</tr>
									{open.has(nr) && (
										<tr className="bg-zinc-900/40">
											<td colSpan={15} className="px-1 py-2">
												{/* stays in view while the wide table scrolls sideways */}
												<div className="sticky left-1 max-w-[calc(100vw-3rem)] lg:max-w-none">
													<StintLaps laps={laps[nr] ?? []} stints={stints} />
												</div>
											</td>
										</tr>
									)}
								</Fragment>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
