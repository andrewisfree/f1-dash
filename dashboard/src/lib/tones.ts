import type { Sector, Stint } from "@/types/state.type";

import type { Trend } from "@/lib/race";

/**
 * one meaning per colour on every page:
 * purple the best of all, green better or gaining, amber a bit worse, red worse or losing,
 * grey left out, like pit, safety car or cool down laps
 */
export type Tone = "best" | "gain" | "warn" | "loss" | "neutral" | "excluded";

// full class names, tailwind only keeps the classes it finds written out
export const TONE_TEXT: Record<Tone, string> = {
	best: "text-violet-400",
	gain: "text-emerald-400",
	warn: "text-amber-400",
	loss: "text-red-400",
	neutral: "text-zinc-200",
	excluded: "text-zinc-600",
};

export const TONE_BORDER: Record<Tone, string> = {
	best: "border-l-violet-500",
	gain: "border-l-emerald-500",
	warn: "border-l-amber-500",
	loss: "border-l-red-500",
	neutral: "border-l-zinc-700",
	excluded: "border-l-zinc-800",
};

export const TONE_FILL: Record<Tone, string> = {
	best: "bg-violet-500",
	gain: "bg-emerald-500",
	warn: "bg-amber-500",
	loss: "bg-red-500",
	neutral: "bg-zinc-500",
	excluded: "bg-zinc-700",
};

export const TONE_CHIP: Record<Tone, string> = {
	best: "bg-violet-500/25 text-violet-200",
	gain: "bg-emerald-500/20 text-emerald-200",
	warn: "bg-amber-500/20 text-amber-200",
	loss: "bg-red-500/25 text-red-200",
	neutral: "bg-zinc-800 text-zinc-200",
	excluded: "bg-zinc-900 text-zinc-600",
};

// lap time against the reference pace, from much faster to much slower
const HEAT = [
	{ upTo: -0.3, chip: "bg-emerald-500/40 text-emerald-100" },
	{ upTo: -0.1, chip: "bg-emerald-500/20 text-emerald-200" },
	{ upTo: 0.1, chip: "bg-zinc-800 text-zinc-200" },
	{ upTo: 0.3, chip: "bg-amber-500/20 text-amber-200" },
	{ upTo: 0.7, chip: "bg-orange-500/25 text-orange-200" },
	{ upTo: Infinity, chip: "bg-red-500/30 text-red-200" },
];

export function heatChip(delta: number | null): string {
	if (delta === null) return TONE_CHIP.excluded;
	return HEAT.find((step) => delta <= step.upTo)!.chip;
}

// a negative delta means faster or ahead
export function deltaTone(delta: number | null, threshold = 0.05): Tone {
	if (delta === null || Math.abs(delta) < threshold) return "neutral";
	return delta < 0 ? "gain" : "loss";
}

/**
 * the trend of the gap seen from our car: a car ahead coming closer is good, a car behind coming closer is not
 */
export function rivalTone(trend: Trend | null, role: "ahead" | "behind"): Tone {
	if (!trend || trend.tone === "stable") return "neutral";

	const closing = trend.tone === "closing";
	return closing === (role === "ahead") ? "gain" : "loss";
}

export function sectorTone(sector?: Sector): Tone {
	if (!sector?.Value) return "excluded";
	if (sector.OverallFastest) return "best";
	if (sector.PersonalFastest) return "gain";
	return "warn";
}

export function lapTone(lap?: { OverallFastest?: boolean; PersonalFastest?: boolean; Value?: string }): Tone {
	if (!lap?.Value) return "excluded";
	if (lap.OverallFastest) return "best";
	if (lap.PersonalFastest) return "gain";
	return "warn";
}

// a tenth per lap of tyre loss is a lot, half of it is already worth a look
export function degradationTone(degradation: number | null): Tone {
	if (degradation === null) return "neutral";
	if (degradation >= 0.1) return "loss";
	if (degradation >= 0.05) return "warn";
	return "gain";
}

// rough laps a set lasts in a race, only to tell fresh from worn tyres
const TYRE_LIFE: Record<NonNullable<Stint["Compound"]>, number> = {
	SOFT: 18,
	MEDIUM: 28,
	HARD: 38,
	INTERMEDIATE: 30,
	WET: 30,
};

export function tyreWear(stint?: Stint): { share: number; tone: Tone } | null {
	if (!stint?.Compound || !(stint.Compound in TYRE_LIFE) || stint.TotalLaps === undefined) return null;

	const share = Math.min(1, stint.TotalLaps / TYRE_LIFE[stint.Compound]);
	return { share, tone: share < 0.5 ? "gain" : share < 0.85 ? "warn" : "loss" };
}

export const COMPOUND_CHIP: Record<string, string> = {
	SOFT: "bg-red-500/30 text-red-100",
	MEDIUM: "bg-yellow-400/30 text-yellow-100",
	HARD: "bg-zinc-200/20 text-zinc-100",
	INTERMEDIATE: "bg-green-500/30 text-green-100",
	WET: "bg-sky-500/30 text-sky-100",
};

// colours of the mini sectors as the feed sends them, blue for the pit lane
export function segmentFill(status: number): string {
	if (status === 2051) return TONE_FILL.best;
	if (status === 2049) return TONE_FILL.gain;
	if (status === 2048 || status === 2052) return "bg-yellow-400";
	if (status === 2064) return "bg-sky-500";
	return "bg-zinc-800";
}
