import type {
  ConversationsFile,
  PatientId,
  RawTier1Record,
  VisitNotesFile,
} from "@/lib/domain/types";

export interface PatientDocuments {
  record: RawTier1Record;
  memory: ConversationsFile;
  clinical: VisitNotesFile;
}

export interface PatientRepository {
  listPatientIds(): Promise<PatientId[]>;
  getPatientDocuments(patientId: unknown): Promise<PatientDocuments>;
  getPatientRecord(patientId: unknown): Promise<RawTier1Record>;
  getPatientMemory(patientId: unknown): Promise<ConversationsFile>;
  getPatientClinicalNotes(patientId: unknown): Promise<VisitNotesFile>;
}
