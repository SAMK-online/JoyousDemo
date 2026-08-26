import type { Pool } from "pg";

import { parsePatientId } from "@/lib/data/jsonPatientRepository";
import type { PatientRepository } from "@/lib/data/patientRepository";
import {
  PATIENT_IDS,
  type ConversationsFile,
  type PatientId,
  type RawTier1Record,
  type VisitNotesFile,
} from "@/lib/domain/types";

interface PatientRecordRow {
  uid: PatientId;
  tier1_record: RawTier1Record;
  memory_record: ConversationsFile;
  clinical_record: VisitNotesFile;
}

export class PostgresPatientRepository implements PatientRepository {
  constructor(private readonly pool: Pool) {}

  async listPatientIds(): Promise<PatientId[]> {
    const result = await this.pool.query<{ uid: PatientId }>(
      "SELECT uid FROM patient_records ORDER BY uid",
    );
    return result.rows.map((row) => parsePatientId(row.uid));
  }

  async getPatientRecord(patientIdInput: unknown): Promise<RawTier1Record> {
    return (await this.getRow(patientIdInput)).tier1_record;
  }

  async getPatientMemory(patientIdInput: unknown): Promise<ConversationsFile> {
    return (await this.getRow(patientIdInput)).memory_record;
  }

  async getPatientClinicalNotes(patientIdInput: unknown): Promise<VisitNotesFile> {
    return (await this.getRow(patientIdInput)).clinical_record;
  }

  private async getRow(patientIdInput: unknown): Promise<PatientRecordRow> {
    const uid = parsePatientId(patientIdInput);
    const result = await this.pool.query<PatientRecordRow>(
      `SELECT uid, tier1_record, memory_record, clinical_record
       FROM patient_records
       WHERE uid = $1`,
      [uid],
    );
    const row = result.rows[0];
    if (!row || !PATIENT_IDS.includes(row.uid)) throw new Error(`Patient record not found: ${uid}`);
    return row;
  }
}
