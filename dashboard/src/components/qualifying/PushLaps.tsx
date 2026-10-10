"use client";

import clsx from "clsx";

import type { State } from "@/types/state.type";

import { getBestSectors, getPushLap, type Board, type BoardRow, type PushLap } from "@/lib/qualifyingBoard";
import { formatSigned } from "@/lib/race";

import Badge from "@/components/driver/Badge";

type Props = {
	board: Board;
	state: State;
};

function formatLap(seconds: number) {
	const minutes = Math.floor(seconds / 60);
	const rest = (seconds - minutes * 60).toFixed(3).padStart(6, "0");
	return minutes > 0 ? `${minutes}:${rest}` : rest;
}

function segmentClass(status: number) {
	if (status === 2051) return "bg-violet-600";
	if (status === 2049) return "bg-emerald-500";
	if (status === 2048 || status === 2052) return "bg-amber-400";
	if (status === 2064) return "bg-blue-500";
	return "bg-zinc-800";
}

/**
 * the drivers on a push lap right now, with the lap time they are heading for
 */
export default function PushLaps({ board, state }: Props) {
	const laps = board.rows
		.flatMap((row) => {
			const lap = getPushLap(row, getBestSectors(state.TimingStats, row.driver.RacingNumber), board.rows);
			return lap ? [{ row, lap }] : [];
		})
		.sort((a, b) => b.lap.progress - a.lap.progress);

	return (
		<div className="rounded-lg border border-zinc-800 p-2">
			<p className="mb-1.5 px-1 text-xs text-zinc-500">
				On a push lap{laps.length > 0 && ` · ${laps.length}`}
				<span className="ml-2 text-zinc-600">time they are heading for, with their best sectors for the rest</span>
			</p>

			{laps.length === 0 && <p className="px-1 pb-1 text-sm text-zinc-600">Nobody is pushing right now.</p>}

			<div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
				{laps.map(({ row, lap }) => (
					<PushLine key={`push.${row.driver.RacingNumber}`} row={row} lap={lap} board={board} state={state} />
				))}
			</div>
		</div>
	);
}

type PushLineProps = Props & {
	row: BoardRow;
	lap: PushLap;
};

function PushLine({ row, lap, board, state }: PushLineProps) {
	const driver = row.driver;
	const meta = state.DriverList?.[driver.RacingNumber];
	const improving = lap.improvement !== null && lap.improvement < 0;
	const first = row.seconds === null;
	const fastest = lap.position === 1 && lap.projected !== null;
	const advancing = board.cutoff && lap.position ? lap.position <= board.cutoff : null;
	const last = driver.LastLapTime;

	return (
		<div
			className={clsx("rounded-md border px-2 py-1.5", {
				"border-violet-500/70 bg-violet-950/20": fastest,
				"border-emerald-500/60 bg-emerald-950/20": !fastest && (improving || (first && lap.projected !== null)),
				"border-zinc-800 bg-zinc-900/60": !fastest && !improving && !(first && lap.projected !== null),
			})}
		>
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-1.5">
					<span
						className="h-5 w-1 shrink-0 rounded-full"
						style={{ backgroundColor: `#${meta?.TeamColour ?? "71717a"}` }}
					/>
					<span className="font-mono text-base leading-5 font-black">{meta?.Tla ?? driver.RacingNumber}</span>
					<span className="text-xs text-zinc-500 tabular-nums">P{row.position}</span>
					{!lap.finished && lap.improvement !== null && (
						<Badge
							className={clsx({
								"border-violet-500 text-violet-400": fastest,
								"border-emerald-500 text-emerald-400": improving && !fastest,
								"border-amber-500 text-amber-400": !improving && !fastest,
							})}
						>
							{fastest ? "POLE PACE" : improving ? "IMPROVING" : "SLOWER"}
						</Badge>
					)}
					{lap.finished && (
						<Badge
							className={clsx({
								"border-violet-500 text-violet-400": last?.OverallFastest,
								"border-emerald-500 text-emerald-400": last?.PersonalFastest && !last?.OverallFastest,
								"border-zinc-700 text-zinc-400": !last?.PersonalFastest && !last?.OverallFastest,
							})}
						>
							{last?.OverallFastest ? "FASTEST" : last?.PersonalFastest ? "IMPROVED" : "NO GAIN"}
						</Badge>
					)}
				</div>

				<div className="flex items-baseline gap-2 tabular-nums">
					{lap.improvement !== null && (
						<span className={clsx("text-xs font-semibold", improving ? "text-emerald-400" : "text-amber-400")}>
							{formatSigned(lap.improvement)}
						</span>
					)}
					<span className="text-base font-semibold">
						{lap.projected !== null ? formatLap(lap.projected) : "-:--.---"}
					</span>
					{lap.position !== null && (
						<span
							className={clsx("w-8 text-right text-sm font-black", {
								"text-violet-400": fastest,
								"text-emerald-400": !fastest && advancing === true,
								"text-red-400": !fastest && advancing === false,
								"text-zinc-300": !fastest && advancing === null,
							})}
						>
							P{lap.position}
						</span>
					)}
				</div>
			</div>

			<div className="mt-1.5 grid grid-cols-3 gap-1.5">
				{driver.Sectors.slice(0, 3).map((sector, index) => {
					const info = lap.sectors[index];

					return (
						<div key={`sector.${index}`}>
							<div className="flex gap-px">
								{(sector.Segments ?? []).map((segment, segmentIndex) => (
									<span
										key={`segment.${segmentIndex}`}
										className={clsx("h-1.5 flex-1 rounded-full", segmentClass(segment.Status))}
									/>
								))}
							</div>
							<p
								className={clsx("mt-1 rounded px-1 py-0.5 text-center text-xs font-semibold tabular-nums", {
									"bg-violet-600 text-white": info?.tone === "best",
									"bg-emerald-500 text-black": info?.tone === "improved",
									"bg-amber-400 text-black": info?.tone === "slower",
									"bg-zinc-800 text-zinc-600": !info?.done,
								})}
							>
								{info?.done && info.time !== null ? info.time.toFixed(3) : `S${index + 1}`}
								{info?.loss != null && (
									<span className="ml-1 font-normal opacity-70">{formatSigned(info.loss, 2)}</span>
								)}
							</p>
						</div>
					);
				})}
			</div>
		</div>
	);
}
