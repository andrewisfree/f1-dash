// serves a recording as the realtime service does, to run the dashboard on a past session
// node replay-server.js <file.tsv> [speed, default 1] [from seconds, default 0] [port, default 4100]
// every connection gets the state at the current point of the replay, then the events as they come;
// the replay runs on one clock for every client, from the moment the server starts
const fs = require("fs");
const http = require("http");

const [file, speed = 1, from = 0, port = 4100] = [process.argv[2], ...process.argv.slice(3).map(Number)];

const isObject = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const merge = (base, update) => {
	if (isObject(base) && isObject(update)) {
		const r = { ...base };
		for (const [k, v] of Object.entries(update)) r[k] = merge(base[k] ?? null, v);
		return r;
	}
	if (Array.isArray(base) && isObject(update)) {
		const r = [...base];
		for (const [k, v] of Object.entries(update)) r.splice(parseInt(k), 1, merge(r[parseInt(k)], v));
		return r;
	}
	return update;
};

const events = [];
let t0 = 0;
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
	if (!line) continue;
	const tab = line.indexOf("\t");
	const meta = JSON.parse(line.slice(0, tab));
	if (!t0) t0 = meta.t;
	events.push({ offset: (meta.t - t0) / 1000, event: meta.event, raw: line.slice(tab + 1) });
}
const length = events[events.length - 1].offset;

let state = {};
let next = 0;
const clients = new Set();
const started = Date.now();

const apply = (entry) => {
	const data = JSON.parse(entry.raw);
	state = entry.event === "initial" ? data : merge(state, data);
};

// the state at the starting point is built at once, without sending anything
while (next < events.length && events[next].offset <= from) apply(events[next++]);

const position = () => from + ((Date.now() - started) / 1000) * speed;

setInterval(() => {
	const now = position();
	while (next < events.length && events[next].offset <= now) {
		const entry = events[next++];
		apply(entry);
		// a new initial in the recording is a reconnect of the recorder, clients get it as an update
		const out = `event: ${entry.event === "initial" ? "update" : entry.event}\ndata: ${entry.raw}\n\n`;
		for (const res of clients) res.write(out);
	}
}, 50);

setInterval(() => {
	const lap = state.LapCount ? `lap ${state.LapCount.CurrentLap}/${state.LapCount.TotalLaps}` : "";
	console.log(`+${position().toFixed(0)}s of ${length.toFixed(0)}s ${lap} clients ${clients.size}`);
}, 30000);

http
	.createServer((req, res) => {
		res.setHeader("Access-Control-Allow-Origin", "*");
		if (!req.url.startsWith("/api/realtime")) {
			res.writeHead(404).end();
			return;
		}

		res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
		res.write(`event: initial\ndata: ${JSON.stringify(state)}\n\n`);
		clients.add(res);
		req.on("close", () => clients.delete(res));
	})
	.listen(port, () =>
		console.log(`replaying ${file} from +${from}s at ${speed}x on http://localhost:${port}/api/realtime`),
	);
