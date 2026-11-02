import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { State } from "@/types/state.type";

import { computeGapsSeconds, getOrderedTimingDrivers, parseLapSeconds, parseLapsDown } from "@/lib/gaps";
import { merge } from "@/lib/merge";

import { getFeedBacklog } from "@/server/feedBacklog";

import type { LapSample } from "@/stores/useLapHistoryStore";

// gaps arrive slightly after the lap count, so wait before reading them
const SETTLE_MS = 1500;
const TICK_MS = 1000;
const RETRY_MS = 5000;
// a feed back within this has not missed a stop or a safety car worth losing the lap for
const SHORT_OUTAGE_MS = 30_000;
// writes to disk are grouped, a lap ends every few seconds during a session
const SAVE_MS = 10_000;
// the realtime service does not tell connected clients that a new session started, a fresh connection is
// opened this often to compare the session it starts with
const SESSION_CHECK_MS = 30_000;
// the laps of past sessions are kept next to the current file for a race weekend and a day more,
// the last race until the next one
const ARCHIVE_KEEP_MS = 4 * 24 * 3600 * 1000;

export type RecordedLaps = {
	sessionKey: number | null;
	// Race, Qualifying, Practice, missing in files written before it was kept
	type?: string;
	laps: Record<string, LapSample[]>;
};

type Tracker = {
	lastLap: number;
	pending: { lap: number; at: number; clean: boolean } | null;
	disturbed: boolean;
	// the set the lap started on, a stop changes it
	stint: number;
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
	private feed: AbortController | null = null;
	private lostAt: number | null = null;

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
		setInterval(() => void this.checkSession(), SESSION_CHECK_MS);

		void this.prune();
		void this.connect();
	}

	/**
	 * the laps of a past session, kept in its own file next to the current one
	 */
	async archived(sessionKey: number): Promise<RecordedLaps | null> {
		if (sessionKey === this.data.sessionKey) return this.data;

		try {
			return JSON.parse(await readFile(this.archiveFile(sessionKey), "utf8")) as RecordedLaps;
		} catch {
			return null;
		}
	}

	private archiveFile(sessionKey: number) {
		return join(dirname(this.file), `laps-${sessionKey}.json`);
	}

	private async connect() {
		for (;;) {
			try {
				await this.listen();
			} catch (error) {
				console.warn(`lap recorder: feed lost, retrying (${(error as Error).message})`);
			}

			this.lostAt ??= Date.now();
			await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
		}
	}

	/**
	 * reads the session a new connection starts with, the one kept open stays on the session it started with
	 */
	private async checkSession() {
		const current = this.state?.SessionInfo?.Key;
		if (!this.feed || current === undefined) return;

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), SESSION_CHECK_MS / 2);

		try {
			const response = await fetch(`${this.url}/api/realtime`, {
				headers: { Accept: "text/event-stream" },
				signal: controller.signal,
			});
			if (!response.ok || !response.body) return;

			const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
			let buffer = "";

			while (!buffer.includes("\n\n")) {
				const { done, value } = await reader.read();
				if (done) return;
				buffer += value.replace(/\r\n/g, "\n");
			}

			const block = buffer.slice(0, buffer.indexOf("\n\n")).split("\n");
			if (!block.some((line) => line.replace(/ /g, "") === "event:initial")) return;

			const data = block.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, ""));
			const key = (JSON.parse(data.join("\n")) as State).SessionInfo?.Key;

			if (key !== undefined && key !== current) {
				console.log(`lap recorder: session ${current} ended, ${key} started, reconnecting`);
				this.feed.abort();
			}
		} catch {
			// the next check tries again
		} finally {
			clearTimeout(timeout);
			controller.abort();
		}
	}

	private async listen() {
		const feed = new AbortController();
		this.feed = feed;

		const response = await fetch(`${this.url}/api/realtime`, {
			headers: { Accept: "text/event-stream" },
			signal: feed.signal,
		});
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

		// the backlog keeps the whole feed, car data included, for the pages that start with a delay
		getFeedBacklog().add(event, data.join("\n"));

		// car data and positions are large and not needed for the laps
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { CarDataZ, PositionZ, ...message } = JSON.parse(data.join("\n"));
		this.state = (event === "initial" ? message : merge(this.state ?? {}, message)) as State;

		// laps running during a long outage were not seen from start to end, a short one only lost a few updates
		if (event === "initial" && this.lostAt !== null) {
			if (Date.now() - this.lostAt > SHORT_OUTAGE_MS) this.trackers.forEach((tracker) => (tracker.disturbed = true));
			this.lostAt = null;
		}

		this.record();
	}

	private record() {
		const state = this.state;
		const lines = state?.TimingData?.Lines;
		// without the session the laps can not be matched
		if (!lines || !state.SessionInfo) return;

		const sessionKey = state.SessionInfo.Key ?? null;
		if (this.data.sessionKey !== sessionKey) {
			void this.archive(this.data);
			this.trackers.clear();
			this.data = { sessionKey, type: state.SessionInfo.Type, laps: {} };
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

			const stint = state.TimingAppData?.Lines?.[nr]?.Stints?.length ?? 0;
			const tracker = this.trackers.get(nr);
			if (!tracker) {
				// after a restart the lap in progress began right after the last one saved, if nothing changed since
				// it is as good as one seen from its start
				const saved = this.data.laps[nr]?.at(-1);
				const continues = saved?.lap === lap && saved.stint === stint;
				const quiet = !neutralized && !driver.InPit && !driver.PitOut;
				this.trackers.set(nr, { lastLap: lap, pending: null, disturbed: !(continues && quiet), stint });
				continue;
			}

			if (lap > tracker.lastLap) {
				// a larger jump means laps were missed
				const seen = lap - tracker.lastLap === 1;

				tracker.pending = seen ? { lap, at: now, clean: !tracker.disturbed && tracker.stint === stint } : null;
				tracker.disturbed = !seen;
				tracker.lastLap = lap;
				tracker.stint = stint;
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

	private async archive(data: RecordedLaps) {
		if (data.sessionKey === null || Object.keys(data.laps).length === 0) return;

		try {
			await mkdir(dirname(this.file), { recursive: true });
			await writeFile(this.archiveFile(data.sessionKey), JSON.stringify(data));
		} catch (error) {
			console.warn(`lap recorder: could not archive session ${data.sessionKey} (${(error as Error).message})`);
		}

		await this.prune();
	}

	private async prune() {
		const dir = dirname(this.file);

		try {
			const archives = await Promise.all(
				(await readdir(dir))
					.filter((name) => /^laps-\d+\.json$/.test(name))
					.map(async (name) => {
						const path = join(dir, name);
						const { type } = JSON.parse(await readFile(path, "utf8")) as RecordedLaps;
						return { path, key: parseInt(name.slice(5)), race: type === "Race", at: (await stat(path)).mtimeMs };
					}),
			);
			const lastRace = Math.max(...archives.filter((archive) => archive.race).map((archive) => archive.key));

			for (const archive of archives) {
				const expired = archive.race ? archive.key < lastRace : Date.now() - archive.at > ARCHIVE_KEEP_MS;
				if (expired) await unlink(archive.path);
			}
		} catch {
			// nothing archived yet
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

export async function getArchivedLaps(sessionKey: number): Promise<RecordedLaps | null> {
	return (await global.lapRecorder?.archived(sessionKey)) ?? null;
}
