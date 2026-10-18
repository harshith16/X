import { describe, expect, it } from "vitest";
import { GET as getHealthz } from "@/app/api/healthz/route";
import { GET as getReadyz } from "@/app/api/readyz/route";

describe("Health endpoints", () => {
  it("healthz returns HTTP 200 and status ok", async () => {
    const response = await getHealthz();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.request_id).toBeDefined();
    expect(typeof body.request_id).toBe("string");
  });

  it("readyz returns HTTP 200 and status ready when database is reachable", async () => {
    const response = await getReadyz();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.request_id).toBeDefined();
    expect(typeof body.request_id).toBe("string");
  });
});
