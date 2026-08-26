import { z } from "zod";

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL_MODE: z.enum(["disable", "require", "verify-full"]).default("disable"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(20).default(3),
  BACKEND_SERVICE_TOKEN: z.string().min(24),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:3000"),
  OPENAI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(20_000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(0),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export type AppConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return configSchema.parse(environment);
}
