"use client";

import { useMemo } from "react";
import Image from "next/image";
import clsx from "clsx";

import type { Driver, Stint } from "@/types/state.type";

import { getTrackStatusMessage } from "@/lib/getTrackStatusMessage";
import {
	BUBBLE_SECONDS,
	buildBoard,
	formatClock,
	getBestSectors,
	getDeletedLaps,
	getLapPhase,
	getOutLapMs,
	getPartStart,
	getPartTimes,
	getPushLap,
	getRemainingMs,
	type BoardRow,
	type LapPhase,
	type PushLap,
} from "@/lib/qualifyingBoard";
import { formatSigned } from "@/lib/race";
import { tireIcon } from "@/lib/tires";

import { useDataStore } from "@/stores/useDataStore";
import { useQualifyingStore } from "@/stores/useQualifyingStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

import { useNow } from "@/hooks/useNow";

import Badge from "@/components/driver/Badge";
import PushLaps from "@/components/qualifying/PushLaps";
import SectorBlock from "@/components/qualifying/SectorBlock";

// below this the last call is close
const LAST_CALL_WARNING_MS = 60_000;

const PHASE_LABEL: Record<LapPhase, string> = {
	pit: "PIT",
	out: "OUT LAP",
	push: "PUSH",
	slow: "SLOW",
	stopped: "STOP",
};

