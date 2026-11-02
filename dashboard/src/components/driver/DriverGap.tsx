import clsx from "clsx";

import type { TimingDataDriver } from "@/types/state.type";

type Props = {
	timingDriver: TimingDataDriver;
	sessionPart: number | undefined;
};

export default function DriverGap({ timingDriver, sessionPart }: Props) {
	const statsIdx = sessionPart ? sessionPart - 1 : 0;

	const gapToLeader =
		timingDriver.GapToLeader ||
		timingDriver.Stats?.[statsIdx]?.TimeDiffToFastest ||
		timingDriver.TimeDiffToFastest ||
		"";

	const gapToFront =
		timingDriver.IntervalToPositionAhead?.Value ||
		timingDriver.Stats?.[statsIdx]?.TimeDifftoPositionAhead ||
		timingDriver.TimeDiffToPositionAhead ||
		"";

	const catching = timingDriver.IntervalToPositionAhead?.Catching;

	return (
		<div className="place-self-start">
			<p
				className={clsx("text-lg leading-none font-medium tabular-nums", {
					"text-emerald-500": catching,
					"text-zinc-500": !gapToFront,
				})}
			>
				{!!gapToFront ? gapToFront : "-- ---"}
			</p>

			<p className="text-sm leading-none text-zinc-500 tabular-nums">{!!gapToLeader ? gapToLeader : "-- ---"}</p>
		</div>
	);
}
