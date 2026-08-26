import { z } from "zod";

import { PATIENT_IDS } from "../../../lib/domain/types.js";

export const conversationHistorySchema = z.array(z.object({
  role: z.enum(["patient", "assistant"]),
  text: z.string().trim().min(1).max(2400),
})).max(8).default([]);

export const patientChatRequestSchema = z.object({
  patientId: z.enum(PATIENT_IDS),
  message: z.string().trim().min(1).max(1200),
  history: conversationHistorySchema,
  sessionId: z.string().uuid().optional(),
});

export const insightsHistorySchema = z.array(z.object({
  role: z.enum(["product", "assistant"]),
  text: z.string().trim().min(1).max(2400),
})).max(8).default([]);

export const insightsChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(1200),
  history: insightsHistorySchema,
  sessionId: z.string().uuid().optional(),
});
