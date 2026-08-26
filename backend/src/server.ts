import "dotenv/config";

import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool } from "./db/pool.js";
import { PostgresConversationStore } from "./persistence/ConversationStore.js";
import { PostgresPatientRepository } from "./repositories/PostgresPatientRepository.js";

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
