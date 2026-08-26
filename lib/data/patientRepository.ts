import type {
  ConversationsFile,
  PatientId,
  RawTier1Record,
  VisitNotesFile,
} from "@/lib/domain/types";

export interface PatientRepository {
  listPatientIds(): Promise<PatientId[]>;
  getPatientRecord(patientId: unknown): Promise<RawTier1Record>;
  getPatientMemory(patientId: unknown): Promise<ConversationsFile>;
  getPatientClinicalNotes(patientId: unknown): Promise<VisitNotesFile>;
}
