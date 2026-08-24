import { PatientAssistant } from "@/components/PatientAssistant";
import { JsonPatientRepository } from "@/lib/data/jsonPatientRepository";
import { normalizePatientRecord, toPatientListItem } from "@/lib/domain/normalizePatient";

export const dynamic = "force-dynamic";

export default async function Home() {
  const repository = new JsonPatientRepository();
  const patientIds = await repository.listPatientIds();
  const patients = await Promise.all(
    patientIds.map(async (uid) => {
      const [record, memory, clinical] = await Promise.all([
        repository.getPatientRecord(uid),
        repository.getPatientMemory(uid),
        repository.getPatientClinicalNotes(uid),
      ]);
      return toPatientListItem(normalizePatientRecord(record, memory, clinical));
    }),
  );

  return <PatientAssistant patients={patients} />;
}
