// records the realtime feed as one line per event: {"t":ms,"event":name}<TAB>raw json
// node record.js <file.tsv> <minutes> [realtime url, default http://localhost:4000]
// the realtime service sends no new initial state to connected clients when a session starts, so a fresh
// connection is opened every 30 s to compare the session key and the recording reconnects when it changed
const fs = require("fs");
const out = fs.createWriteStream(process.argv[2], { flags: "a" });
const end = Date.now() + Number(process.argv[3]) * 60000;
const url = `${process.argv[4] || "http://localhost:4000"}/api/realtime`;
let events = 0;
let sessionKey;
let feed = null;

const parse = (block) => {
	const event = (block.match(/^event: ?(.*)$/m) || [])[1];
	const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
	return { event, data };
};

const keyOf = (data) => { try { return JSON.parse(data).SessionInfo?.Key; } catch { return undefined; } };

async function* blocks(signal) {
	const res = await fetch(url, { signal });
	const decoder = new TextDecoder();
	let buffer = "";
	for await (const chunk of res.body) {
		buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
		let index;
		while ((index = buffer.indexOf("\n\n")) >= 0) {
			yield buffer.slice(0, index);
			buffer = buffer.slice(index + 2);
		}
	}
}

async function record() {
	feed = new AbortController();
	for await (const block of blocks(feed.signal)) {
		const { event, data } = parse(block);
		if (!event || !data) continue;
		if (event === "initial") sessionKey = keyOf(data);
		out.write(JSON.stringify({ t: Date.now(), event }) + "\t" + data + "\n");
		events++;
		if (Date.now() > end) return;
	}
}

async function checkSession() {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 15000);
	try {
		for await (const block of blocks(controller.signal)) {
			const { event, data } = parse(block);
			const key = event === "initial" ? keyOf(data) : undefined;
			if (key !== undefined && sessionKey !== undefined && key !== sessionKey) {
				console.log(new Date().toISOString(), `session ${sessionKey} -> ${key}, reconnecting`);
				feed?.abort();
			}
			break;
		}
	} catch {
		// the next check tries again
	} finally {
		clearTimeout(timeout);
		controller.abort();
	}
}

(async () => {
	const checker = setInterval(checkSession, 30000);
	while (Date.now() < end) {
		try {
			await record();
		} catch (error) {
			if (error.name !== "AbortError") console.error(new Date().toISOString(), "feed lost:", error.message);
			await new Promise((resolve) => setTimeout(resolve, 2000));
		}
	}
	clearInterval(checker);
	out.end(() => { console.log("recorded events:", events); process.exit(0); });
})();
