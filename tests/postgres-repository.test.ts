import type { Pool } from "pg";
import { describe, expect, it } from "vitest";

import { PostgresPatientRepository } from "@/backend/src/repositories/PostgresPatientRepository";
import { JsonPatientRepository } from "@/lib/data/jsonPatientRepository";

describe("PostgresPatientRepository document boundary", () => {
  it("loads and validates the complete patient bundle in one query", async () => {
    const source = await new JsonPatientRepository().getPatientDocuments("P1042");
    let queryCount = 0;
    const pool = {
      query: async () => {
        queryCount += 1;
        return {
          rows: [{
            uid: "P1042",
            tier1_record: source.record,
            memory_record: source.memory,
            clinical_record: source.clinical,
          }],
        };
      },
    } as unknown as Pool;

    const bundle = await new PostgresPatientRepository(pool).getPatientDocuments("P1042");

    expect(queryCount).toBe(1);
    expect(bundle.record.patient.uid).toBe("P1042");
    expect(bundle.record.knowledgeBase[0].sourceFile).toMatch(/^knowledge_base\//);
  });

  it("rejects cross-patient or malformed stored documents", async () => {
    const source = await new JsonPatientRepository().getPatientDocuments("P1042");
    const pool = {
      query: async () => ({
        rows: [{
          uid: "P1042",
          tier1_record: source.record,
          memory_record: { ...source.memory, uid: "P1108" },
          clinical_record: source.clinical,
        }],
      }),
    } as unknown as Pool;

    await expect(
      new PostgresPatientRepository(pool).getPatientDocuments("P1042"),
    ).rejects.toThrow();
  });

  it("reads only the clinical column for the offline insights path", async () => {
    const source = await new JsonPatientRepository().getPatientDocuments("P1042");
    let statement = "";
    const pool = {
      query: async (sql: string) => {
        statement = sql;
        return { rows: [{ clinical_record: source.clinical }] };
      },
    } as unknown as Pool;

    const notes = await new PostgresPatientRepository(pool).getPatientClinicalNotes("P1042");

    expect(notes.uid).toBe("P1042");
    expect(statement).toContain("SELECT clinical_record");
    expect(statement).not.toContain("tier1_record");
    expect(statement).not.toContain("memory_record");
  });
});
