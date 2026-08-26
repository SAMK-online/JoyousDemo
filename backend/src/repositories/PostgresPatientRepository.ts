import type { Pool } from "pg";

import {
  parsePatientId,
  parseStoredClinicalNotes,
  parseStoredPatientDocuments,
  parseStoredPatientMemory,
  parseStoredTier1Record,
} from "@/lib/data/jsonPatientRepository";
import type { PatientDocuments, PatientRepository } from "@/lib/data/patientRepository";
import {
  type ConversationsFile,
  type PatientId,
  type RawTier1Record,
  type VisitNotesFile,
} from "@/lib/domain/types";

interface PatientRecordRow {
  uid: unknown;
  tier1_record: unknown;
  memory_record: unknown;
  clinical_record: unknown;
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
    const uid = parsePatientId(patientIdInput);
    const result = await this.pool.query<{ tier1_record: unknown }>(
      "SELECT tier1_record FROM patient_records WHERE uid = $1",
      [uid],
    );
    if (!result.rows[0]) throw new Error(`Patient record not found: ${uid}`);
    return parseStoredTier1Record(uid, result.rows[0].tier1_record);
  }

  async getPatientMemory(patientIdInput: unknown): Promise<ConversationsFile> {
    const uid = parsePatientId(patientIdInput);
    const result = await this.pool.query<{ memory_record: unknown }>(
      "SELECT memory_record FROM patient_records WHERE uid = $1",
      [uid],
    );
    if (!result.rows[0]) throw new Error(`Patient record not found: ${uid}`);
    return parseStoredPatientMemory(uid, result.rows[0].memory_record);
  }

  async getPatientClinicalNotes(patientIdInput: unknown): Promise<VisitNotesFile> {
    const uid = parsePatientId(patientIdInput);
    const result = await this.pool.query<{ clinical_record: unknown }>(
      "SELECT clinical_record FROM patient_records WHERE uid = $1",
      [uid],
    );
    if (!result.rows[0]) throw new Error(`Patient record not found: ${uid}`);
    return parseStoredClinicalNotes(uid, result.rows[0].clinical_record);
  }

  async getPatientDocuments(patientIdInput: unknown): Promise<PatientDocuments> {
    const uid = parsePatientId(patientIdInput);
    const result = await this.pool.query<PatientRecordRow>(
      `SELECT uid, tier1_record, memory_record, clinical_record
       FROM patient_records
       WHERE uid = $1`,
      [uid],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`Patient record not found: ${uid}`);
    return parseStoredPatientDocuments(
      uid,
      row.tier1_record,
      row.memory_record,
      row.clinical_record,
    );
  }
}
