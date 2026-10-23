import type { Message, Stint, TimingAppDataDriver, TimingDataDriver, TimingStatsDriver } from "@/types/state.type";

import { parseLapSeconds } from "@/lib/gaps";

import type { LapSample } from "@/stores/useLapHistoryStore";

// slower than this share of the best lap of the driver is a cool down lap
const COOL_DOWN_RATIO = 1.07;
// the fewest laps in a row that make a long run
export const LONG_RUN_LAPS = 5;
// laps of a run slower than its median by more than this share are traffic or mistakes
const OUTLIER_RATIO = 1.012;
// burning fuel makes the car faster by about this much per lap, the tyre loss is hidden by it
export const FUEL_EFFECT = 0.06;

export type LapKind = "pit" | "cool" | "push" | "long";

export type PracticeLap = LapSample & {
	kind: LapKind;
	// laps on the set when the lap ended, null if the start of the stint was not seen
	tyreAge: number | null;
	// left out of the run average, a traffic or mistake lap
	outlier: boolean;
};

export type LongRun = {
	nr: string;
	stint: number;
	compound: Stint["Compound"];
	isNew: boolean;
	laps: PracticeLap[];
	// laps used for the average, without the outliers
	used: number;
	average: number;
	best: number;
	// lap time change per lap of the tyre, positive when getting slower, null with too few laps
	slope: number | null;
	// the same with the fuel effect removed, what the tyre loses
	degradation: number | null;
};

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

function linearSlope(points: { x: number; y: number }[]): number | null {
	if (points.length < 3) return null;

	const meanX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
	const meanY = points.reduce((sum, point) => sum + point.y, 0) / points.length;
	const covariance = points.reduce((sum, point) => sum + (point.x - meanX) * (point.y - meanY), 0);
	const variance = points.reduce((sum, point) => sum + (point.x - meanX) ** 2, 0);

	return variance > 0 ? covariance / variance : null;
}

export const isNewTyre = (stint?: Stint) => stint?.New?.toLowerCase() === "true";

/**
 * laps on the set at the end of each lap, counted back from what the feed says about the stint
 */
function getTyreAges(samples: LapSample[], stints: Stint[], currentLap: number | undefined): Map<number, number> {
	const ages = new Map<number, number>();

	samples.forEach((sample, index) => {
		const stint = stints[sample.stint - 1];
		if (!stint?.TotalLaps) return;

		// the stint ends before the first lap of the next one, the last stint at the current lap
		const next = samples.slice(index + 1).find((later) => later.stint > sample.stint);
		const end = next ? next.lap - 1 : sample.stint === stints.length ? currentLap : null;
		if (typeof end !== "number") return;

		const age = stint.TotalLaps - (end - sample.lap);
		if (age > 0) ages.set(sample.lap, age);
	});

	return ages;
}

/**
 * sorts the laps of a driver into pit, cool down, push and long run laps
 */
export function classifyLaps(
	samples: LapSample[] | undefined,
	appData: TimingAppDataDriver | undefined,
	currentLap: number | undefined,
): PracticeLap[] {
	if (!samples?.length) return [];

	const ages = getTyreAges(samples, appData?.Stints ?? [], currentLap);
	const times = samples.filter((sample) => sample.clean && sample.lapTime !== null).map((sample) => sample.lapTime!);
	const best = times.length > 0 ? Math.min(...times) : null;

	const laps: PracticeLap[] = samples.map((sample) => ({
		...sample,
		kind:
			!sample.clean || sample.lapTime === null
				? "pit"
				: best && sample.lapTime > best * COOL_DOWN_RATIO
					? "cool"
					: "push",
		tyreAge: ages.get(sample.lap) ?? null,
		outlier: false,
	}));

	// a run is a row of timed laps on the same set, a cool down or a stop ends it
	let start = 0;
	for (let index = 0; index <= laps.length; index++) {
		const lap = laps[index];
		const previous = laps[index - 1];
		const continues =
			lap &&
			previous &&
			lap.kind === "push" &&
			previous.kind === "push" &&
			lap.stint === previous.stint &&
			lap.lap === previous.lap + 1;
		if (continues) continue;

		const run = laps.slice(start, index).filter((entry) => entry.kind === "push");
		if (run.length >= LONG_RUN_LAPS) {
			const middle = median(run.map((entry) => entry.lapTime!));
			for (const entry of run) {
				entry.kind = "long";
				entry.outlier = entry.lapTime! > middle * OUTLIER_RATIO;
			}
		}

		start = index;
	}

	return laps;
}

export function getLongRuns(nr: string, laps: PracticeLap[], appData: TimingAppDataDriver | undefined): LongRun[] {
	const runs: LongRun[] = [];

	for (const lap of laps) {
		if (lap.kind !== "long") continue;

		const last = runs[runs.length - 1];
		const previous = last?.laps[last.laps.length - 1];
		if (last && previous && previous.lap === lap.lap - 1 && previous.stint === lap.stint) {
			last.laps.push(lap);
		} else {
			const stint = appData?.Stints?.[lap.stint - 1];
			runs.push({
				nr,
				stint: lap.stint,
				compound: stint?.Compound,
				isNew: isNewTyre(stint),
				laps: [lap],
				used: 0,
				average: 0,
				best: 0,
				slope: null,
				degradation: null,
			});
		}
	}

	for (const run of runs) {
		const used = run.laps.filter((lap) => !lap.outlier);
		const times = used.map((lap) => lap.lapTime!);

		run.used = used.length;
		run.average = times.reduce((sum, time) => sum + time, 0) / times.length;
		run.best = Math.min(...times);
		// without the tyre age the order of the laps still gives the trend
		run.slope = linearSlope(used.map((lap, index) => ({ x: lap.tyreAge ?? index, y: lap.lapTime! })));
		run.degradation = run.slope !== null ? run.slope + FUEL_EFFECT : null;
	}

	return runs;
}

