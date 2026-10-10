import type { ExtrapolatedClock, Message, TimingData, TimingDataDriver, TimingStats } from "@/types/state.type";

import { getOrderedTimingDrivers, parseLapSeconds } from "@/lib/gaps";
import { getCutoffPosition } from "@/lib/qualifying";

// mini sector of a lap through the pit lane
const SEGMENT_PIT = 2064;
const SEGMENT_PERSONAL_BEST = 2049;
const SEGMENT_OVERALL_BEST = 2051;

// a sector this much slower than the driver's best is not a push lap
const PUSH_SECTOR_RATIO = 1.05;
// a lap this close to the driver's best was a push lap
const PUSH_LAP_RATIO = 1.03;
// mini sectors needed before their colors say something about the lap
const MIN_SEGMENTS = 3;
// margins to the elimination line below this are on the bubble
export const BUBBLE_SECONDS = 0.15;
// an out lap takes about this much longer than the fastest lap, used until one is measured
const OUT_LAP_RATIO = 1.35;

export type LapPhase = "pit" | "out" | "push" | "slow" | "stopped";

/**
 * which sectors of the lap in progress are done, the mini sectors are cleared when a lap
 * starts so a full sector belongs to the current lap
 */
export function getCompletedSectors(driver: TimingDataDriver): boolean[] {
	const sectors = driver.Sectors ?? [];
	const complete = sectors.map((sector) => {
		const segments = sector.Segments ?? [];
		return segments.length > 0 && segments.every((segment) => segment.Status !== 0);
	});

	// a sector the car has not entered yet still shows the time of the lap before,
	// it is cleared a moment after the sector ahead of it ends
	const stale = sectors.map(
		(sector) => !!sector.Value && !(sector.Segments ?? []).some((segment) => segment.Status !== 0),
	);

	return complete.map((done, index) => done && !stale[index + 1]);
}

/**
 * what a driver is doing on the current lap, the feed does not say it so it is read from
 * the pit flags, the mini sectors and the sector times
 */
export function getLapPhase(driver: TimingDataDriver, bestSectors: (number | null)[] = []): LapPhase {
	if (driver.Stopped || driver.Retired) return "stopped";
	if (driver.InPit) return "pit";

	const sectors = driver.Sectors ?? [];
	const segments = sectors.map((sector) => (sector.Segments ?? []).map((segment) => segment.Status));
	if (driver.PitOut || segments[0]?.some((status) => status === SEGMENT_PIT)) return "out";

	const full = segments.map((sector) => sector.length > 0 && sector.every((status) => status !== 0));
	const finished = full.length > 0 && full.every(Boolean);

	if (!finished) {
		const completed = getCompletedSectors(driver);

		for (let i = sectors.length - 1; i >= 0; i--) {
			if (!completed[i]) continue;

			const time = parseLapSeconds(sectors[i].Value);
			const best = bestSectors[i];
			if (time === null || !best) break;

			return time <= best * PUSH_SECTOR_RATIO ? "push" : "slow";
		}

		const done = (segments[0] ?? []).filter((status) => status !== 0);
		if (done.length >= MIN_SEGMENTS) {
			const quick = done.filter((status) => status === SEGMENT_PERSONAL_BEST || status === SEGMENT_OVERALL_BEST);
			if (quick.length * 2 >= done.length) return "push";
		}
	}

	// nothing to read from this lap yet, a quick lap is followed by a slow one and the other way around
	const last = parseLapSeconds(driver.LastLapTime?.Value);
	const best = parseLapSeconds(driver.BestLapTime?.Value);
	return last !== null && best !== null && last <= best * PUSH_LAP_RATIO ? "slow" : "push";
}

export function getBestSectors(stats: TimingStats | undefined, nr: string): (number | null)[] {
	return (stats?.Lines?.[nr]?.BestSectors ?? []).map((sector) => parseLapSeconds(sector?.Value));
}

/**
 * time left in the session part, the feed only sends the clock when it changes
 */
