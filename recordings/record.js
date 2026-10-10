// records the realtime feed as one line per event: {"t":ms,"event":name}<TAB>raw json
const fs = require("fs");
const out = fs.createWriteStream(process.argv[2]);
const end = Date.now() + Number(process.argv[3]) * 60000;
(async () => {
	const res = await fetch("http://localhost:4000/api/realtime");
	const decoder = new TextDecoder();
	let buffer = "";
	let events = 0;
	for await (const chunk of res.body) {
		buffer += decoder.decode(chunk, { stream: true });
		let index;
		while ((index = buffer.indexOf("\n\n")) >= 0) {
			const block = buffer.slice(0, index);
			buffer = buffer.slice(index + 2);
			const event = (block.match(/^event: ?(.*)$/m) || [])[1];
			const data = block.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
			if (event && data) { out.write(JSON.stringify({ t: Date.now(), event }) + "\t" + data + "\n"); events++; }
		}
		if (Date.now() > end) break;
	}
	out.end(() => { console.log("recorded events:", events); process.exit(0); });
})().catch((error) => { console.error("recording failed:", error.message); out.end(() => process.exit(1)); });
