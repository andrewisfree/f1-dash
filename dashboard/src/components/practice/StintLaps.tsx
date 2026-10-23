import clsx from "clsx";

import type { Stint } from "@/types/state.type";

import { formatLapTime, median, type PracticeLap } from "@/lib/practice";
import { formatSigned } from "@/lib/race";
import { heatChip, TONE_CHIP } from "@/lib/tones";

import TyreTag from "@/components/practice/TyreTag";

type Props = {
	laps: PracticeLap[];
	stints: Stint[];
};

const timed = (lap: PracticeLap) => (lap.kind === "push" || lap.kind === "long") && !lap.outlier;

function reasonFor(lap: PracticeLap) {
	if (lap.kind === "pit") return lap.lapTime === null ? "no time" : "pit or flag";
	if (lap.kind === "cool") return "slow lap";
	if (lap.outlier) return "traffic";
	return null;
}

/**
 * every lap of a driver, set by set, the last set first, coloured against the typical lap on the set
 */
export default function StintLaps({ laps, stints }: Props) {
	const byStint = new Map<number, PracticeLap[]>();
	for (const lap of laps) byStint.set(lap.stint, [...(byStint.get(lap.stint) ?? []), lap]);

	const groups = Array.from(byStint.entries()).sort((a, b) => b[0] - a[0]);
	if (groups.length === 0) return <p className="text-xs text-zinc-600">No laps recorded for this driver yet.</p>;

	return (
		<div className="flex flex-col gap-1.5">
			{groups.map(([number, stintLaps]) => {
				const times = stintLaps.filter(timed).map((lap) => lap.lapTime!);
				const reference = times.length > 0 ? median(times) : null;
				const longRun = stintLaps.some((lap) => lap.kind === "long");

				return (
					<div key={`stint.${number}`} className="flex flex-wrap items-center gap-1 text-xs">
						<span className="mr-1 flex w-24 shrink-0 items-center gap-1 text-zinc-500">
							<TyreTag stint={stints[number - 1]} age={stints[number - 1]?.TotalLaps} />
							{longRun && <span className="font-semibold text-emerald-400">long run</span>}
						</span>

						{stintLaps.map((lap) => {
							const reason = reasonFor(lap);
							const delta =
								reason === null && reference !== null && lap.lapTime !== null ? lap.lapTime - reference : null;

							return (
								<span
									key={`lap.${lap.lap}`}
									className={clsx(
										"rounded px-1 py-0.5 tabular-nums",
										reason !== null ? TONE_CHIP.excluded : lap.personalBest ? TONE_CHIP.gain : heatChip(delta),
									)}
									title={`Lap ${lap.lap}${lap.tyreAge !== null ? `, tyre lap ${lap.tyreAge}` : ""}${reason ? `, ${reason}` : delta !== null ? `, ${formatSigned(delta, 2)} on the typical lap of the set` : ""}`}
								>
									<span className="mr-1 text-[10px] opacity-60">{lap.lap}</span>
									{lap.lapTime !== null ? formatLapTime(lap.lapTime) : "-"}
								</span>
							);
						})}

						{reference !== null && <span className="ml-1 text-zinc-500">typical {formatLapTime(reference)}</span>}
					</div>
				);
			})}
		</div>
	);
}
