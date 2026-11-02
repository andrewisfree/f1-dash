// builds a replay: the state at an offset into the recording plus the events that follow
const fs = require("fs");
const [file, out, fromSec, lengthSec] = [process.argv[2], process.argv[3], Number(process.argv[4]), Number(process.argv[5])];
const isObject = (o) => o !== null && typeof o === "object" && !Array.isArray(o);
const merge = (base, update) => {
	if (isObject(base) && isObject(update)) { const r = { ...base }; for (const [k, v] of Object.entries(update)) r[k] = merge(base[k] ?? null, v); return r; }
	if (Array.isArray(base) && isObject(update)) { const r = [...base]; for (const [k, v] of Object.entries(update)) r.splice(parseInt(k), 1, merge(r[parseInt(k)], v)); return r; }
	return update;
};
let state = {}; let t0 = 0; let start = 0; const events = []; let lastT = 0;
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
	if (!line) continue;
	const tab = line.indexOf("\t"); const meta = JSON.parse(line.slice(0, tab)); const data = JSON.parse(line.slice(tab + 1));
	delete data.CarDataZ; delete data.PositionZ;
	if (!t0) t0 = meta.t; lastT = meta.t;
	const offset = (meta.t - t0) / 1000;
	const from = fromSec < 0 ? Infinity : fromSec;
	if (offset <= from || !start) { state = meta.event === "initial" ? data : merge(state, data); if (offset <= from) { start = meta.t; continue; } }
	if (offset > from + lengthSec) break;
	if (Object.keys(data).length) events.push({ dt: meta.t - start, data });
}
if (fromSec < 0) start = lastT;
fs.writeFileSync(out, JSON.stringify({ t: start, initial: state, events }));
console.log("replay from +" + ((start - t0) / 1000).toFixed(0) + "s, events:", events.length, "part", state.TimingData?.SessionPart, "status", state.SessionStatus?.Status, "size", fs.statSync(out).size, "recorded up to +" + ((lastT - t0) / 1000).toFixed(0) + "s");
