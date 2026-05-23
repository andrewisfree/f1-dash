import type { TimingDataDriver } from "@/types/state.type";

export type GapScaleMode = "battle" | "spread" | "fixed";

export type GapScale = {
	mode: GapScaleMode;
	battleSeconds: number;
	fixedSeconds: number;
	spreadSeconds: number;
};

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

export function mapGapToUnit(gap: number, scale: GapScale): number {
	if (!Number.isFinite(gap) || gap <= 0) return 0;

	if (scale.mode === "battle") {
		const closeRange = Math.max(1, scale.battleSeconds);
		const maxRange = Math.max(closeRange + 1, scale.spreadSeconds || closeRange * 4);

		if (gap <= closeRange) return (gap / closeRange) * 0.38;
		return Math.min(1, 0.38 + ((gap - closeRange) / (maxRange - closeRange)) * 0.62);
	}

	const base = scale.mode === "fixed" ? Math.max(1, scale.fixedSeconds) : Math.max(1, scale.spreadSeconds);
	return Math.min(1, gap / base);
}
