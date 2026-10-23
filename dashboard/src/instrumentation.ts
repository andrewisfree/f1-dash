export async function register() {
	// the lap recorder needs node, the edge runtime only serves requests
	if (process.env.NEXT_RUNTIME !== "nodejs") return;

	const url = process.env.REALTIME_URL ?? process.env.NEXT_PUBLIC_LIVE_URL;
	if (!url || process.env.LAP_RECORDER === "off") return;

	const { startLapRecorder } = await import("@/server/lapRecorder");
	startLapRecorder(url, process.env.LAP_RECORDER_FILE ?? ".next/lap-recorder.json");
}
