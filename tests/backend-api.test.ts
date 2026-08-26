import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "@/backend/src/app";
import type { AppConfig } from "@/backend/src/config";
import { MemoryConversationStore } from "@/backend/src/persistence/ConversationStore";
import { JsonPatientRepository } from "@/lib/data/jsonPatientRepository";

const serviceToken = "test-service-token-at-least-24-characters";
const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 4000,
  HOST: "127.0.0.1",
  DATABASE_URL: "postgresql://unused",
  DATABASE_SSL_MODE: "disable",
  BACKEND_SERVICE_TOKEN: serviceToken,
  FRONTEND_ORIGIN: "http://localhost:3000",
  OPENAI_TIMEOUT_MS: 20_000,
  OPENAI_MAX_RETRIES: 0,
  LOG_LEVEL: "silent",
};

describe("dedicated backend API", () => {
  const store = new MemoryConversationStore();
  const pool = {
    query: async () => ({ rows: [{ "?column?": 1 }] }),
  } as unknown as Pool;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    store.exchanges.length = 0;
    app = await buildApp({
      config,
      pool,
      repository: new JsonPatientRepository(),
      conversationStore: store,
      logger: false,
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("exposes liveness and database readiness without service credentials", async () => {
    const live = await app.inject({ method: "GET", url: "/health/live" });
    const ready = await app.inject({ method: "GET", url: "/health/ready" });

    expect(live.statusCode).toBe(200);
    expect(live.json()).toEqual({ status: "ok" });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: "ready", database: "connected" });
  });

  it("rejects protected routes without the server-to-server credential", async () => {
    const response = await app.inject({ method: "GET", url: "/v1/patients" });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("unauthorized");
  });

  it("returns normalized patient summaries from the repository", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/patients",
      headers: { authorization: `Bearer ${serviceToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data).toHaveLength(5);
    expect(response.json().data[0]).toEqual(expect.objectContaining({ uid: "P1042" }));
  });

  it("validates chat payloads at the backend boundary", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/patient",
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: { patientId: "not-a-patient", message: "" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    expect(store.exchanges).toHaveLength(0);
  });

  it("applies the deterministic safety override and persists the exchange", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/chat/patient",
      headers: { authorization: `Bearer ${serviceToken}` },
      payload: {
        patientId: "P1042",
        message: "I am going to kill myself",
        history: [],
      },
    });
    const payload = response.json();

    expect(response.statusCode).toBe(200);
    expect(payload.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(payload.generation.mode).toBe("guarded");
    expect(payload.review.required).toBe(true);
    expect(store.exchanges).toHaveLength(1);
    expect(store.exchanges[0]).toEqual(expect.objectContaining({
      channel: "patient",
      patientId: "P1042",
    }));
  });

  it("serves aggregate insights and persists an insights conversation", async () => {
    const headers = { authorization: `Bearer ${serviceToken}` };
    const report = await app.inject({ method: "GET", url: "/v1/insights/report", headers });
    const chat = await app.inject({
      method: "POST",
      url: "/v1/chat/insights",
      headers,
      payload: { message: "What gap should we prioritize?", history: [] },
    });

    expect(report.statusCode).toBe(200);
    expect(report.json().data.totalPatients).toBe(5);
    expect(chat.statusCode).toBe(200);
    expect(chat.json().sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.exchanges[0].channel).toBe("product_insights");
  });
});
