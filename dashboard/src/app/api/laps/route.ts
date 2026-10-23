import { getRecordedLaps } from "@/server/lapRecorder";

export const dynamic = "force-dynamic";

/**
 * the laps recorded by the server for the current session
 */
export function GET() {
	const recorded = getRecordedLaps();
	if (!recorded) return Response.json({ error: "lap recorder not running" }, { status: 503 });

	return Response.json(recorded, { headers: { "Cache-Control": "no-store" } });
}
