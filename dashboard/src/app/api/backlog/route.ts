import { getFeedBacklog } from "@/server/feedBacklog";

export const dynamic = "force-dynamic";

const MAX_SECONDS = 300;

/**
 * the state some seconds ago and the feed since, for a page that starts with a delay
 */
export function GET(request: Request) {
	const seconds = Math.min(MAX_SECONDS, Math.max(0, Number(new URL(request.url).searchParams.get("seconds")) || 0));
	const backlog = getFeedBacklog().since(seconds);
	if (!backlog) return Response.json({ error: "no feed yet" }, { status: 503 });

	return new Response(backlog, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
