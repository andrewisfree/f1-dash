import type { TimingDataDriver } from "@/types/state.type";

export type GapScaleMode = "battle" | "spread" | "fixed";

export type GapScale = {
	mode: GapScaleMode;
	battleSeconds: number;
	// range of gaps shown, relative to the reference driver (leader = 0)
	lo: number;
	hi: number;
};

// share of the track height given to the battle zone around the reference
const BATTLE_SHARE = 0.38;

export function parseGapSeconds(input?: string): number | null {
	if (!input) return null;

	const value = input.trim();
	if (!value || /[0-9]+L/i.test(value)) return null;
	if (!value.startsWith("+") && !value.startsWith("-")) return null;

	const sign = value.startsWith("-") ? -1 : 1;
	const raw = value.replace(/^[-+]/, "");
	const minutes = raw.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);

	if (minutes) {
		const mins = parseInt(minutes[1], 10);
		const secs = parseInt(minutes[2], 10);
		const millis = minutes[3] ? parseInt(minutes[3].padEnd(3, "0"), 10) : 0;
		return sign * (mins * 60 + secs + millis / 1000);
	}

	const seconds = raw.match(/^(\d+)(?:\.(\d{1,3}))?$/);
	if (seconds) {
		const secs = parseInt(seconds[1], 10);
		const millis = seconds[2] ? parseInt(seconds[2].padEnd(3, "0"), 10) : 0;
		return sign * (secs + millis / 1000);
	}

	return null;
}

export function parseLapsDown(input?: string): number {
	const match = input?.trim().match(/^\+?(\d+)\s*L(?:APS?)?$/i);
	return match ? parseInt(match[1], 10) : 0;
}

export function parseLapSeconds(input?: string): number | null {
	if (!input) return null;

	const value = input.trim();
	const minutes = value.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);

	if (minutes) {
		const mins = parseInt(minutes[1], 10);
		const secs = parseInt(minutes[2], 10);
		const millis = minutes[3] ? parseInt(minutes[3].padEnd(3, "0"), 10) : 0;
		return mins * 60 + secs + millis / 1000;
	}

	const seconds = value.match(/^(\d+)(?:\.(\d{1,3}))?$/);
	if (seconds) {
		const secs = parseInt(seconds[1], 10);
		const millis = seconds[2] ? parseInt(seconds[2].padEnd(3, "0"), 10) : 0;
		return secs + millis / 1000;
	}

	return null;
}

export function formatCompactLap(input?: string): string {
	const seconds = parseLapSeconds(input);
	if (seconds === null) return "--.-";

	const compact = Math.floor((seconds % 60) * 10) / 10;
	return compact.toFixed(1);
}

export function getOrderedTimingDrivers(lines: Record<string, TimingDataDriver> | undefined): TimingDataDriver[] {
	if (!lines) return [];

	return Object.values(lines)
		.filter((driver) => Number.isFinite(parseInt(driver.Position)))
		.sort((a, b) => parseInt(a.Position) - parseInt(b.Position));
}

function getGapToLeaderSeconds(driver: TimingDataDriver, sessionPart?: number): number | null {
	const statsIndex = sessionPart ? sessionPart - 1 : 0;

	return (
		parseGapSeconds(driver.GapToLeader) ??
		parseGapSeconds(driver.Stats?.[statsIndex]?.TimeDiffToFastest) ??
		parseGapSeconds(driver.TimeDiffToFastest)
	);
}

function getIntervalAheadSeconds(driver: TimingDataDriver, sessionPart?: number): number | null {
	const statsIndex = sessionPart ? sessionPart - 1 : 0;

	return (
		parseGapSeconds(driver.IntervalToPositionAhead?.Value) ??
		parseGapSeconds(driver.Stats?.[statsIndex]?.TimeDifftoPositionAhead) ??
		parseGapSeconds(driver.TimeDiffToPositionAhead)
	);
}

export function computeGapsSeconds(drivers: TimingDataDriver[], sessionPart?: number): Map<string, number> {
	const gaps = new Map<string, number>();
	if (drivers.length === 0) return gaps;

	gaps.set(drivers[0].RacingNumber, 0);

	for (let i = 1; i < drivers.length; i++) {
		const driver = drivers[i];
		const directGap = getGapToLeaderSeconds(driver, sessionPart);

		if (directGap !== null) {
			gaps.set(driver.RacingNumber, Math.max(0, directGap));
			continue;
		}

		const previous = drivers[i - 1];
		const previousGap = gaps.get(previous.RacingNumber) ?? 0;
		const interval = getIntervalAheadSeconds(driver, sessionPart);
		gaps.set(driver.RacingNumber, Math.max(0, previousGap + (interval ?? 0)));
	}

	return gaps;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// maps a gap relative to the reference driver to a 0..1 position on the track
export function createGapScale({ mode, battleSeconds, lo, hi }: GapScale): (rel: number) => number {
	const span = hi - lo;
	if (!Number.isFinite(span) || span <= 0) return () => 0;

	const linear = (rel: number) => (Number.isFinite(rel) ? clamp((rel - lo) / span, 0, 1) : 0);
	if (mode !== "battle") return linear;

	const close = Math.max(1, battleSeconds);
	const nearLo = Math.max(lo, -close);
	const nearHi = Math.min(hi, close);
	const near = nearHi - nearLo;
	const far = span - near;
	if (near <= 0 || far <= 0) return linear;

	return (rel: number) => {
		if (!Number.isFinite(rel)) return 0;

		const value = clamp(rel, lo, hi);
		const nearPart = clamp(value, nearLo, nearHi) - nearLo;
		const farPart = value - lo - nearPart;
		return (nearPart / near) * BATTLE_SHARE + (farPart / far) * (1 - BATTLE_SHARE);
	};
}