export type BestLapRow = {
	driver: TimingDataDriver;
	best: number | null;
	gap: number | null;
	// the lap of the best time, when it was seen on the page
	lap: PracticeLap | null;
	// the set the best time was done on
	stint: Stint | undefined;
	sectors: { time: number | null; fastest: boolean }[];
	ideal: number | null;
	speed: { value: number | null; fastest: boolean };
};

const sameTime = (a: number, b: number) => Math.abs(a - b) < 0.0005;

/**
 * lap times taken away by race control for every car, they still count as the best lap of a stint
 */
export function getDeletedTimes(messages: Message[] | undefined): Map<string, number[]> {
	const deleted = new Map<string, number[]>();

	for (const msg of messages ?? []) {
		const match = msg.Message.match(/^CAR (\d+) .*TIME (\d+:\d{2}\.\d{3}) DELETED/);
		const time = parseLapSeconds(match?.[2]);
		if (match && time !== null) deleted.set(match[1], [...(deleted.get(match[1]) ?? []), time]);
	}

	return deleted;
}

/**
 * best lap of every driver, over the whole session or on one compound
 */
export function getBestLaps(
	lines: Record<string, TimingDataDriver>,
	stats: Record<string, TimingStatsDriver> | undefined,
	practiceLaps: Record<string, PracticeLap[]>,
	appData: Record<string, TimingAppDataDriver> | undefined,
	compound: Stint["Compound"] | null,
	deleted: Map<string, number[]>,
): BestLapRow[] {
	const rows = Object.values(lines).map((driver): BestLapRow => {
		const nr = driver.RacingNumber;
		const seen = practiceLaps[nr] ?? [];
		const isDeleted = (time: number) => (deleted.get(nr) ?? []).some((other) => sameTime(other, time));

		// every stint carries its best lap for the whole session, the laps seen on the page may miss it
		const all = (appData?.[nr]?.Stints ?? []).map((stint, index) => {
			const time = parseLapSeconds(stint.LapTime);
			if (time === null || !isDeleted(time)) return { stint, time, lapNumber: stint.LapNumber, deleted: false };

			// a deleted best is replaced by the best valid lap seen on the set
			const valid = seen
				.filter((lap) => lap.stint === index + 1 && lap.kind !== "pit" && !isDeleted(lap.lapTime!))
				.sort((a, b) => a.lapTime! - b.lapTime!)[0];
			return { stint, time: valid?.lapTime ?? null, lapNumber: valid?.lap, deleted: true };
		});

		const sessionBest = parseLapSeconds(driver.BestLapTime?.Value);
		// a session best matching no stint was set on a stint whose best was deleted, on the one nearest its lap
		if (sessionBest !== null && !all.some((entry) => entry.time !== null && sameTime(entry.time, sessionBest))) {
			// the feed counts this lap one lower than the lap count and the stints
			const bestLap = driver.BestLapTime?.Lap !== undefined ? driver.BestLapTime.Lap + 1 : undefined;
			const owner = all
				.filter((entry) => entry.deleted)
				.sort(
					(a, b) =>
						Math.abs((a.stint.LapNumber ?? 0) - (bestLap ?? 0)) - Math.abs((b.stint.LapNumber ?? 0) - (bestLap ?? 0)),
				)[0];
			if (owner) Object.assign(owner, { time: sessionBest, lapNumber: bestLap });
		}

		const stints = all.filter((entry) => entry.time !== null && (!compound || entry.stint.Compound === compound));
		const fastestStint = stints.reduce<(typeof stints)[number] | null>(
			(fastest, entry) => (!fastest || entry.time! < fastest.time! ? entry : fastest),
			null,
		);

		const best = compound ? (fastestStint?.time ?? null) : sessionBest;
		// the session best leaves out deleted laps, a stint best may not
		const stint = best !== null ? (stints.find((entry) => sameTime(entry.time!, best)) ?? null) : null;
		// the lap itself gives the tyre age, when it was seen
		const lap = seen.find((entry) => stint?.lapNumber !== undefined && entry.lap === stint.lapNumber) ?? null;

		const driverStats = stats?.[nr];
		const sectors = (driverStats?.BestSectors ?? []).slice(0, 3).map((sector) => ({
			time: parseLapSeconds(sector?.Value),
			fastest: sector?.Position === 1,
		}));
		const ideal =
			sectors.length === 3 && sectors.every((sector) => sector.time !== null)
				? sectors.reduce((sum, sector) => sum + sector.time!, 0)
				: null;

		return {
			driver,
			best,
			gap: null,
			lap,
			stint: stint?.stint,
			sectors,
			ideal,
			speed: {
				value: driverStats?.BestSpeeds?.ST?.Value ? parseFloat(driverStats.BestSpeeds.ST.Value) : null,
				fastest: driverStats?.BestSpeeds?.ST?.Position === 1,
			},
		};
	});

	rows.sort((a, b) => (a.best ?? Infinity) - (b.best ?? Infinity) || a.driver.Line - b.driver.Line);

	const fastest = rows[0]?.best ?? null;
	for (const row of rows) row.gap = row.best !== null && fastest !== null ? row.best - fastest : null;

	return rows;
}

export function formatLapTime(seconds: number | null) {
	if (seconds === null) return "-:--.---";

	const minutes = Math.floor(seconds / 60);
	const rest = (seconds - minutes * 60).toFixed(3).padStart(6, "0");
	return minutes > 0 ? `${minutes}:${rest}` : rest;
}
