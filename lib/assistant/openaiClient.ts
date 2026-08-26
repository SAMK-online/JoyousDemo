import OpenAI from "openai";

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function createOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    timeout: boundedInteger(process.env.OPENAI_TIMEOUT_MS, 20_000, 1_000, 60_000),
    maxRetries: boundedInteger(process.env.OPENAI_MAX_RETRIES, 0, 0, 3),
  });
}
