import Image from "next/image";
import Link from "next/link";
import clsx from "clsx";

import type { Driver, Stint, TimingStatsDriver } from "@/types/state.type";

import type { DriverFlags } from "@/lib/raceControl";
import type { Battle, CarView, Mode } from "@/lib/pitwall";
import { formatLapTime } from "@/lib/practice";
import type { BoardRow, PushLap } from "@/lib/qualifyingBoard";
import { describeStatus, formatSigned } from "@/lib/race";
import { tireIcon } from "@/lib/tires";
import {
	degradationTone,
	deltaTone,
	heatChip,
	lapTone,
	rivalTone,
	TONE_BORDER,
	TONE_CHIP,
	TONE_TEXT,
	tyreWear,
	type Tone,
} from "@/lib/tones";

import Badge from "@/components/driver/Badge";
import TrendText from "@/components/driver/TrendText";
import { Chip, GapBar, StintStrip, Tile, TyreWearBar } from "@/components/panel/Panel";

// laps shown as coloured chips under the tiles
const LAP_STRIP = 12;

const BOARD_TONE: Record<BoardRow["state"], Tone> = {
	safe: "gain",
	bubble: "warn",
	out: "loss",
	eliminated: "excluded",
	none: "neutral",
};

type Props = {
	car: CarView;
	mode: Mode;
	meta: Driver | undefined;
	stats: TimingStatsDriver | undefined;
	flags: DriverFlags | undefined;
	tla: (nr: string) => string;
	pitLoss: number;
	qualifying: { row: BoardRow | null; push: PushLap | null; cutoff: number | undefined };
};

