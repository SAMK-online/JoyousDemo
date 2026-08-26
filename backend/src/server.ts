import "dotenv/config";

import { buildApp } from "@/backend/src/app";
import { loadConfig } from "@/backend/src/config";
import { createPool } from "@/backend/src/db/pool";
import { PostgresConversationStore } from "@/backend/src/persistence/ConversationStore";
import { PostgresPatientRepository } from "@/backend/src/repositories/PostgresPatientRepository";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL, config.DATABASE_SSL_MODE);
const app = await buildApp({
  config,
  pool,
  repository: new PostgresPatientRepository(pool),
  conversationStore: new PostgresConversationStore(pool),
});

async function shutdown(signal: string) {
  app.log.info({ signal }, "Graceful shutdown started");
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: config.HOST, port: config.PORT });
} catch (error) {
  app.log.fatal(error, "Backend failed to start");
  await pool.end();
  process.exit(1);
}
