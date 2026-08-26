import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "@/app/api/health/route";

const originalBackendUrl = process.env.BACKEND_API_URL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalBackendUrl === undefined) delete process.env.BACKEND_API_URL;
  else process.env.BACKEND_API_URL = originalBackendUrl;
});

describe("web readiness endpoint", () => {
  it("reports missing backend configuration", async () => {
    delete process.env.BACKEND_API_URL;
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "not_ready",
      dependencies: { backend: "not_configured" },
    });
  });

  it("reports the backend dependency as ready", async () => {
    process.env.BACKEND_API_URL = "https://api.example.com/";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready", dependencies: { backend: "ready" } });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.com/health/ready",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("fails closed when the backend is unavailable", async () => {
    process.env.BACKEND_API_URL = "https://api.example.com";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const response = await GET();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      status: "not_ready",
      dependencies: { backend: "unavailable" },
    });
  });
});
