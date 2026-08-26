import { randomUUID } from "node:crypto";

import type { Pool } from "pg";

import type { AssistantAnswer, PatientId } from "../../../lib/domain/types.js";

export type ConversationChannel = "patient" | "product_insights";

export interface PersistExchangeInput {
  sessionId?: string;
  channel: ConversationChannel;
  patientId?: PatientId;
  userMessage: string;
  assistantMessage: string;
  responsePayload: Record<string, unknown>;
  review?: AssistantAnswer["review"];
}

export interface ConversationStore {
  persistExchange(input: PersistExchangeInput): Promise<string>;
}

export class PostgresConversationStore implements ConversationStore {
  constructor(private readonly pool: Pool) {}

  async persistExchange(input: PersistExchangeInput): Promise<string> {
    const sessionId = input.sessionId ?? randomUUID();
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const session = await client.query(
        `INSERT INTO chat_sessions(id, channel, patient_uid)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
         WHERE chat_sessions.channel = EXCLUDED.channel
           AND chat_sessions.patient_uid IS NOT DISTINCT FROM EXCLUDED.patient_uid
         RETURNING id`,
        [sessionId, input.channel, input.patientId ?? null],
      );
      if (session.rowCount !== 1) {
        throw new Error("Conversation session does not belong to this channel and patient.");
      }
      await client.query(
        `INSERT INTO chat_messages(session_id, role, content)
         VALUES ($1, 'user', $2)`,
        [sessionId, input.userMessage],
      );
      await client.query(
        `INSERT INTO chat_messages(session_id, role, content, response_payload)
         VALUES ($1, 'assistant', $2, $3::jsonb)`,
        [sessionId, input.assistantMessage, JSON.stringify(input.responsePayload)],
      );
      if (input.review) {
        await client.query(
          `INSERT INTO safety_events(session_id, patient_uid, reason, payload)
           VALUES ($1, $2, $3, $4::jsonb)`,
          [sessionId, input.patientId ?? null, input.review.reason, JSON.stringify(input.review)],
        );
      }
      await client.query("COMMIT");
      return sessionId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export class MemoryConversationStore implements ConversationStore {
  readonly exchanges: PersistExchangeInput[] = [];

  async persistExchange(input: PersistExchangeInput): Promise<string> {
    this.exchanges.push(input);
    return input.sessionId ?? randomUUID();
  }
}
