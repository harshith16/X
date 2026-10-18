import { describe, expect, it, afterEach, vi } from "vitest";
import { POST as devLogin } from "@/app/api/dev-login/route";
import { NextRequest } from "next/server";

describe("POST /api/dev-login security & gating", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 404 when DEV_TEST_LOGIN is not 'true'", async () => {
    vi.stubEnv("DEV_TEST_LOGIN", "false");
    vi.stubEnv("NODE_ENV", "development");

    const req = new NextRequest("http://localhost:3000/api/dev-login", { method: "POST" });
    const res = await devLogin(req);

    expect(res.status).toBe(404);
  });

  it("returns 404 when DEV_TEST_LOGIN is undefined", async () => {
    vi.stubEnv("DEV_TEST_LOGIN", "");
    vi.stubEnv("NODE_ENV", "development");

    const req = new NextRequest("http://localhost:3000/api/dev-login", { method: "POST" });
    const res = await devLogin(req);

    expect(res.status).toBe(404);
  });

  it("returns 404 in production even if DEV_TEST_LOGIN is 'true'", async () => {
    vi.stubEnv("DEV_TEST_LOGIN", "true");
    vi.stubEnv("NODE_ENV", "production");

    const req = new NextRequest("http://localhost:3000/api/dev-login", { method: "POST" });
    const res = await devLogin(req);

    expect(res.status).toBe(404);
  });
});
