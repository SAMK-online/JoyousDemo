import type { IncomingMessage, ServerResponse } from "node:http";

import { buildApp } from "../backend/src/app.js";
import { loadConfig } from "../backend/src/config.js";
import { createPool } from "../backend/src/db/pool.js";
import { PostgresConversationStore } from "../backend/src/persistence/ConversationStore.js";
import { PostgresPatientRepository } from "../backend/src/repositories/PostgresPatientRepository.js";

const config = loadConfig();
const pool = createPool(config.DATABASE_URL, config.DATABASE_SSL_MODE, config.DATABASE_POOL_MAX);

const appPromise = buildApp({
  config,
  pool,
  repository: new PostgresPatientRepository(pool),
  conversationStore: new PostgresConversationStore(pool),
});

export default async function handler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const app = await appPromise;
  await app.ready();
  app.server.emit("request", request, response);
}
