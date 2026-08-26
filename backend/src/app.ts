import { timingSafeEqual } from "node:crypto";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import type { AppConfig } from "@/backend/src/config";
import {
  insightsChatRequestSchema,
  patientChatRequestSchema,
} from "@/backend/src/contracts/schemas";
import type { ConversationStore } from "@/backend/src/persistence/ConversationStore";
import { answerPatientQuestion } from "@/lib/assistant/answerPatientQuestion";
import { generatePatientAnswer } from "@/lib/assistant/openaiResponseGenerator";
import type { PatientRepository } from "@/lib/data/patientRepository";
import { normalizePatientRecord, toPatientListItem } from "@/lib/domain/normalizePatient";
import { generateProductInsightAnswer } from "@/lib/insights/productInsightsAssistant";
import { buildTier3ProductInsights } from "@/lib/insights/tier3ProductInsights";

interface BuildAppOptions {
  config: AppConfig;
  pool: Pool;
  repository: PatientRepository;
  conversationStore: ConversationStore;
  logger?: boolean | FastifyBaseLogger;
}

function tokenMatches(actual: string | undefined, expected: string): boolean {
  if (!actual?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(actual.slice("Bearer ".length));
  const configured = Buffer.from(expected);
  return supplied.length === configured.length && timingSafeEqual(supplied, configured);
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger ?? {
      level: options.config.LOG_LEVEL,
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "headers.authorization",
      ],
    },
    requestIdHeader: "x-request-id",
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: options.config.FRONTEND_ORIGIN,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "authorization", "x-request-id"],
  });
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url.startsWith("/health/")) return;
    if (!tokenMatches(request.headers.authorization, options.config.BACKEND_SERVICE_TOKEN)) {
      return reply.code(401).send({
        error: { code: "unauthorized", message: "A valid service credential is required." },
        requestId: request.id,
      });
    }
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async (_request, reply) => {
    try {
      await options.pool.query("SELECT 1");
      return { status: "ready", database: "connected" };
    } catch {
      return reply.code(503).send({ status: "not_ready", database: "unavailable" });
    }
  });

  app.get("/v1/patients", async () => {
    const patientIds = await options.repository.listPatientIds();
    const patients = await Promise.all(patientIds.map(async (uid) => {
      const [record, memory, clinical] = await Promise.all([
        options.repository.getPatientRecord(uid),
        options.repository.getPatientMemory(uid),
        options.repository.getPatientClinicalNotes(uid),
      ]);
      return toPatientListItem(normalizePatientRecord(record, memory, clinical));
    }));
    return { data: patients };
  });

  app.post("/v1/chat/patient", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request) => {
    const body = patientChatRequestSchema.parse(request.body);
    const [record, memory, clinical] = await Promise.all([
      options.repository.getPatientRecord(body.patientId),
      options.repository.getPatientMemory(body.patientId),
      options.repository.getPatientClinicalNotes(body.patientId),
    ]);
    const context = normalizePatientRecord(record, memory, clinical);
    const baseline = answerPatientQuestion(context, body.message);
    const { result, generation } = await generatePatientAnswer(
      context,
      body.message,
      body.history,
      baseline,
    );
    const payload = {
      ...result,
      generation,
      patientId: body.patientId,
      asOfDate: context.asOfDate,
    };
    const sessionId = await options.conversationStore.persistExchange({
      sessionId: body.sessionId,
      channel: "patient",
      patientId: body.patientId,
      userMessage: body.message,
      assistantMessage: result.answer,
      responsePayload: payload,
      review: result.review,
    });

    if (result.review?.required) {
      request.log.warn({
        event: "patient_safety_review",
        patientId: body.patientId,
        sessionId,
        reason: result.review.reason,
      });
    }
    return { ...payload, sessionId };
  });

  app.get("/v1/insights/report", async () => {
    const patientIds = await options.repository.listPatientIds();
    const files = await Promise.all(
      patientIds.map((uid) => options.repository.getPatientClinicalNotes(uid)),
    );
    return { data: buildTier3ProductInsights(files) };
  });

  app.post("/v1/chat/insights", {
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
  }, async (request) => {
    const body = insightsChatRequestSchema.parse(request.body);
    const patientIds = await options.repository.listPatientIds();
    const files = await Promise.all(
      patientIds.map((uid) => options.repository.getPatientClinicalNotes(uid)),
    );
    const report = buildTier3ProductInsights(files);
    const result = await generateProductInsightAnswer(report, body.message, body.history);
    const sessionId = await options.conversationStore.persistExchange({
      sessionId: body.sessionId,
      channel: "product_insights",
      userMessage: body.message,
      assistantMessage: result.answer,
      responsePayload: { ...result, reportAsOf: report.asOfDate },
    });
    return { ...result, reportAsOf: report.asOfDate, sessionId };
  });

  app.setNotFoundHandler((request, reply) => reply.code(404).send({
    error: { code: "not_found", message: "The requested API route does not exist." },
    requestId: request.id,
  }));

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply.code(400).send({
        error: {
          code: "invalid_request",
          message: "The request payload is invalid.",
          issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        },
        requestId: request.id,
      });
    }
    if ((error as { statusCode?: number }).statusCode === 429) {
      return reply.code(429).send({
        error: { code: "rate_limited", message: "Too many requests. Please try again shortly." },
        requestId: request.id,
      });
    }

    request.log.error({ err: error }, "API request failed");
    return reply.code(500).send({
      error: { code: "internal_error", message: "The service could not complete the request." },
      requestId: request.id,
    });
  });

  return app;
}
