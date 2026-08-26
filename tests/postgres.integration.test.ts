import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createPool } from "@/backend/src/db/pool";
import { PostgresConversationStore } from "@/backend/src/persistence/ConversationStore";
import { PostgresPatientRepository } from "@/backend/src/repositories/PostgresPatientRepository";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("PostgreSQL persistence", () => {
  it("reads seeded patients and commits a complete exchange", async () => {
    const pool = createPool(databaseUrl as string);
    const repository = new PostgresPatientRepository(pool);
    const store = new PostgresConversationStore(pool);
    const sessionId = randomUUID();

    try {
      expect(await repository.listPatientIds()).toHaveLength(5);
      expect((await repository.getPatientRecord("P1042")).patient.uid).toBe("P1042");

      await store.persistExchange({
        sessionId,
        channel: "patient",
        patientId: "P1042",
        userMessage: "Integration test question",
        assistantMessage: "Integration test answer",
        responsePayload: { mode: "integration_test" },
      });
      const persisted = await pool.query<{ message_count: string }>(
        `SELECT count(*) AS message_count
         FROM chat_messages
         WHERE session_id = $1`,
        [sessionId],
      );
      expect(Number(persisted.rows[0].message_count)).toBe(2);

      await expect(store.persistExchange({
        sessionId,
        channel: "patient",
        patientId: "P1108",
        userMessage: "Cross-patient attempt",
        assistantMessage: "Must not persist",
        responsePayload: {},
      })).rejects.toThrow(/does not belong/);
      const afterRejectedReuse = await pool.query<{ message_count: string }>(
        "SELECT count(*) AS message_count FROM chat_messages WHERE session_id = $1",
        [sessionId],
      );
      expect(Number(afterRejectedReuse.rows[0].message_count)).toBe(2);
    } finally {
      await pool.query("DELETE FROM chat_sessions WHERE id = $1", [sessionId]);
      await pool.end();
    }
  });
});
