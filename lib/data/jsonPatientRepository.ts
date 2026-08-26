import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  PATIENT_IDS,
  type CasesFile,
  type CheckinsFile,
  type ConversationsFile,
  type KnowledgeArticle,
  type MeetingsFile,
  type PatientFile,
  type PatientForm,
  type PatientId,
  type RawTier1Record,
  type ShipmentsFile,
  type VisitNotesFile,
} from "@/lib/domain/types";
import type { PatientDocuments, PatientRepository } from "@/lib/data/patientRepository";

const tier1Root = path.join(
  process.cwd(),
  "JoyousPM_PatientAssistant_Case",
  "data",
  "tier1_core",
);

const tier2Root = path.join(
  process.cwd(),
  "JoyousPM_PatientAssistant_Case",
  "data",
  "tier2_memory",
);

const tier3Root = path.join(
  process.cwd(),
  "JoyousPM_PatientAssistant_Case",
  "data",
  "tier3_clinical",
);

const patientIdSchema = z.enum(PATIENT_IDS);
const patientSchema = z.object({
  uid: patientIdSchema,
  first_name: z.string(),
  status: z.enum(["active", "onboarding", "not_approved", "churned"]),
  profile: z.object({
    state: z.string(),
    timezone: z.string(),
    created_at: z.string(),
    commitment_type: z.string().nullable(),
  }),
  protocol: z.record(z.string(), z.unknown()).nullable(),
});

const casesSchema = z.object({
  uid: patientIdSchema,
  cases: z.array(z.object({ case_id: z.string(), case_type: z.string() }).passthrough()),
});

const meetingsSchema = z.object({
  uid: patientIdSchema,
  meetings: z.array(z.object({ meeting_id: z.string(), scheduled_at: z.string() }).passthrough()),
});

const shipmentsSchema = z.object({
  uid: patientIdSchema,
  orders: z.array(z.object({ order_number: z.string(), shipDate: z.string() }).passthrough()),
});

const checkinsSchema = z.object({
  uid: patientIdSchema,
  cadence: z.string().nullable(),
  checkins_count: z.number(),
  history: z.array(z.unknown()),
  scores: z.record(z.string(), z.unknown()),
}).passthrough();

const formSchema = z.object({
  flow_label: z.string(),
  uid: patientIdSchema,
  finalized: z.boolean(),
  submitted_at: z.string(),
  answers: z.record(z.string(), z.unknown()),
});

const articleSchema = z.object({
  article_id: z.string(),
  title: z.string(),
  audience: z.string(),
  updated_at: z.string(),
  body: z.array(z.string()),
});

const conversationMessageSchema = z.object({
  sent_at: z.string(),
  from: z.enum(["patient", "ai_assistant", "care_team", "nurse_team", "system_automated"]),
  text: z.string(),
});

const conversationThreadSchema = z.object({
  thread_id: z.string(),
  opened_at: z.string(),
  channel: z.enum(["sms", "app_message"]),
  status: z.enum(["open", "resolved", "no_reply"]),
  escalated_to: z.enum(["care_team", "nurse_team"]).nullable(),
  tags: z.array(z.string()),
  messages: z.array(conversationMessageSchema),
  unresolved_request: z.string().optional(),
  review_flag: z.string().optional(),
});

const conversationsSchema = z.object({
  uid: patientIdSchema,
  threads: z.array(conversationThreadSchema),
});

const visitNoteSchema = z.object({
  note_id: z.string(),
  meeting_id: z.string(),
  date: z.string(),
  meeting_type: z.string(),
  participants: z.array(z.string()),
  transcript: z.array(z.object({ speaker: z.string(), text: z.string() })),
  clinical_summary: z.string(),
  plan: z.string(),
});

const visitNotesSchema = z.object({
  uid: patientIdSchema,
  notes: z.array(visitNoteSchema),
});

const storedTier1RecordSchema = z.object({
  patient: patientSchema,
  cases: casesSchema,
  meetings: meetingsSchema,
  shipments: shipmentsSchema,
  checkins: checkinsSchema,
  forms: z.array(formSchema.extend({ sourceFile: z.string() })),
  knowledgeBase: z.array(articleSchema.extend({ sourceFile: z.string() })),
});

async function parseJson<T>(filePath: string, schema: z.ZodType<T>): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return schema.parse(JSON.parse(raw));
}

export function parsePatientId(value: unknown): PatientId {
  return patientIdSchema.parse(value);
}

export function parseStoredTier1Record(patientIdInput: unknown, input: unknown): RawTier1Record {
  const uid = parsePatientId(patientIdInput);
  const record = storedTier1RecordSchema.parse(input) as unknown as RawTier1Record;
  if (record.patient.uid !== uid) throw new Error(`Stored Tier 1 patient mismatch for ${uid}`);
  return record;
}

