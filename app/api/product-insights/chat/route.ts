import { NextResponse } from "next/server";
import { z } from "zod";

import { BackendApiError, sendInsightsChat } from "@/lib/api/backendClient";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(1200),
  history: z.array(z.object({
    role: z.enum(["product", "assistant"]),
    text: z.string().trim().min(1).max(2400),
  })).max(8).default([]),
  sessionId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    return NextResponse.json(await sendInsightsChat(body));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Enter a product question using 1,200 characters or fewer." },
        { status: 400 },
      );
    }

    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Product insights proxy request failed", error);
    return NextResponse.json(
      { error: "The aggregate insights report could not be analyzed just now. Please try again." },
      { status: 500 },
    );
  }
}
