import { Pool } from "pg";

export type DatabaseSslMode = "disable" | "require" | "verify-full";

export function createPool(
  databaseUrl: string,
  sslMode: DatabaseSslMode = "disable",
  maxConnections = 10,
): Pool {
  return new Pool({
    connectionString: databaseUrl,
    max: maxConnections,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ssl: sslMode === "disable"
      ? undefined
      : { rejectUnauthorized: sslMode === "verify-full" },
  });
}
