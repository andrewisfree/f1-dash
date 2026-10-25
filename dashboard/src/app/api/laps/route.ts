import { getArchivedLaps, getRecordedLaps } from "@/server/lapRecorder";

export const dynamic = "force-dynamic";

/**
 * the laps recorded by the server for the current session, or for a past one with ?session=<key>
 */
export async function GET(request: Request) {
	const recorded = getRecordedLaps();
	if (!recorded) return Response.json({ error: "lap recorder not running" }, { status: 503 });

	const session = new URL(request.url).searchParams.get("session");
	if (session === null) return Response.json(recorded, { headers: { "Cache-Control": "no-store" } });

	const archived = await getArchivedLaps(parseInt(session));
	if (!archived) return Response.json({ error: `no laps for session ${session}` }, { status: 404 });

	return Response.json(archived, { headers: { "Cache-Control": "no-store" } });
}
