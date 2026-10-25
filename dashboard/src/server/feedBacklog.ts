import { merge } from "@/lib/merge";

// the longest delay a page can start with at once, longer ones fill up while the page is open
const WINDOW_MS = 5 * 60 * 1000;

type Entry = { t: number; raw: string };

const withoutCarData = (raw: string): Record<string, unknown> => {
	// car data and positions only make sense as frames in time, the merged state has no use for them
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const { CarDataZ, PositionZ, ...message } = JSON.parse(raw);
	return message;
};

/**
 * the last minutes of the feed, so a page opened with a delay has the past it needs at once
 * instead of waiting for it to arrive
 */
class FeedBacklog {
	// the state when the oldest kept update arrived, the updates before it are merged in
	private base: Record<string, unknown> | null = null;
	private baseAt = 0;
	private entries: Entry[] = [];

	add(event: string, raw: string) {
		const now = Date.now();

		// a new connection starts from a full state, also when the session changed
		if (event === "initial") {
			this.base = withoutCarData(raw);
			this.baseAt = now;
			this.entries = [];
			return;
		}

		if (!this.base) return;
		this.entries.push({ t: now, raw });

		let drop = 0;
		while (drop < this.entries.length && this.entries[drop].t < now - WINDOW_MS) {
			this.base = merge(this.base, withoutCarData(this.entries[drop].raw)) as Record<string, unknown>;
			this.baseAt = this.entries[drop].t;
			drop++;
		}
		if (drop > 0) this.entries = this.entries.slice(drop);
	}

	/**
	 * the state some seconds ago and the updates since, as JSON written by hand to keep the updates as they came
	 */
	since(seconds: number): string | null {
		if (!this.base) return null;

		const now = Date.now();
		const from = Math.max(now - seconds * 1000, this.baseAt);

		let state = this.base;
		let index = 0;
		while (index < this.entries.length && this.entries[index].t <= from) {
			state = merge(state, withoutCarData(this.entries[index].raw)) as Record<string, unknown>;
			index++;
		}

		const events = this.entries.slice(index).map((entry) => `{"t":${entry.t},"data":${entry.raw}}`);
		return `{"now":${now},"initialAt":${from},"initial":${JSON.stringify(state)},"events":[${events.join(",")}]}`;
	}
}

// the dev server reloads modules, a single backlog is kept for the process
const global = globalThis as unknown as { feedBacklog?: FeedBacklog };

export function getFeedBacklog(): FeedBacklog {
	global.feedBacklog ??= new FeedBacklog();
	return global.feedBacklog;
}

export type Backlog = {
	// server time when the backlog was written, to match its clock with the page's
	now: number;
	initialAt: number;
	initial: Record<string, unknown>;
	events: { t: number; data: Record<string, unknown> }[];
};
