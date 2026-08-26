import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const backendUrl = process.env.BACKEND_API_URL?.replace(/\/$/, "");
  if (!backendUrl) {
    return NextResponse.json(
      { status: "not_ready", dependencies: { backend: "not_configured" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const response = await fetch(`${backendUrl}/health/ready`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`Backend readiness returned ${response.status}`);
    return NextResponse.json(
      { status: "ready", dependencies: { backend: "ready" } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "not_ready", dependencies: { backend: "unavailable" } },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
