import { NextResponse } from "next/server";
import { z } from "zod";

import { answerPatientQuestion } from "@/lib/assistant/answerPatientQuestion";
import { generatePatientAnswer } from "@/lib/assistant/openaiResponseGenerator";
import { JsonPatientRepository } from "@/lib/data/jsonPatientRepository";
import { normalizePatientRecord } from "@/lib/domain/normalizePatient";
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
});

const repository = new JsonPatientRepository();

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const [raw, memory, clinical] = await Promise.all([
      repository.getPatientRecord(body.patientId),
      repository.getPatientMemory(body.patientId),
      repository.getPatientClinicalNotes(body.patientId),
    ]);
    const context = normalizePatientRecord(raw, memory, clinical);
    const baseline = answerPatientQuestion(context, body.message);
    const { result, generation } = await generatePatientAnswer(
      context,
      body.message,
      body.history,
      baseline,
    );

    if (result.review?.required) {
      console.info("Patient assistant safety review flag", {
        patientId: body.patientId,
        reason: result.review.reason,
        loggedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      ...result,
      generation,
      patientId: body.patientId,
      asOfDate: context.asOfDate,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Please choose a valid patient and enter a message." },
        { status: 400 },
      );
    }

    console.error("Patient assistant chat request failed", error);
    return NextResponse.json(
      {
        error:
          "I couldn’t read the patient record just now. No action was taken. Please try again.",
      },
      { status: 500 },
    );
  }
}
