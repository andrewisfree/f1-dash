"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import clsx from "clsx";

import type { State } from "@/types/state.type";

import { FUEL_EFFECT, formatLapTime, LONG_RUN_LAPS, type LongRun } from "@/lib/practice";
import { formatSigned } from "@/lib/race";
import { tireIcon } from "@/lib/tires";

import LapChart, { type LapChartSeries } from "@/components/driver/LapChart";
import CompoundFilter, { type Compound } from "@/components/practice/CompoundFilter";
import TyreTag from "@/components/practice/TyreTag";

type Props = {
	state: State;
	runs: LongRun[];
	compounds: Compound[];
};

// runs drawn in the chart until the user picks
const DEFAULT_SELECTED = 4;
// a tenth per lap of tyre loss is a lot
const HIGH_DEGRADATION = 0.1;

const runKey = (run: LongRun) => `${run.nr}.${run.stint}.${run.laps[0].lap}`;

function ageRange(run: LongRun) {
	const first = run.laps[0].tyreAge;
	const last = run.laps[run.laps.length - 1].tyreAge;
	return first !== null && last !== null ? `${first}-${last}` : null;
}

/**
 * the race simulations, their pace and how fast the tyres go off
 */
export default function LongRuns({ state, runs, compounds }: Props) {
	const [compound, setCompound] = useState<Compound | null>(null);
	const [picked, setPicked] = useState<Set<string> | null>(null);

	const shown = useMemo(
		() => runs.filter((run) => !compound || run.compound === compound).sort((a, b) => a.average - b.average),
		[compound, runs],
	);

	// the best run of every compound tells how far apart the compounds are
	const byCompound = useMemo(() => {
		const best = new Map<Compound, LongRun>();
		for (const run of runs) {
			if (!run.compound) continue;
			const current = best.get(run.compound);
			if (!current || run.average < current.average) best.set(run.compound, run);
		}
		return Array.from(best.entries()).sort((a, b) => a[1].average - b[1].average);
	}, [runs]);

	const selected = picked ?? new Set(shown.slice(0, DEFAULT_SELECTED).map(runKey));
	const toggle = (key: string) => {
		const next = new Set(selected);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		setPicked(next);
	};

	const tla = (nr: string) => state.DriverList?.[nr]?.Tla ?? nr;
	const color = (nr: string) => `#${state.DriverList?.[nr]?.TeamColour ?? "71717a"}`;
	const fastest = shown[0]?.average ?? null;

	const drawn = new Set<string>();
	const series: LapChartSeries[] = shown
		.filter((run) => selected.has(runKey(run)))
		.map((run) => {
			// the faster run of a driver is solid, the others dashed
			const dashed = drawn.has(run.nr);
			drawn.add(run.nr);
			return {
				dashed,
				key: runKey(run),
				label: `${tla(run.nr)} ${run.compound?.[0] ?? "?"}`,
				color: color(run.nr),
				points: run.laps
					.filter((lap) => !lap.outlier)
					.map((lap, index) => ({ lap: lap.tyreAge ?? index + 1, value: lap.lapTime! })),
			};
		});

	return (
		<div className="rounded-lg border border-zinc-800 p-2">
			<div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
				<p className="text-xs text-zinc-500">
					Long runs{shown.length > 0 && ` · ${shown.length}`}
					<span className="ml-2 text-zinc-600">
						{LONG_RUN_LAPS}+ timed laps in a row on one set, traffic laps left out of the average
					</span>
				</p>
				<CompoundFilter compounds={compounds} value={compound} onChange={setCompound} />
			</div>

			{byCompound.length > 0 && (
				<div className="mb-2 flex flex-wrap gap-2 px-1">
					{byCompound.map(([name, run], index) => (
						<div
							key={`summary.${name}`}
							className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1"
						>
							<Image src={tireIcon(name)} alt={name} width={18} height={18} />
							<span className="text-sm font-semibold tabular-nums">{formatLapTime(run.average)}</span>
							<span className="font-mono text-xs font-black">{tla(run.nr)}</span>
							{index > 0 && (
								<span className="text-xs text-amber-400 tabular-nums">
									{formatSigned(run.average - byCompound[0][1].average)}
								</span>
							)}
						</div>
					))}
				</div>
			)}

			{shown.length === 0 && (
				<p className="px-1 pb-1 text-sm text-zinc-600">
					No long run seen yet. Runs show up once a driver strings {LONG_RUN_LAPS} timed laps together.
				</p>
			)}

			{shown.length > 0 && (
				<>
					<div className="overflow-x-auto">
						<table className="w-full min-w-[560px] text-sm tabular-nums">
							<thead>
								<tr className="text-left text-[10px] tracking-wide text-zinc-500 uppercase">
									<th className="px-1 py-1 font-normal">Driver</th>
									<th className="px-1 py-1 font-normal">Tyre</th>
									<th className="px-1 py-1 text-right font-normal">Laps</th>
									<th className="px-1 py-1 text-right font-normal">Average</th>
									<th className="px-1 py-1 text-right font-normal">Gap</th>
									<th className="px-1 py-1 text-right font-normal">Best</th>
									<th className="px-1 py-1 text-right font-normal" title="lap time change per lap, as timed">
										Trend
									</th>
									<th
										className="px-1 py-1 text-right font-normal"
										title={`tyre loss per lap, with ${FUEL_EFFECT}s per lap of fuel burn added back`}
									>
										Deg
									</th>
								</tr>
							</thead>

							<tbody>
								{shown.map((run) => {
									const key = runKey(run);
									const active = selected.has(key);

									return (
										<tr
											key={`run.${key}`}
											onClick={() => toggle(key)}
											className={clsx(
												"cursor-pointer border-t border-zinc-900",
												active ? "bg-zinc-900/70" : "opacity-60 hover:opacity-100",
											)}
										>
											<td className="px-1 py-1">
												<span className="flex items-center gap-1.5">
													<span
														className={clsx("h-4 w-1 shrink-0 rounded-full", !active && "opacity-40")}
														style={{ backgroundColor: color(run.nr) }}
													/>
													<span className="font-mono font-black">{tla(run.nr)}</span>
												</span>
											</td>
											<td className="px-1 py-1">
												<TyreTag
													stint={state.TimingAppData?.Lines?.[run.nr]?.Stints?.[run.stint - 1]}
													age={ageRange(run)}
												/>
											</td>
											<td className="px-1 py-1 text-right text-zinc-400">
												{run.used}
												{run.used < run.laps.length && <span className="text-zinc-600">/{run.laps.length}</span>}
											</td>
											<td className="px-1 py-1 text-right font-semibold">{formatLapTime(run.average)}</td>
											<td className="px-1 py-1 text-right text-zinc-400">
												{fastest !== null && run.average > fastest ? `+${(run.average - fastest).toFixed(3)}` : ""}
											</td>
											<td className="px-1 py-1 text-right text-zinc-400">{formatLapTime(run.best)}</td>
											<td className="px-1 py-1 text-right text-zinc-500">
												{run.slope !== null ? formatSigned(run.slope) : ""}
											</td>
											<td
												className={clsx("px-1 py-1 text-right font-semibold", {
													"text-red-400": run.degradation !== null && run.degradation >= HIGH_DEGRADATION,
													"text-zinc-200": run.degradation !== null && run.degradation < HIGH_DEGRADATION,
												})}
											>
												{run.degradation !== null ? formatSigned(run.degradation) : ""}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					</div>

					<div className="mt-3 px-1">
						<p className="mb-1 text-xs text-zinc-500">
							Pace by tyre lap
							<span className="ml-2 text-zinc-600">click a run in the table to add or remove it</span>
						</p>
						<LapChart
							series={series}
							format={(value) => formatLapTime(value)}
							emptyText="Pick a run in the table"
							height={260}
							axis={{ tick: "T", name: "Tyre lap" }}
						/>
					</div>
				</>
			)}
		</div>
	);
}
