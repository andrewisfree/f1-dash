import type { ReactNode } from "react";
import clsx from "clsx";

import type { Stint } from "@/types/state.type";

import { formatSigned } from "@/lib/race";
import {
	COMPOUND_CHIP,
	degradationTone,
	deltaTone,
	TONE_BORDER,
	TONE_CHIP,
	TONE_FILL,
	TONE_TEXT,
	tyreWear,
	type Tone,
} from "@/lib/tones";

type CardProps = {
	title: ReactNode;
	action?: ReactNode;
	className?: string;
	children: ReactNode;
};

export function Card({ title, action, className, children }: CardProps) {
	return (
		<div className={clsx("rounded-lg border border-zinc-800 p-3", className)}>
			<div className="mb-2 flex items-center justify-between gap-2">
				<p className="text-xs text-zinc-500">{title}</p>
				{action}
			</div>
			{children}
		</div>
	);
}

type TileProps = {
	label: string;
	note?: ReactNode;
	// colours the left edge and the value
	tone?: Tone;
	children: ReactNode;
};

export function Tile({ label, note, tone, children }: TileProps) {
	return (
		<div
			className={clsx(
				"rounded-r-md border-l-4 bg-zinc-900/60 px-2.5 py-2",
				tone ? TONE_BORDER[tone] : "border-l-transparent",
			)}
		>
			<p className="text-xs text-zinc-500">{label}</p>
			<div
				className={clsx(
					"text-lg leading-tight font-semibold tabular-nums",
					tone && tone !== "neutral" && TONE_TEXT[tone],
				)}
			>
				{children}
			</div>
			{note && <div className="text-xs text-zinc-500 tabular-nums">{note}</div>}
		</div>
	);
}

export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
	return (
		<div className="flex items-center justify-between gap-2">
			<span className="text-zinc-500">{label}</span>
			<span className="tabular-nums">{children}</span>
		</div>
	);
}

// negative means our car is faster
export function Delta({ value, digits = 3 }: { value: number | null; digits?: number }) {
	if (value === null) return <span className="text-zinc-600">-</span>;

	const tone = deltaTone(value, 0.0005);
	return <span className={tone === "neutral" ? "text-zinc-400" : TONE_TEXT[tone]}>{formatSigned(value, digits)}</span>;
}

export function Chip({ tone, className, children }: { tone: Tone; className?: string; children: ReactNode }) {
	return (
		<span className={clsx("inline-block rounded px-1.5 py-0.5 tabular-nums", TONE_CHIP[tone], className)}>
			{children}
		</span>
	);
}

// longer gaps fill the bar, a car within a second barely shows
const GAP_SCALE = 5;

/**
 * a bar as long as the gap to another car, coloured by whether it is coming closer
 */
export function GapBar({ gap, tone }: { gap: number | null; tone: Tone }) {
	const share = gap !== null ? Math.max(0.03, Math.min(1, gap / GAP_SCALE)) : 0;

	return (
		<div className="h-2 w-full rounded-full bg-zinc-800">
			<div className={clsx("h-2 rounded-full", TONE_FILL[tone])} style={{ width: `${share * 100}%` }} />
		</div>
	);
}

/**
 * how worn the set is against how long that compound usually lasts
 */
export function TyreWearBar({ stint }: { stint?: Stint }) {
	const wear = tyreWear(stint);
	if (!wear) return null;

	return (
		<div className="mt-1 h-1.5 w-full rounded-full bg-zinc-800" title="laps on the set against a typical stint">
			<div className={clsx("h-1.5 rounded-full", TONE_FILL[wear.tone])} style={{ width: `${wear.share * 100}%` }} />
		</div>
	);
}

type StintStripProps = {
	stints: Stint[];
	// tyre loss per lap of every stint, by its number from 1
	degradation: (stint: number) => number | null;
};

/**
 * one block per set, as long as the laps run on it, in the colour of the compound
 */
export function StintStrip({ stints, degradation }: StintStripProps) {
	if (stints.length === 0) return null;

	return (
		<div className="flex gap-1 text-xs">
			{stints.map((stint, index) => {
				const laps = Math.max(1, (stint.TotalLaps ?? 0) - (stint.StartLaps ?? 0));
				const deg = degradation(index + 1);
				const current = index === stints.length - 1;

				return (
					<div
						key={`stint.${index}`}
						className={clsx(
							"min-w-0 truncate rounded px-1.5 py-1 tabular-nums",
							COMPOUND_CHIP[stint.Compound ?? ""] ?? "bg-zinc-800 text-zinc-300",
							current && "ring-1 ring-zinc-300",
						)}
						style={{ flexGrow: laps, flexBasis: 0 }}
						title={`${stint.Compound ?? "Unknown"}, ${stint.New?.toLowerCase() === "true" ? "new" : "used"}, ${laps} laps`}
					>
						<span className="font-black">{stint.Compound?.[0] ?? "?"}</span> {laps}L
						{deg !== null && (
							<span className={clsx("ml-1 font-semibold", TONE_TEXT[degradationTone(deg)])}>
								{formatSigned(deg, 2)}
							</span>
						)}
					</div>
				);
			})}
		</div>
	);
}
