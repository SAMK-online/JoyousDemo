import { NextResponse } from "next/server";
import { z } from "zod";

import { BackendApiError, sendPatientChat } from "@/lib/api/backendClient";
import { PATIENT_IDS } from "@/lib/domain/types";

export const runtime = "nodejs";

const requestSchema = z.object({
  patientId: z.enum(PATIENT_IDS),
  message: z.string().trim().min(1).max(1200),
  history: z
    .array(
      z.object({
        role: z.enum(["patient", "assistant"]),
        text: z.string().trim().min(1).max(2400),
      }),
    )
    .max(8)
    .default([]),
  sessionId: z.string().uuid().optional(),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    return NextResponse.json(await sendPatientChat(body));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Please choose a valid patient and enter a message." },
        { status: 400 },
      );
    }

    if (error instanceof BackendApiError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Patient assistant proxy request failed", error);
    return NextResponse.json(
      {
        error:
          "I couldn’t read the patient record just now. No action was taken. Please try again.",
      },
      { status: 500 },
    );
  }
}