export default function CarPanel({ car, mode, meta, stats, flags, tla, pitLoss, qualifying }: Props) {
	const { driver, stint, ahead, behind } = car;
	const out = driver.Retired || driver.Stopped;
	const rank = stats?.PersonalBestLapTime?.Position;
	const degradation = car.degradation(car.stints.length);
	const status =
		mode === "race" && !out
			? describeStatus(
					ahead ? { tla: tla(ahead.nr), trend: ahead.trend } : null,
					behind ? { tla: tla(behind.nr), trend: behind.trend } : null,
				)
			: null;
	const paceVsAhead = car.pace !== null && ahead?.pace != null ? car.pace - ahead.pace : null;

	return (
		<div
			className="flex min-w-0 flex-col gap-2 rounded-lg border border-t-4 border-zinc-800 p-3"
			style={{ borderTopColor: `#${meta?.TeamColour ?? "71717a"}` }}
		>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<Link href={`/dashboard/driver/${car.nr}`} className="flex items-center gap-3">
					<span className="text-4xl leading-none font-black tabular-nums">P{driver.Position}</span>
					<div>
						<p className="font-mono text-xl leading-tight font-black">{tla(car.nr)}</p>
						<p className="text-xs text-zinc-500">
							{meta?.FullName} · #{car.nr}
						</p>
					</div>
				</Link>

				<div className="flex flex-wrap items-center gap-1.5">
					{out && <Badge className="border-zinc-500 text-zinc-300">OUT</Badge>}
					{(driver.InPit || driver.PitOut) && (
						<Badge className="border-sky-500 text-sky-400">{driver.PitOut ? "PIT EXIT" : "IN PIT"}</Badge>
					)}
					{flags && flags.penalty > 0 && <Badge className="border-red-500 text-red-400">+{flags.penalty}s</Badge>}
					{flags?.investigation && <Badge className="border-amber-500 text-amber-400">INVESTIGATION</Badge>}
					{flags && flags.trackLimits > 0 && (
						<Badge
							className={flags.trackLimits >= 3 ? "border-amber-500 text-amber-400" : "border-zinc-700 text-zinc-400"}
						>
							TL {flags.trackLimits}
						</Badge>
					)}
				</div>
			</div>

			{status && (
				<p
					className={clsx("text-sm font-semibold", {
						"text-emerald-400": status.tone === "attack",
						"text-red-400": status.tone === "warning",
						"text-zinc-300": status.tone === "neutral",
					})}
				>
					{status.text}
				</p>
			)}

			<div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
				{mode === "race" && (
					<>
						<BattleTile battle={ahead} tla={tla} />
						<BattleTile battle={behind} tla={tla} />
						<Tile
							label={ahead ? `Pace vs ${tla(ahead.nr)}` : "Pace, 3 laps"}
							tone={deltaTone(paceVsAhead)}
							note={car.pace !== null ? formatLapTime(car.pace) : "needs 3 clean laps"}
						>
							{paceVsAhead !== null ? formatSigned(paceVsAhead, 2) : "-"}
						</Tile>
					</>
				)}

				{mode === "qualifying" && (
					<>
						<Tile
							label="Elimination line"
							tone={qualifying.row ? BOARD_TONE[qualifying.row.state] : "neutral"}
							note={qualifying.cutoff ? `cut at P${qualifying.cutoff}` : "final part"}
						>
							{qualifying.row?.margin != null ? formatSigned(qualifying.row.margin) : (qualifying.row?.state ?? "-")}
						</Tile>
						<Tile
							label="Push lap heading for"
							tone={
								qualifying.push?.position === 1
									? "best"
									: qualifying.push?.improvement != null
										? deltaTone(qualifying.push.improvement)
										: "neutral"
							}
							note={qualifying.push?.position ? `would be P${qualifying.push.position}` : car.activity.text}
						>
							{qualifying.push?.projected != null ? formatLapTime(qualifying.push.projected) : "-"}
						</Tile>
						<Tile label="Best lap" tone={rank === 1 ? "best" : "neutral"} note={rank ? `P${rank}` : ""}>
							{driver.BestLapTime?.Value || "-"}
						</Tile>
					</>
				)}

				{mode === "practice" && (
					<>
						<Tile
							label="Best lap"
							tone={rank === 1 ? "best" : rank !== undefined && rank <= 3 ? "gain" : "neutral"}
							note={
								rank
									? `P${rank}${ahead?.interval != null ? ` · +${ahead.interval.toFixed(3)} to ${tla(ahead.nr)}` : ""}`
									: ""
							}
						>
							{driver.BestLapTime?.Value || "-"}
						</Tile>
						<Tile
							label="Doing"
							tone={car.activity.kind === "long" ? "gain" : car.activity.kind === "push" ? "best" : "neutral"}
						>
							<span className="text-base">{car.activity.text}</span>
						</Tile>
						<Tile
							label="Race pace"
							tone={
								car.longRunRank === 1 ? "best" : car.longRunRank !== null && car.longRunRank <= 3 ? "gain" : "neutral"
							}
							note={
								car.longRun
									? `${car.longRun.compound?.[0] ?? "?"} · ${car.longRun.used}L · P${car.longRunRank} on the compound`
									: "no long run yet"
							}
						>
							{car.longRun ? formatLapTime(car.longRun.average) : "-"}
						</Tile>
					</>
				)}

				<Tile label="Last lap" tone={lapTone(driver.LastLapTime)}>
					{driver.LastLapTime?.Value || "-"}
				</Tile>
				<TyreTile stint={stint} degradation={degradation} stops={mode === "race" ? car.stints.length - 1 : null} />
				<Tile label="Sectors">
					<span className="flex flex-wrap gap-1 text-sm">
						{driver.Sectors.slice(0, 3).map((sector, index) => (
							<span
								key={`sector.${index}`}
								className={clsx(
									"rounded px-1",
									TONE_CHIP[
										sector.OverallFastest
											? "best"
											: sector.PersonalFastest
												? "gain"
												: sector.Value
													? "warn"
													: "excluded"
									],
								)}
							>
								{sector.Value || "-"}
							</span>
						))}
					</span>
				</Tile>
			</div>

			<StintStrip stints={car.stints} degradation={car.degradation} />

			<LapStrip car={car} />

			{mode === "race" && car.pitWindow && !out && (
				<p className="text-sm">
					<span className="text-zinc-500">Stop now ({pitLoss}s): </span>
					{car.pitWindow.position === car.pitWindow.current ? (
						<span className="font-semibold text-emerald-400">keeps P{car.pitWindow.position}</span>
					) : (
						<span className="font-semibold text-amber-400">
							rejoins P{car.pitWindow.position}
							{car.pitWindow.lostTo.length > 0 && `, behind ${car.pitWindow.lostTo.map(tla).join(", ")}`}
						</span>
					)}
				</p>
			)}

			{car.undercut.threat && (
				<p className="rounded bg-red-500/15 px-2 py-1 text-sm text-red-300">
					Undercut risk: {tla(car.undercut.threat.nr)} {car.undercut.threat.interval?.toFixed(1)}s behind, our set{" "}
					{stint?.TotalLaps ?? 0} laps old
				</p>
			)}
			{car.undercut.chance && (
				<p className="rounded bg-emerald-500/15 px-2 py-1 text-sm text-emerald-300">
					Undercut chance on {tla(car.undercut.chance.nr)}, {car.undercut.chance.interval?.toFixed(1)}s ahead on a{" "}
					{car.undercut.chance.stint?.TotalLaps ?? 0} lap old set
				</p>
			)}

			{mode === "practice" && car.compoundLaps.length > 0 && (
				<div className="flex flex-wrap gap-2 text-xs text-zinc-400">
					{car.compoundLaps.map(({ compound, laps }) => (
						<span key={`compound.${compound}`} className="flex items-center gap-1">
							<Image src={tireIcon(compound)} alt={compound} width={14} height={14} />
							{laps}L
						</span>
					))}
				</div>
			)}
		</div>
	);
}