export function getRemainingMs(clock: ExtrapolatedClock | undefined, now: number): number | null {
	const match = clock?.Remaining?.match(/^(\d+):(\d+):(\d+)$/);
	if (!clock || !match) return null;

	const remaining = (parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3])) * 1000;
	if (!clock.Extrapolating) return remaining;

	return Math.max(0, remaining - (now - new Date(clock.Utc).getTime()));
}

export type BoardState = "safe" | "bubble" | "out" | "eliminated" | "none";

export type BoardRow = {
	driver: TimingDataDriver;
	position: number;
	// best lap of the part shown, the last part driven for eliminated drivers
	time: string;
	seconds: number | null;
	gapToFastest: number | null;
	// seconds to the elimination line, positive for the cushion and negative for the time to find
	margin: number | null;
	state: BoardState;
};

export type Board = {
	part: number | undefined;
	// last position that advances, undefined in the final part
	cutoff: number | undefined;
	rows: BoardRow[];
	fastest: number | null;
};

type PartTime = { Value?: string };

function partTime(driver: TimingDataDriver, part: number | undefined): string {
	const times = (driver as TimingDataDriver & { BestLapTimes?: PartTime[] }).BestLapTimes;
	if (!times || !part) return driver.BestLapTime?.Value ?? "";

	if (!driver.KnockedOut) return times[part - 1]?.Value ?? "";

	// eliminated drivers keep the time of the part they went out in
	for (let i = Math.min(part, times.length) - 1; i >= 0; i--) {
		if (times[i]?.Value) return times[i].Value as string;
	}

	return "";
}

/**
 * laps taken away by race control, for track limits or yellow flags, optionally only those after a moment
 */
export function getDeletedLaps(messages: Message[] | undefined, since?: string): Map<string, number> {
	const deleted = new Map<string, number>();

	for (const msg of messages ?? []) {
		if (since && msg.Utc < since) continue;

		const car = msg.Message.match(/^CAR (\d+) .* DELETED/)?.[1];
		if (car) deleted.set(car, (deleted.get(car) ?? 0) + 1);
	}

	return deleted;
}

type PartStart = { Utc: string; QualifyingPart?: number };

/**
 * when the part being driven started, to tell its deleted laps from the earlier ones
 */
export function getPartStart(series: PartStart[] | undefined, part: number | undefined): string | undefined {
	return [...(series ?? [])].reverse().find((entry) => entry.QualifyingPart === part)?.Utc;
}

export function getPartTimes(driver: TimingDataDriver): string[] {
	const times = (driver as TimingDataDriver & { BestLapTimes?: PartTime[] }).BestLapTimes ?? [];
	return times.map((time) => time?.Value ?? "");
}

export function buildBoard(timingData: TimingData | undefined): Board {
	const part = timingData?.SessionPart;
	const cutoff = part ? getCutoffPosition(part, timingData?.NoEntries) : undefined;
	const ordered = getOrderedTimingDrivers(timingData?.Lines);

	const timed = ordered.map((driver) => {
		const time = partTime(driver, part);
		return { driver, position: parseInt(driver.Position), time, seconds: parseLapSeconds(time) };
	});

	const running = timed.filter((entry) => !entry.driver.KnockedOut && entry.seconds !== null);
	const fastest = running.length ? Math.min(...running.map((entry) => entry.seconds as number)) : null;
	const lastIn = cutoff ? timed.find((entry) => entry.position === cutoff)?.seconds : null;
	const firstOut = cutoff ? timed.find((entry) => entry.position === cutoff + 1)?.seconds : null;

	const rows = timed.map((entry): BoardRow => {
		const base = { ...entry, gapToFastest: null, margin: null };

		if (entry.driver.KnockedOut) return { ...base, state: "eliminated" };
		if (entry.seconds === null) return { ...base, state: cutoff && entry.position > cutoff ? "out" : "none" };

		const gapToFastest = fastest !== null ? entry.seconds - fastest : null;
		if (!cutoff) return { ...base, gapToFastest, state: "none" };

		const advancing = entry.position <= cutoff;
		const reference = advancing ? firstOut : lastIn;
		const margin = reference != null ? reference - entry.seconds : null;
		const close = margin !== null && Math.abs(margin) < BUBBLE_SECONDS;

		return { ...base, gapToFastest, margin, state: advancing ? (close ? "bubble" : "safe") : "out" };
	});

	return { part, cutoff, rows, fastest };
}