export default function QualifyingBoard() {
	const state = useDataStore((store) => store.state);
	const delay = useSettingsStore((store) => store.delay);
	const outLaps = useQualifyingStore((store) => store.outLaps);
	const now = useNow(1000);

	const board = useMemo(() => buildBoard(state?.TimingData), [state?.TimingData]);
	// drivers still running only show the laps deleted in this part
	const deleted = useMemo(() => {
		const messages = state?.RaceControlMessages?.Messages;
		const partStart = getPartStart(state?.SessionData?.Series, state?.TimingData?.SessionPart);

		return { session: getDeletedLaps(messages), part: getDeletedLaps(messages, partStart) };
	}, [state?.RaceControlMessages?.Messages, state?.SessionData?.Series, state?.TimingData?.SessionPart]);

	if (!state?.TimingData || !state.DriverList || !state.SessionInfo) {
		return (
			<div className="flex flex-col gap-2">
				<div className="h-28 animate-pulse rounded-lg bg-zinc-900" />
				<div className="h-96 animate-pulse rounded-lg bg-zinc-900" />
			</div>
		);
	}

	if (state.SessionInfo.Type !== "Qualifying") {
		return (
			<div className="rounded-lg border border-zinc-800 p-4 text-sm text-zinc-400">
				<p className="text-base font-semibold text-zinc-200">Qualifying mode</p>
				<p className="mt-1">
					This page follows the elimination line during qualifying and sprint qualifying. The current session is{" "}
					{state.SessionInfo.Name ?? "not a qualifying"}.
				</p>
			</div>
		);
	}

	const drivers = state.DriverList;
	const tla = (nr: string) => drivers[nr]?.Tla ?? nr;
	const prefix = state.SessionInfo.Name === "Sprint Qualifying" ? "SQ" : "Q";
	const noEntries = state.TimingData.NoEntries ?? [];
	const trackStatus = getTrackStatusMessage(state.TrackStatus?.Status ? parseInt(state.TrackStatus.Status) : undefined);
	const running = state.SessionStatus?.Status === "Started";

	// the state shown is delayed, so is its clock
	const remaining = getRemainingMs(state.ExtrapolatedClock, now - delay * 1000);
	const outLap = getOutLapMs(outLaps, board.fastest);
	const lastCall = remaining !== null && outLap !== null ? remaining - outLap : null;

	const advancing = board.rows.filter(
		(row) => row.state !== "eliminated" && (!board.cutoff || row.position <= board.cutoff),
	);
	const dropping = board.rows.filter(
		(row) => row.state !== "eliminated" && board.cutoff && row.position > board.cutoff,
	);
	const eliminated = board.rows.filter((row) => row.state === "eliminated");
	const lastIn = advancing[advancing.length - 1];
	const firstOut = dropping[0];

	const renderRow = (row: BoardRow) => {
		const nr = row.driver.RacingNumber;
		const stints = state.TimingAppData?.Lines[nr]?.Stints ?? [];

		return (
			<BoardLine
				key={`row.${nr}`}
				row={row}
				meta={drivers[nr]}
				stint={stints[stints.length - 1]}
				phase={getLapPhase(row.driver, getBestSectors(state.TimingStats, nr))}
				push={getPushLap(row, getBestSectors(state.TimingStats, nr), board.rows)}
				deleted={(row.state === "eliminated" ? deleted.session : deleted.part).get(nr) ?? 0}
				final={!board.cutoff}
				eliminatedIn={row.position > (noEntries[1] ?? Infinity) ? 1 : 2}
				prefix={prefix}
			/>
		);
	};

	return (
		<>
			<div className="rounded-lg border border-zinc-800 p-3">
				<div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
					<div className="flex items-end gap-3">
						<span className="text-4xl leading-none font-black">
							{prefix}
							{board.part ?? ""}
						</span>
						<span className="text-4xl leading-none font-black tabular-nums">
							{remaining !== null ? formatClock(remaining) : "-:--"}
						</span>
					</div>

					<div className="flex items-center gap-3 text-xs text-zinc-400">
						{!running && <span>{state.SessionStatus?.Status ?? "Not running"}</span>}
						{trackStatus && (
							<span className="flex items-center gap-1">
								<span className={clsx("h-1.5 w-1.5 rounded-full", trackStatus.color)} />
								{trackStatus.message}
							</span>
						)}
					</div>
				</div>

				{running && lastCall !== null && outLap !== null && remaining !== null && (
					<p
						className={clsx("mt-2 text-sm font-semibold", {
							"text-zinc-200": lastCall > LAST_CALL_WARNING_MS,
							"text-amber-400": lastCall > 0 && lastCall <= LAST_CALL_WARNING_MS,
							"text-red-400": lastCall <= 0,
						})}
					>
						{remaining <= 0
							? "Chequered flag, only laps already started count"
							: lastCall > 0
								? `Last call to leave the pits in ${formatClock(lastCall)}`
								: "Too late to leave the pits for another lap"}
						<span className="ml-2 text-xs font-normal text-zinc-500">
							out lap about {formatClock(outLap)}
							{outLaps.length > 0 ? `, from ${outLaps.length} seen` : ", estimated"}
						</span>
					</p>
				)}

				{board.cutoff && lastIn?.seconds != null && (
					<p className="mt-1 text-sm text-zinc-400 tabular-nums">
						Line at P{board.cutoff}: <span className="text-zinc-200">{lastIn.time}</span> (
						{tla(lastIn.driver.RacingNumber)})
						{firstOut?.margin != null && (
							<>
								, {tla(firstOut.driver.RacingNumber)} needs{" "}
								<span className="text-red-400">{Math.abs(firstOut.margin).toFixed(3)}</span>
							</>
						)}
					</p>
				)}
			</div>

			<PushLaps board={board} state={state} />

			<div className="rounded-lg border border-zinc-800 p-2">
				<div className="flex flex-col gap-0.5">
					{advancing.map(renderRow)}

					{board.cutoff && dropping.length > 0 && (
						<div className="my-1 flex items-center gap-2 text-[10px] font-black text-red-400">
							<span className="h-px flex-1 bg-red-500/70" />
							ELIMINATION LINE
							<span className="h-px flex-1 bg-red-500/70" />
						</div>
					)}

					{dropping.map(renderRow)}

					{eliminated.length > 0 && <p className="mt-3 mb-1 px-1 text-xs text-zinc-500">Eliminated</p>}
					{eliminated.map(renderRow)}
				</div>

				<p className="mt-2 px-1 text-xs text-zinc-600">
					Margin is the time to the elimination line. Sectors of the lap in progress: purple best of the session, green
					personal best, yellow slower. An arrow up and a green edge mark a driver on course to improve.
				</p>
			</div>

			<div className="overflow-x-auto rounded-lg border border-zinc-800 p-3">
				<p className="mb-2 text-xs text-zinc-500">Best lap per part</p>

				<table className="w-full text-right text-sm tabular-nums">
					<thead className="text-xs text-zinc-500">
						<tr>
							<th className="text-left font-normal">Driver</th>
							{[1, 2, 3].map((part) => (
								<th key={`part.${part}`} className="font-normal">
									{prefix}
									{part}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{board.rows.map((row) => {
							const times = getPartTimes(row.driver);

							return (
								<tr
									key={`parts.${row.driver.RacingNumber}`}
									className={clsx({ "text-zinc-500": row.state === "eliminated" })}
								>
									<td className="text-left">
										<span className="mr-2 inline-block w-5 text-right text-xs text-zinc-500">{row.position}</span>
										<span className="font-mono font-black">{tla(row.driver.RacingNumber)}</span>
									</td>
									{[0, 1, 2].map((part) => (
										<td key={`part.${part}`}>{times[part] || "-"}</td>
									))}
								</tr>
							);
						})}
					</tbody>
				</table>
			</div>
		</>
	);
}

type BoardLineProps = {
	row: BoardRow;
	meta: Driver | undefined;
	stint: Stint | undefined;
	phase: LapPhase;
	// the lap being pushed on, with the time it is heading for
	push: PushLap | null;
	deleted: number;
	// the last part has no elimination line
	final: boolean;
	eliminatedIn: number;
	prefix: string;
};

function BoardLine({ row, meta, stint, phase, push, deleted, final, eliminatedIn, prefix }: BoardLineProps) {
	const driver = row.driver;
	const out = row.state === "eliminated";
	const close = row.margin !== null && Math.abs(row.margin) < BUBBLE_SECONDS;
	// on a push lap the row says whether the driver is beating the best lap of the part
	const live = push && !push.finished ? push : null;
	const improving = !!live && live.improvement !== null && live.improvement < 0;
	const slower = !!live && live.improvement !== null && live.improvement >= 0;
	const polePace = !!live && live.position === 1 && live.projected !== null;
	const newTyre = stint?.New?.toLowerCase() === "true";

	const value = final ? row.gapToFastest : row.margin;

	return (
		<div
			className={clsx(
				"grid min-h-8 grid-cols-[1.25rem_3.5rem_4.25rem_3.5rem_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border px-2 py-0.5 text-sm sm:gap-3",
				{
					"border-zinc-800 bg-zinc-900/60": !close && !out,
					"border-amber-500/60 bg-amber-950/20": close && !out,
					"border-transparent opacity-50": out,
					"border-l-4 border-l-violet-500": polePace,
					"border-l-4 border-l-emerald-500": improving && !polePace,
				},
			)}
		>
			<span className="text-right text-xs text-zinc-500 tabular-nums">{row.position}</span>

			<div className="flex items-center gap-1.5">
				<span
					className="h-5 w-1 shrink-0 rounded-full"
					style={{ backgroundColor: `#${meta?.TeamColour ?? "71717a"}` }}
				/>
				<span className="font-mono text-base leading-5 font-black">{meta?.Tla ?? driver.RacingNumber}</span>
			</div>

			<span className={clsx("text-right tabular-nums", row.seconds === null ? "text-zinc-600" : "text-zinc-200")}>
				{row.time || "no time"}
			</span>

			<span
				className={clsx("text-right text-xs font-semibold tabular-nums", {
					"text-zinc-400": final || value === null,
					"text-emerald-400": !final && row.state === "safe",
					"text-amber-400": !final && row.state === "bubble",
					"text-red-400": !final && row.state === "out" && value !== null,
				})}
			>
				{out
					? `OUT ${prefix}${eliminatedIn}`
					: value === null
						? ""
						: final && value === 0
							? "POLE"
							: formatSigned(value)}
			</span>

			<div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
				{!out && (
					<Badge
						className={clsx({
							"hidden sm:inline": !!live,
							"border-zinc-700 text-zinc-500": phase === "pit" || phase === "slow",
							"border-sky-500 text-sky-400": phase === "out",
							"border-emerald-500 text-emerald-400": phase === "push",
							"border-red-500 text-red-400": phase === "stopped",
						})}
					>
						{PHASE_LABEL[phase]}
					</Badge>
				)}

				{live && (
					<span className="flex items-center gap-0.5">
						{live.sectors.map((sector, index) => (
							<SectorBlock key={`sector.${index}`} sector={sector} className="h-3 w-3.5 rounded-sm sm:w-5" />
						))}
						{(improving || slower) && (
							<span
								className={clsx("ml-0.5 text-xs leading-none font-black", {
									"text-violet-400": polePace,
									"text-emerald-400": improving && !polePace,
									"text-amber-400": slower,
								})}
							>
								{improving ? "▲" : "▼"}
							</span>
						)}
					</span>
				)}

				{deleted > 0 && (
					<Badge className="border-amber-500 text-amber-400">DEL{deleted > 1 ? ` ${deleted}` : ""}</Badge>
				)}
			</div>

			<div className="flex items-center justify-end gap-1">
				<Image src={tireIcon(stint?.Compound)} alt={stint?.Compound ?? "unknown tire"} width={16} height={16} />
				<span className={clsx("text-xs tabular-nums", newTyre ? "text-emerald-400" : "text-zinc-500")}>
					{newTyre ? "N" : "U"}
					{stint?.TotalLaps ?? 0}
				</span>
			</div>
		</div>
	);
}
