import { describe, expect, it } from "vitest";

import { createSession, readSession } from "@/lib/auth/session";

const secret = "test-session-secret-with-at-least-32-characters";

describe("signed workspace sessions", () => {
  it("round-trips a valid role", async () => {
    const token = await createSession("patient", secret);
    expect(await readSession(token, secret)).toEqual(expect.objectContaining({ role: "patient" }));
  });

  it("rejects tampered and incorrectly signed tokens", async () => {
    const token = await createSession("product", secret);
    const [payload, signature] = token.split(".");

    expect(await readSession(`${payload}x.${signature}`, secret)).toBeNull();
    expect(await readSession(token, `${secret}-wrong`)).toBeNull();
  });
});
