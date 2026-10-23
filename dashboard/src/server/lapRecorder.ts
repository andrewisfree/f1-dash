import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { State } from "@/types/state.type";

import { computeGapsSeconds, getOrderedTimingDrivers, parseLapSeconds, parseLapsDown } from "@/lib/gaps";
import { merge } from "@/lib/merge";

import type { LapSample } from "@/stores/useLapHistoryStore";

// gaps arrive slightly after the lap count, so wait before reading them
const SETTLE_MS = 1500;
const TICK_MS = 1000;
const RETRY_MS = 5000;
// writes to disk are grouped, a lap ends every few seconds during a session
const SAVE_MS = 10_000;

export type RecordedLaps = {
	sessionKey: number | null;
	laps: Record<string, LapSample[]>;
};

type Tracker = {
	lastLap: number;
	pending: { lap: number; at: number; clean: boolean } | null;
	disturbed: boolean;
};

// safety car, red flag and virtual safety car
const isNeutralized = (status?: string) => ["4", "5", "6", "7"].includes(status ?? "");

/**
 * records one sample per driver per completed lap like the lap history of the page,
 * but on the server for the whole session, whether a page is open or not
 */
class LapRecorder {
	private state: State | null = null;
	private trackers = new Map<string, Tracker>();
	private data: RecordedLaps = { sessionKey: null, laps: {} };
	private dirty = false;
	private url: string;
	private file: string;

	constructor(url: string, file: string) {
		this.url = url;
		this.file = file;
	}

	get laps(): RecordedLaps {
		return this.data;
	}

	async start() {
		await this.load();

		setInterval(() => this.record(), TICK_MS);
		setInterval(() => this.save(), SAVE_MS);

		void this.connect();
	}

	private async connect() {
		for (;;) {
			try {
				await this.listen();
			} catch (error) {
				console.warn(`lap recorder: feed lost, retrying (${(error as Error).message})`);
			}

			// laps running while the feed was down were not seen from start to end
			this.trackers.forEach((tracker) => (tracker.disturbed = true));
			await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
		}
	}

	private async listen() {
		const response = await fetch(`${this.url}/api/realtime`, { headers: { Accept: "text/event-stream" } });
		if (!response.ok || !response.body) throw new Error(`status ${response.status}`);

		const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
		let buffer = "";

		for (;;) {
			const { done, value } = await reader.read();
			if (done) throw new Error("stream closed");

			buffer += value.replace(/\r\n/g, "\n");

			let end = buffer.indexOf("\n\n");
			while (end >= 0) {
				this.handle(buffer.slice(0, end));
				buffer = buffer.slice(end + 2);
				end = buffer.indexOf("\n\n");
			}
		}
	}

	private handle(block: string) {
		let event = "message";
		const data: string[] = [];

		for (const line of block.split("\n")) {
			if (line.startsWith("event:")) event = line.slice(6).trim();
			else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
		}

		if (data.length === 0 || (event !== "initial" && event !== "update")) return;

		// car data and positions are large and not needed for the laps
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { CarDataZ, PositionZ, ...message } = JSON.parse(data.join("\n"));
		this.state = (event === "initial" ? message : merge(this.state ?? {}, message)) as State;

		this.record();
	}

	private record() {
		const state = this.state;
		const lines = state?.TimingData?.Lines;
		// without the session the laps can not be matched
		if (!lines || !state.SessionInfo) return;

		const sessionKey = state.SessionInfo.Key ?? null;
		if (this.data.sessionKey !== sessionKey) {
			this.trackers.clear();
			this.data = { sessionKey, laps: {} };
			this.dirty = true;
		}

		const now = Date.now();
		const isRace = state.SessionInfo.Type === "Race";
		const neutralized = isNeutralized(state.TrackStatus?.Status);
		const ordered = getOrderedTimingDrivers(lines);
		const gaps = isRace ? computeGapsSeconds(ordered, state.TimingData?.SessionPart) : null;

		for (const driver of ordered) {
			const nr = driver.RacingNumber;
			const lap = driver.NumberOfLaps;
			if (typeof lap !== "number") continue;

			const tracker = this.trackers.get(nr);
			if (!tracker) {
				// the lap in progress was not seen from its start
				this.trackers.set(nr, { lastLap: lap, pending: null, disturbed: true });
				continue;
			}

			if (lap > tracker.lastLap) {
				// a larger jump means laps were missed
				const seen = lap - tracker.lastLap === 1;

				tracker.pending = seen ? { lap, at: now, clean: !tracker.disturbed } : null;
				tracker.disturbed = !seen;
				tracker.lastLap = lap;
			} else if (lap < tracker.lastLap) {
				tracker.lastLap = lap;
				tracker.pending = null;
				tracker.disturbed = true;
			}

			if (neutralized || driver.InPit || driver.PitOut) tracker.disturbed = true;

			if (tracker.pending && now - tracker.pending.at >= SETTLE_MS) {
				const lapped = parseLapsDown(driver.GapToLeader) > 0;
				const sample: LapSample = {
					lap: tracker.pending.lap,
					position: parseInt(driver.Position),
					gap: lapped ? null : (gaps?.get(nr) ?? null),
					lapTime: parseLapSeconds(driver.LastLapTime?.Value),
					personalBest: !!(driver.LastLapTime?.PersonalFastest || driver.LastLapTime?.OverallFastest),
					stint: state.TimingAppData?.Lines?.[nr]?.Stints?.length ?? 0,
					clean: tracker.pending.clean,
				};

				this.data.laps[nr] = [...(this.data.laps[nr] ?? []).filter((other) => other.lap < sample.lap), sample];
				tracker.pending = null;
				this.dirty = true;
			}
		}
	}

	private async load() {
		try {
			this.data = JSON.parse(await readFile(this.file, "utf8")) as RecordedLaps;
		} catch {
			// nothing recorded yet
		}
	}

	private async save() {
		if (!this.dirty) return;
		this.dirty = false;

		try {
			await mkdir(dirname(this.file), { recursive: true });
			await writeFile(this.file, JSON.stringify(this.data));
		} catch (error) {
			console.warn(`lap recorder: could not save ${this.file} (${(error as Error).message})`);
		}
	}
}

// the dev server reloads modules, a single recorder is kept for the process
const global = globalThis as unknown as { lapRecorder?: LapRecorder };

export function startLapRecorder(url: string, file: string) {
	if (global.lapRecorder) return;

	global.lapRecorder = new LapRecorder(url, file);
	void global.lapRecorder.start();
	console.log(`lap recorder: recording ${url}/api/realtime into ${file}`);
}

export function getRecordedLaps(): RecordedLaps | null {
	return global.lapRecorder?.laps ?? null;
}