/**
 * time a car needs from the pit exit to the line, measured from the out laps seen so far
 */
export function getOutLapMs(measured: number[], fastest: number | null): number | null {
	if (measured.length > 0) {
		const sorted = [...measured].sort((a, b) => a - b);
		return sorted[Math.floor(sorted.length / 2)];
	}

	return fastest !== null ? fastest * OUT_LAP_RATIO * 1000 : null;
}

export type PushSector = {
	done: boolean;
	time: number | null;
	// purple for the best of the session, green for a personal best
	tone: "best" | "improved" | "slower" | null;
	// seconds lost to the driver's best sector, null when the sector is the best
	loss: number | null;
};

export type PushLap = {
	// the lap just ended, shown until the next one starts
	finished: boolean;
	sectors: PushSector[];
	// mini sectors done and to do, how far into the lap the car is
	progress: number;
	// lap time if the sectors still to do match the driver's best
	projected: number | null;
	// against the best lap of the part, negative when improving
	improvement: number | null;
	position: number | null;
};

/**
 * the lap a driver is pushing on, or just finished, null when the driver is not on one
 */
export function getPushLap(row: BoardRow, bestSectors: (number | null)[], rows: BoardRow[]): PushLap | null {
	const driver = row.driver;
	if (row.state === "eliminated" || driver.InPit || driver.Stopped || driver.Retired) return null;

	const segments = (driver.Sectors ?? []).flatMap((sector) => sector.Segments ?? []);
	const done = segments.filter((segment) => segment.Status !== 0).length;
	const finished = segments.length > 0 && done === segments.length;
	const phase = getLapPhase(driver, bestSectors);

	// once a lap is over the phase already talks about the next one, slow after a quick lap
	if (finished ? phase !== "slow" : phase !== "push") return null;
	if (segments.some((segment) => segment.Status === SEGMENT_PIT)) return null;

	const completed = getCompletedSectors(driver);
	const sectors = driver.Sectors.slice(0, 3).map((sector, index): PushSector => {
		const time = completed[index] ? parseLapSeconds(sector.Value) : null;
		if (time === null) return { done: false, time: null, tone: null, loss: null };

		const best = bestSectors[index];
		const quick = sector.OverallFastest || sector.PersonalFastest;

		return {
			done: true,
			time,
			tone: sector.OverallFastest ? "best" : sector.PersonalFastest ? "improved" : "slower",
			loss: !quick && best ? time - best : null,
		};
	});

	let projected: number | null = null;

	if (finished) {
		projected = parseLapSeconds(driver.LastLapTime?.Value);

		// the lap time arrives a moment after the last mini sector, until then there is nothing to show
		const total = sectors.reduce((sum, sector) => sum + (sector.time ?? NaN), 0);
		if (projected === null || !(Math.abs(total - projected) < 0.02)) return null;
	} else if (sectors.some((sector) => sector.done)) {
		const parts = sectors.map((sector, index) => sector.time ?? bestSectors[index] ?? null);
		projected = parts.every((part) => part !== null) ? parts.reduce((sum, part) => sum + part, 0) : null;
	}

	// a finished lap is already in the standings
	const others = rows.filter((other) => other !== row && other.state !== "eliminated" && other.seconds !== null);
	const position = finished
		? row.position
		: projected !== null
			? others.filter((other) => (other.seconds as number) < Math.min(projected, row.seconds ?? Infinity)).length + 1
			: null;

	return {
		finished,
		sectors,
		progress: segments.length ? done / segments.length : 0,
		projected,
		improvement: !finished && projected !== null && row.seconds !== null ? projected - row.seconds : null,
		position,
	};
}
