import { PatientAssistant } from "@/components/PatientAssistant";
import { listPatients } from "@/lib/api/backendClient";

export const dynamic = "force-dynamic";

export default async function Home() {
  const patients = await listPatients();

  return <PatientAssistant patients={patients} />;
}
