import "server-only";

import type { GenerationMetadata } from "@/lib/assistant/openaiResponseGenerator";
import type { AssistantAnswer, PatientId, PatientListItem } from "@/lib/domain/types";
import type { ProductInsightAnswer } from "@/lib/insights/productInsightsAssistant";
import type { Tier3ProductInsightsReport } from "@/lib/insights/tier3ProductInsights";

type PatientHistory = Array<{ role: "patient" | "assistant"; text: string }>;
type InsightsHistory = Array<{ role: "product" | "assistant"; text: string }>;

export type PatientChatResponse = AssistantAnswer & {
  patientId: PatientId;
  asOfDate: string;
  generation: GenerationMetadata;
  sessionId: string;
};

export type InsightsChatResponse = ProductInsightAnswer & {
  reportAsOf: string;
  sessionId: string;
};

export class BackendApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code = "backend_error",
  ) {
    super(message);
    this.name = "BackendApiError";
  }
}

function backendConfig() {
  const baseUrl = process.env.BACKEND_API_URL;
  const token = process.env.BACKEND_SERVICE_TOKEN;
  if (!baseUrl || !token) {
    throw new Error("BACKEND_API_URL and BACKEND_SERVICE_TOKEN must be configured.");
  }
  return { baseUrl: baseUrl.replace(/\/$/, ""), token };
}

async function backendRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const { baseUrl, token } = backendConfig();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...init?.headers,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    throw new BackendApiError(
      error instanceof Error ? `Backend unavailable: ${error.message}` : "Backend unavailable.",
      503,
      "backend_unavailable",
    );
  }

  const payload = await response.json().catch(() => null) as
    | T
    | { error?: string | { code?: string; message?: string } }
    | null;

  if (!response.ok) {
    const apiError = payload && typeof payload === "object" && "error" in payload
      ? payload.error
      : undefined;
    const message = typeof apiError === "string"
      ? apiError
      : apiError?.message ?? "The backend could not complete the request.";
    const code = typeof apiError === "object" ? apiError?.code : undefined;
    throw new BackendApiError(message, response.status, code);
  }
  return payload as T;
}

export async function listPatients(): Promise<PatientListItem[]> {
  const response = await backendRequest<{ data: PatientListItem[] }>("/v1/patients");
  return response.data;
}

export async function getInsightsReport(): Promise<Tier3ProductInsightsReport> {
  const response = await backendRequest<{ data: Tier3ProductInsightsReport }>("/v1/insights/report");
  return response.data;
}

export function sendPatientChat(body: {
  patientId: PatientId;
  message: string;
  history: PatientHistory;
  sessionId?: string;
}): Promise<PatientChatResponse> {
  return backendRequest("/v1/chat/patient", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function sendInsightsChat(body: {
  message: string;
  history: InsightsHistory;
  sessionId?: string;
}): Promise<InsightsChatResponse> {
  return backendRequest("/v1/chat/insights", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
