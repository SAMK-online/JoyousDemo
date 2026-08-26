import "dotenv/config";

import { loadConfig } from "@/backend/src/config";
import { createPool } from "@/backend/src/db/pool";
import { JsonPatientRepository } from "@/lib/data/jsonPatientRepository";

export async function seedDatabase(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL, config.DATABASE_SSL_MODE);
  const source = new JsonPatientRepository();

  try {
    const patientIds = await source.listPatientIds();
    for (const uid of patientIds) {
      const { record: tier1, memory, clinical } = await source.getPatientDocuments(uid);
      await pool.query(
        `INSERT INTO patient_records(uid, tier1_record, memory_record, clinical_record)
         VALUES ($1, $2::jsonb, $3::jsonb, $4::jsonb)
         ON CONFLICT (uid) DO UPDATE SET
           tier1_record = EXCLUDED.tier1_record,
           memory_record = EXCLUDED.memory_record,
           clinical_record = EXCLUDED.clinical_record,
           source_version = patient_records.source_version + 1,
           updated_at = NOW()
         WHERE patient_records.tier1_record IS DISTINCT FROM EXCLUDED.tier1_record
            OR patient_records.memory_record IS DISTINCT FROM EXCLUDED.memory_record
            OR patient_records.clinical_record IS DISTINCT FROM EXCLUDED.clinical_record`,
        [uid, JSON.stringify(tier1), JSON.stringify(memory), JSON.stringify(clinical)],
      );
    }
    console.info(`Seeded ${patientIds.length} synthetic patient records`);
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seedDatabase().catch((error) => {
    console.error("Database seed failed", error);
    process.exitCode = 1;
  });
}
