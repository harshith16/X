import { describe, expect, it, vi } from "vitest";
import { GET as checkAvailability } from "@/app/api/handles/[handle]/availability/route";
import { POST as claimAgent } from "@/app/api/agents/claim/route";
import { POST as activateAgent } from "@/app/api/agents/activate/route";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

describe("Claim & Handle API endpoints authentication guards", () => {
  it("GET /api/handles/[handle]/availability returns 401 for unauthenticated request", async () => {
    const req = new NextRequest("http://localhost:3000/api/handles/myagent/availability");
    const response = await checkAvailability(req, {
      params: Promise.resolve({ handle: "myagent" }),
    });

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.request_id).toBeDefined();
  });

  it("POST /api/agents/claim returns 401 for unauthenticated request", async () => {
    const req = new NextRequest("http://localhost:3000/api/agents/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ handle: "myagent" }),
    });
    const response = await claimAgent(req);

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.request_id).toBeDefined();
  });

  it("POST /api/agents/activate returns 401 for unauthenticated request", async () => {
    const response = await activateAgent();

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("UNAUTHENTICATED");
    expect(body.error.request_id).toBeDefined();
  });
});
