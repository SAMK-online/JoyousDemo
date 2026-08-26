import { afterEach, describe, expect, it } from "vitest";

import { createOpenAIClient } from "@/lib/assistant/openaiClient";

const originalTimeout = process.env.OPENAI_TIMEOUT_MS;
const originalRetries = process.env.OPENAI_MAX_RETRIES;

afterEach(() => {
  if (originalTimeout === undefined) delete process.env.OPENAI_TIMEOUT_MS;
  else process.env.OPENAI_TIMEOUT_MS = originalTimeout;
  if (originalRetries === undefined) delete process.env.OPENAI_MAX_RETRIES;
  else process.env.OPENAI_MAX_RETRIES = originalRetries;
});

describe("OpenAI client resilience", () => {
  it("uses a bounded request deadline and no retries by default", () => {
    delete process.env.OPENAI_TIMEOUT_MS;
    delete process.env.OPENAI_MAX_RETRIES;
    const client = createOpenAIClient("test-key");

    expect(client.timeout).toBe(20_000);
    expect(client.maxRetries).toBe(0);
  });

  it("accepts safe configured bounds and rejects unsafe values", () => {
    process.env.OPENAI_TIMEOUT_MS = "15000";
    process.env.OPENAI_MAX_RETRIES = "2";
    expect(createOpenAIClient("test-key").timeout).toBe(15_000);
    expect(createOpenAIClient("test-key").maxRetries).toBe(2);

    process.env.OPENAI_TIMEOUT_MS = "600000";
    process.env.OPENAI_MAX_RETRIES = "99";
    expect(createOpenAIClient("test-key").timeout).toBe(20_000);
    expect(createOpenAIClient("test-key").maxRetries).toBe(0);
  });
});