function BattleTile({ battle, tla }: { battle: Battle | null; tla: (nr: string) => string }) {
	if (!battle) {
		return <Tile label="Free air">-</Tile>;
	}

	const tone = rivalTone(battle.trend, battle.role);

	return (
		<Tile
			label={battle.role === "ahead" ? `Ahead: ${tla(battle.nr)}` : `Behind: ${tla(battle.nr)}`}
			tone={tone}
			note={
				<>
					{battle.interval !== null && <GapBar gap={battle.interval} tone={tone} />}
					{battle.trend && <TrendText trend={battle.trend} />}
				</>
			}
		>
			{battle.interval !== null ? battle.interval.toFixed(2) : "-"}
		</Tile>
	);
}

function TyreTile({ stint, degradation, stops }: { stint?: Stint; degradation: number | null; stops: number | null }) {
	const wear = tyreWear(stint);

	return (
		<Tile
			label="Tyre"
			tone={wear?.tone}
			note={
				<>
					<TyreWearBar stint={stint} />
					{stops !== null && `${Math.max(0, stops)} stop${stops === 1 ? "" : "s"}`}
					{degradation !== null && (
						<span className={TONE_TEXT[degradationTone(degradation)]}>
							{`${stops !== null ? " · " : ""}deg ${formatSigned(degradation, 2)}`}
						</span>
					)}
				</>
			}
		>
			<span className="flex items-center gap-1.5">
				<Image src={tireIcon(stint?.Compound)} alt={stint?.Compound ?? "unknown tire"} width={20} height={20} />
				{stint?.New?.toLowerCase() === "true" ? "N" : "U"}
				{stint?.TotalLaps ?? 0}
			</span>
		</Tile>
	);
}

/**
 * the last laps as chips, coloured by how they compare with the typical lap on the set
 */
function LapStrip({ car }: { car: CarView }) {
	const laps = car.log.slice(-LAP_STRIP);
	if (laps.length === 0) return <p className="text-xs text-zinc-600">Laps show up here as they are recorded.</p>;

	return (
		<div className="flex flex-wrap gap-1 text-xs">
			{laps.map((lap) => (
				<span
					key={`lap.${lap.lap}`}
					className={clsx(
						"rounded border-l-2 px-1 py-0.5 tabular-nums",
						lap.reason !== null ? TONE_CHIP.excluded : lap.personalBest ? TONE_CHIP.gain : heatChip(lap.delta),
						lap.reason !== null ? TONE_BORDER.excluded : "border-l-transparent",
					)}
					title={`Lap ${lap.lap}${lap.reason ? `, ${lap.reason}` : lap.delta !== null ? `, ${formatSigned(lap.delta, 2)} vs the set` : ""}`}
				>
					{lap.lapTime !== null ? formatLapTime(lap.lapTime) : "-"}
				</span>
			))}
			<Chip tone="neutral" className="text-zinc-500">
				L{laps[laps.length - 1].lap}
			</Chip>
		</div>
	);
}
