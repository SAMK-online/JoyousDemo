import { NextResponse } from "next/server";
import { z } from "zod";

import { JsonPatientRepository } from "@/lib/data/jsonPatientRepository";
import { buildTier3ProductInsights } from "@/lib/insights/tier3ProductInsights";
import { generateProductInsightAnswer } from "@/lib/insights/productInsightsAssistant";

export const runtime = "nodejs";

const requestSchema = z.object({
  message: z.string().trim().min(1).max(1200),
  history: z.array(z.object({
    role: z.enum(["product", "assistant"]),
    text: z.string().trim().min(1).max(2400),
  })).max(8).default([]),
});

const repository = new JsonPatientRepository();

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const patientIds = await repository.listPatientIds();
    const clinicalFiles = await Promise.all(
      patientIds.map((uid) => repository.getPatientClinicalNotes(uid)),
    );
    const report = buildTier3ProductInsights(clinicalFiles);
    const result = await generateProductInsightAnswer(
      report,
      body.message,
      body.history,
    );

    return NextResponse.json({ ...result, reportAsOf: report.asOfDate });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Enter a product question using 1,200 characters or fewer." },
        { status: 400 },
      );
    }

    console.error("Product insights chat request failed", error);
    return NextResponse.json(
      { error: "The aggregate insights report could not be analyzed just now. Please try again." },
      { status: 500 },
    );
  }
}