export function parseStoredPatientMemory(patientIdInput: unknown, input: unknown): ConversationsFile {
  const uid = parsePatientId(patientIdInput);
  const memory = conversationsSchema.parse(input) as ConversationsFile;
  if (memory.uid !== uid) throw new Error(`Stored Tier 2 patient mismatch for ${uid}`);
  return memory;
}

export function parseStoredClinicalNotes(patientIdInput: unknown, input: unknown): VisitNotesFile {
  const uid = parsePatientId(patientIdInput);
  const clinical = visitNotesSchema.parse(input) as VisitNotesFile;
  if (clinical.uid !== uid) throw new Error(`Stored Tier 3 patient mismatch for ${uid}`);
  return clinical;
}

export function parseStoredPatientDocuments(
  patientIdInput: unknown,
  tier1Input: unknown,
  memoryInput: unknown,
  clinicalInput: unknown,
): PatientDocuments {
  const uid = parsePatientId(patientIdInput);
  const record = parseStoredTier1Record(uid, tier1Input);
  const memory = parseStoredPatientMemory(uid, memoryInput);
  const clinical = parseStoredClinicalNotes(uid, clinicalInput);
  return { record, memory, clinical };
}

export class JsonPatientRepository implements PatientRepository {
  async listPatientIds(): Promise<PatientId[]> {
    return [...PATIENT_IDS];
  }

  async getPatientRecord(patientIdInput: unknown): Promise<RawTier1Record> {
    const uid = parsePatientId(patientIdInput);
    const patientRoot = path.join(tier1Root, "patients", uid);

    const [patient, cases, meetings, shipments, checkins, forms, knowledgeBase] =
      await Promise.all([
        parseJson(path.join(patientRoot, "patient.json"), patientSchema) as Promise<PatientFile>,
        parseJson(path.join(patientRoot, "cases.json"), casesSchema) as Promise<CasesFile>,
        parseJson(path.join(patientRoot, "meetings.json"), meetingsSchema) as Promise<MeetingsFile>,
        parseJson(path.join(patientRoot, "shipments.json"), shipmentsSchema) as unknown as Promise<ShipmentsFile>,
        parseJson(path.join(patientRoot, "checkins.json"), checkinsSchema) as Promise<CheckinsFile>,
        this.getForms(uid),
        this.getKnowledgeBase(),
      ]);

    return { patient, cases, meetings, shipments, checkins, forms, knowledgeBase };
  }

  async getPatientDocuments(patientIdInput: unknown): Promise<PatientDocuments> {
    const uid = parsePatientId(patientIdInput);
    const [record, memory, clinical] = await Promise.all([
      this.getPatientRecord(uid),
      this.getPatientMemory(uid),
      this.getPatientClinicalNotes(uid),
    ]);
    return { record, memory, clinical };
  }

  async getPatientMemory(patientIdInput: unknown): Promise<ConversationsFile> {
    const uid = parsePatientId(patientIdInput);
    const memory = await parseJson(
      path.join(tier2Root, "patients", uid, "conversations.json"),
      conversationsSchema,
    );
    if (memory.uid !== uid) throw new Error(`Tier 2 patient mismatch for ${uid}`);
    return memory;
  }

  async getPatientClinicalNotes(patientIdInput: unknown): Promise<VisitNotesFile> {
    const uid = parsePatientId(patientIdInput);
    const clinical = await parseJson(
      path.join(tier3Root, "patients", uid, "visit_notes.json"),
      visitNotesSchema,
    );
    if (clinical.uid !== uid) throw new Error(`Tier 3 patient mismatch for ${uid}`);
    return clinical;
  }

  private async getForms(uid: PatientId): Promise<PatientForm[]> {
    const formsRoot = path.join(tier1Root, "patients", uid, "forms");
    const files = (await readdir(formsRoot)).filter((file) => file.endsWith(".json")).sort();

    return Promise.all(
      files.map(async (file): Promise<PatientForm> => ({
        ...(await parseJson(path.join(formsRoot, file), formSchema)),
        sourceFile: `forms/${file}`,
      })),
    );
  }

  private async getKnowledgeBase(): Promise<KnowledgeArticle[]> {
    const knowledgeRoot = path.join(tier1Root, "knowledge_base");
    const files = (await readdir(knowledgeRoot)).filter((file) => file.endsWith(".json")).sort();

    return Promise.all(
      files.map(async (file) => ({
        ...(await parseJson(path.join(knowledgeRoot, file), articleSchema)),
        sourceFile: `knowledge_base/${file}`,
      })),
    );
  }
}
