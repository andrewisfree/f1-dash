"use client";

import { useState } from "react";
import clsx from "clsx";

import type { State } from "@/types/state.type";

import { formatLapTime, getBestLaps, type PracticeLap } from "@/lib/practice";
import { formatSigned } from "@/lib/race";

import Badge from "@/components/driver/Badge";
import CompoundFilter, { type Compound } from "@/components/practice/CompoundFilter";
import TyreTag from "@/components/practice/TyreTag";

type Props = {
	state: State;
	laps: Record<string, PracticeLap[]>;
	compounds: Compound[];
};

/**
 * best lap of every driver with the tyre it was set on and what was left in the sectors
 */
export default function BestLaps({ state, laps, compounds }: Props) {
	const [compound, setCompound] = useState<Compound | null>(null);

	const lines = state.TimingData?.Lines ?? {};
	const appData = state.TimingAppData?.Lines;
	const rows = getBestLaps(lines, state.TimingStats?.Lines, laps, appData, compound);

	return (
		<div className="rounded-lg border border-zinc-800 p-2">
			<div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 px-1">
				<p className="text-xs text-zinc-500">
					Best laps
					<span className="ml-2 text-zinc-600">
						{compound
							? "on this compound, from the laps seen on this page"
							: "ideal lap is the sum of the best sectors"}
					</span>
				</p>
				<CompoundFilter compounds={compounds} value={compound} onChange={setCompound} />
			</div>

			<div className="overflow-x-auto">
				<table className="w-full min-w-[640px] text-sm tabular-nums">
					<thead>
						<tr className="text-left text-[10px] tracking-wide text-zinc-500 uppercase">
							<th className="px-1 py-1 font-normal">Pos</th>
							<th className="px-1 py-1 font-normal">Driver</th>
							<th className="px-1 py-1 text-right font-normal">Best</th>
							<th className="px-1 py-1 text-right font-normal">Gap</th>
							<th className="px-1 py-1 font-normal">Tyre</th>
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

							return (
								<tr key={`best.${nr}`} className="border-t border-zinc-900">
									<td className="px-1 py-1 text-zinc-500">{row.best !== null ? index + 1 : "-"}</td>
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
											"text-violet-400": index === 0 && row.best !== null,
										})}
									>
										{formatLapTime(row.best)}
									</td>
									<td className="px-1 py-1 text-right text-zinc-400">
										{row.gap !== null && index > 0 ? `+${row.gap.toFixed(3)}` : ""}
									</td>
									<td className="px-1 py-1">
										<TyreTag stint={row.stint} age={row.lap?.tyreAge} />
									</td>
									<td className="px-1 py-1 text-right text-zinc-400">{compound ? "" : formatLapTime(row.ideal)}</td>
									<td
										className={clsx("px-1 py-1 text-right", {
											"text-amber-400": left !== null && left >= 0.2,
											"text-zinc-500": left !== null && left < 0.2,
										})}
									>
										{left !== null ? formatSigned(left) : ""}
									</td>
									{[0, 1, 2].map((sectorIndex) => {
										const sector = row.sectors[sectorIndex];
										return (
											<td
												key={`sector.${sectorIndex}`}
												className={clsx("px-1 py-1 text-right", sector?.fastest ? "text-violet-400" : "text-zinc-300")}
											>
												{sector?.time != null ? sector.time.toFixed(3) : ""}
											</td>
										);
									})}
									<td className={clsx("px-1 py-1 text-right", row.speed.fastest ? "text-violet-400" : "text-zinc-400")}>
										{row.speed.value ?? ""}
									</td>
									<td className="px-1 py-1 text-right text-zinc-500">
										<span className="inline-flex items-center gap-1.5">
											{row.driver.NumberOfLaps ?? 0}
											<TyreTag stint={current} age={current?.TotalLaps} />
										</span>
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</div>
	);
}
