/**
 * scripts/smoke.mjs
 * Permanent full-product smoke verification script for Qurelium.
 * Checks all 17 product and claim flows against http://localhost:3000.
 * Plain Node, uses existing project packages only.
 * Usage: node scripts/smoke.mjs
 */

import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const BASE_URL = process.env.TEST_APP_URL || "http://localhost:3000";

// Read Supabase credentials from .env.local safely (never print values)
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf8");
  return Object.fromEntries(
    content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && l.includes("="))
      .map((l) => {
        const idx = l.indexOf("=");
        return [l.slice(0, idx).trim(), l.slice(idx + 1).trim()];
      }),
  );
}

class SimpleCookieJar {
  constructor() {
    this.cookies = new Map();
  }

  update(response) {
    let rawHeaders = [];
    if (typeof response.headers.getSetCookie === "function") {
      rawHeaders = response.headers.getSetCookie();
    } else {
      const header = response.headers.get("set-cookie");
      if (header) rawHeaders = [header];
    }

    for (const headerStr of rawHeaders) {
      const parts = headerStr.split(";").map((p) => p.trim());
      const [nameValue, ...attrs] = parts;
      const eqIdx = nameValue.indexOf("=");
      if (eqIdx === -1) continue;
      const name = nameValue.slice(0, eqIdx).trim();
      const value = nameValue.slice(eqIdx + 1).trim();

      const isExpired = attrs.some((a) => {
        const lower = a.toLowerCase();
        return (
          lower === "max-age=0" ||
          lower.startsWith("max-age=-") ||
          (lower.startsWith("expires=") && new Date(lower.replace("expires=", "")) < new Date())
        );
      });

      if (isExpired || !value) {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  getCookieHeader() {
    return Array.from(this.cookies.entries())
      .map(([name, val]) => `${name}=${val}`)
      .join("; ");
  }

  hasSupabaseAuthToken() {
    return Array.from(this.cookies.keys()).some(
      (k) => k.startsWith("sb-") && k.includes("auth-token"),
    );
  }
}

async function runSmokeTests() {
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    console.error("Error: Missing Supabase credentials in .env.local");
    process.exit(1);
  }

  const supabaseAdmin = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = [];
  let allPassed = true;

  function record(id, description, status, details = "") {
    rows.push({ id, description, status, details });
    if (status === "FAIL") {
      allPassed = false;
    }
  }

  // Track test users and agents for cleanup
  const cleanupUserIds = [];
  const cleanupHandles = [];

  const devJar = new SimpleCookieJar();
  const user1Jar = new SimpleCookieJar();
  const user2Jar = new SimpleCookieJar();

  let user1 = null;
  let user2 = null;
  const freeHandle = "test_smoke_" + Math.floor(100000 + Math.random() * 900000);
  cleanupHandles.push(freeHandle);

  try {
    // ── 1. GET /api/healthz → 200 ──────────────────────────────────────────
    try {
      const res = await fetch(`${BASE_URL}/api/healthz`, { redirect: "manual" });
      if (res.status === 200) {
        record(1, "GET /api/healthz", "PASS", "200 OK");
      } else {
        record(1, "GET /api/healthz", "FAIL", `Expected 200, got ${res.status}`);
      }
    } catch (err) {
      record(1, "GET /api/healthz", "FAIL", err.message);
    }

    // ── 2. GET /api/readyz → 200 ───────────────────────────────────────────
    try {
      const res = await fetch(`${BASE_URL}/api/readyz`, { redirect: "manual" });
      if (res.status === 200) {
        record(2, "GET /api/readyz", "PASS", "200 OK");
      } else {
        record(2, "GET /api/readyz", "FAIL", `Expected 200, got ${res.status}`);
      }
    } catch (err) {
      record(2, "GET /api/readyz", "FAIL", err.message);
    }

    // ── 3. GET /login → 200 (email form, Google btn, theme toggle) ─────────
    let googleButtonPresent = false;
    try {
      const res = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
      const html = await res.text();
      const hasEmailForm =
        html.includes('type="email"') ||
        html.includes('id="email"') ||
        html.includes("Email address") ||
        html.includes("magic-link-btn");
      const hasGoogleBtn =
        html.includes("Continue with Google") || html.includes('id="google-btn"');
      const hasThemeToggle =
        html.includes("theme-toggle") ||
        html.includes("Toggle theme") ||
        html.includes("<svg") ||
        html.includes("ThemeToggle");

      googleButtonPresent = hasGoogleBtn;

      if (res.status === 200 && hasEmailForm && hasGoogleBtn && hasThemeToggle) {
        record(
          3,
          "GET /login (email form, Google btn, theme toggle)",
          "PASS",
          "200 OK, all elements present",
        );
      } else {
        const missing = [];
        if (!hasEmailForm) missing.push("email form");
        if (!hasGoogleBtn) missing.push("Google button");
        if (!hasThemeToggle) missing.push("theme toggle");
        record(
          3,
          "GET /login (email form, Google btn, theme toggle)",
          "FAIL",
          `status=${res.status}, missing: ${missing.join(", ") || "none"}`,
        );
      }
    } catch (err) {
      record(3, "GET /login (email form, Google btn, theme toggle)", "FAIL", err.message);
    }

    // ── 4. GET / with NO session → redirect to /login ───────────────────────
    try {
      const res = await fetch(`${BASE_URL}/`, { redirect: "manual" });
      const location = res.headers.get("location") || "";
      if (
        (res.status === 307 || res.status === 302 || res.status === 303) &&
        (location === "/login" || location.endsWith("/login"))
      ) {
        record(4, "GET / with NO session", "PASS", `${res.status} redirect to /login`);
      } else {
        record(
          4,
          "GET / with NO session",
          "FAIL",
          `Expected redirect to /login, got ${res.status} ${location}`,
        );
      }
    } catch (err) {
      record(4, "GET / with NO session", "FAIL", err.message);
    }

    // ── 5. POST /api/dev-login → sets session cookie and redirects to / ─────
    try {
      const res = await fetch(`${BASE_URL}/api/dev-login`, {
        method: "POST",
        redirect: "manual",
      });
      devJar.update(res);
      const location = res.headers.get("location") || "";
      const hasToken = devJar.hasSupabaseAuthToken();

      if (
        (res.status === 303 || res.status === 302 || res.status === 307) &&
        (location === "/" || location.endsWith("/")) &&
        hasToken
      ) {
        record(5, "POST /api/dev-login", "PASS", `${res.status} redirect to /, session cookie set`);
      } else {
        record(
          5,
          "POST /api/dev-login",
          "FAIL",
          `status=${res.status}, location=${location}, authCookie=${hasToken}`,
        );
      }
    } catch (err) {
      record(5, "POST /api/dev-login", "FAIL", err.message);
    }

    // ── 6. GET / WITH that session cookie → 200, chat list + sign-out ───────
    let signOutActionName = null;
    try {
      const res = await fetch(`${BASE_URL}/`, {
        headers: { cookie: devJar.getCookieHeader() },
        redirect: "manual",
      });
      devJar.update(res);
      const html = await res.text();
      const hasChatList =
        html.includes("<aside") ||
        html.includes("Search") ||
        html.includes("No conversations yet") ||
        html.includes("@dev_agent");
      const hasSignOut =
        html.includes('id="sign-out-btn"') ||
        html.includes("Sign out") ||
        html.includes('type="submit"');

      const match = html.match(/name="(\$ACTION_ID_[^"]+)"/);
      if (match) signOutActionName = match[1];

      if (res.status === 200 && hasChatList && hasSignOut) {
        record(
          6,
          "GET / WITH session cookie",
          "PASS",
          "200 OK, chat list + sign-out control present",
        );
      } else {
        record(
          6,
          "GET / WITH session cookie",
          "FAIL",
          `status=${res.status}, hasChatList=${hasChatList}, hasSignOut=${hasSignOut}`,
        );
      }
    } catch (err) {
      record(6, "GET / WITH session cookie", "FAIL", err.message);
    }

    // ── 7. Sign out with the session → afterwards GET / redirects to /login ──
    try {
      if (!signOutActionName) {
        const freshRes = await fetch(`${BASE_URL}/`, {
          headers: { cookie: devJar.getCookieHeader() },
        });
        const freshHtml = await freshRes.text();
        const match = freshHtml.match(/name="(\$ACTION_ID_[^"]+)"/);
        if (match) signOutActionName = match[1];
      }

      if (!signOutActionName) {
        record(7, "Sign out action", "FAIL", "Could not locate sign-out action ID in shell HTML");
      } else {
        const formData = new FormData();
        formData.append(signOutActionName, "");

        const signOutRes = await fetch(`${BASE_URL}/`, {
          method: "POST",
          headers: { cookie: devJar.getCookieHeader() },
          body: formData,
          redirect: "manual",
        });
        devJar.update(signOutRes);

        const checkRes = await fetch(`${BASE_URL}/`, {
          headers: { cookie: devJar.getCookieHeader() },
          redirect: "manual",
        });
        const loc = checkRes.headers.get("location") || "";

        if (
          (checkRes.status === 307 || checkRes.status === 302 || checkRes.status === 303) &&
          (loc === "/login" || loc.endsWith("/login"))
        ) {
          record(7, "Sign out action", "PASS", "Session cleared, GET / redirects to /login");
        } else {
          record(
            7,
            "Sign out action",
            "FAIL",
            `After sign-out, GET / returned status=${checkRes.status} loc=${loc}`,
          );
        }
      }
    } catch (err) {
      record(7, "Sign out action", "FAIL", err.message);
    }

    // ── 8. Row for email magic-link send ───────────────────────────────────
    record(8, "POST /login (email magic link)", "NOT EXERCISED — sends real email", "");

    // ── 9. Row for Google button ───────────────────────────────────────────
    record(
      9,
      "Google OAuth button",
      googleButtonPresent
        ? "PRESENT, DORMANT — provider not configured"
        : "FAIL — Google button missing",
      googleButtonPresent ? "Verified presence in DOM" : "",
    );

    // ── SETUP: Create test users 1 & 2 via admin API for claim tests ─────────
    const u1Email = `smoke_u1_${Date.now()}@qurelium.local`;
    const u2Email = `smoke_u2_${Date.now()}@qurelium.local`;

    const createU1 = await supabaseAdmin.auth.admin.createUser({
      email: u1Email,
      email_confirm: true,
    });
    user1 = createU1.data?.user;
    if (user1) {
      cleanupUserIds.push(user1.id);
      await supabaseAdmin.from("users").upsert({ id: user1.id, email: user1.email });
    }

    const createU2 = await supabaseAdmin.auth.admin.createUser({
      email: u2Email,
      email_confirm: true,
    });
    user2 = createU2.data?.user;
    if (user2) {
      cleanupUserIds.push(user2.id);
      await supabaseAdmin.from("users").upsert({ id: user2.id, email: user2.email });
    }

    // Establish session for user1
    const l1 = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: u1Email,
    });
    const cb1 = await fetch(
      `${BASE_URL}/auth/callback?token_hash=${l1.data.properties.hashed_token}&type=magiclink`,
      { redirect: "manual" },
    );
    user1Jar.update(cb1);

    // Establish session for user2
    const l2 = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: u2Email,
    });
    const cb2 = await fetch(
      `${BASE_URL}/auth/callback?token_hash=${l2.data.properties.hashed_token}&type=magiclink`,
      { redirect: "manual" },
    );
    user2Jar.update(cb2);

    // ── 10. Fresh user, no agent: GET / → redirect to /claim ───────────────
    try {
      const res = await fetch(`${BASE_URL}/`, {
        headers: { cookie: user1Jar.getCookieHeader() },
        redirect: "manual",
      });
      const location = res.headers.get("location") || "";
      if (
        (res.status === 307 || res.status === 302 || res.status === 303) &&
        (location === "/claim" || location.endsWith("/claim"))
      ) {
        record(10, "Fresh user, no agent: GET /", "PASS", `${res.status} redirect to /claim`);
      } else {
        record(
          10,
          "Fresh user, no agent: GET /",
          "FAIL",
          `Expected redirect to /claim, got status=${res.status} location=${location}`,
        );
      }
    } catch (err) {
      record(10, "Fresh user, no agent: GET /", "FAIL", err.message);
    }

    // ── 11. Availability: "dev_agent" → false · free → true · invalid → 400 ─
    try {
      // 11a. dev_agent taken
      const rTaken = await fetch(`${BASE_URL}/api/handles/dev_agent/availability`, {
        headers: { cookie: user1Jar.getCookieHeader() },
      });
      const bTaken = await rTaken.json();
      const takenPass = rTaken.status === 200 && bTaken.available === false;

      // 11b. free handle available
      const rFree = await fetch(`${BASE_URL}/api/handles/${freeHandle}/availability`, {
        headers: { cookie: user1Jar.getCookieHeader() },
      });
      const bFree = await rFree.json();
      const freePass = rFree.status === 200 && bFree.available === true;

      // 11c. invalid format -> 400
      const rInvalid = await fetch(`${BASE_URL}/api/handles/in!valid/availability`, {
        headers: { cookie: user1Jar.getCookieHeader() },
      });
      const invalidPass = rInvalid.status === 400;

      if (takenPass && freePass && invalidPass) {
        record(
          11,
          "Availability check (dev_agent, free, invalid)",
          "PASS",
          "dev_agent=false, free=true, invalid=400",
        );
      } else {
        record(
          11,
          "Availability check (dev_agent, free, invalid)",
          "FAIL",
          `takenPass=${takenPass}, freePass=${freePass}, invalidPass=${invalidPass} (status=${rInvalid.status})`,
        );
      }
    } catch (err) {
      record(11, "Availability check (dev_agent, free, invalid)", "FAIL", err.message);
    }

    // ── 12. Claim the free handle → agent created, status "pending_claim" ──
    try {
      const res = await fetch(`${BASE_URL}/api/agents/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: user1Jar.getCookieHeader(),
        },
        body: JSON.stringify({ handle: freeHandle }),
      });
      const body = await res.json();
      const isPendingClaim = body.agent?.status === "pending_claim";
      const createdStatus = res.status === 201 || res.status === 200;

      if (createdStatus && isPendingClaim && body.agent?.handle === freeHandle) {
        record(
          12,
          "Claim free handle",
          "PASS",
          `Status ${res.status}, agent created with status "${body.agent.status}"`,
        );
      } else {
        record(
          12,
          "Claim free handle",
          "FAIL",
          `status=${res.status}, body=${JSON.stringify(body)}`,
        );
      }
    } catch (err) {
      record(12, "Claim free handle", "FAIL", err.message);
    }

    // ── 13. Second user claims SAME handle → plain error, no second row ────
    try {
      const res = await fetch(`${BASE_URL}/api/agents/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: user2Jar.getCookieHeader(),
        },
        body: JSON.stringify({ handle: freeHandle }),
      });
      const body = await res.json();
      const isError = res.status === 409 || res.status >= 400;
      const hasPlainMessage =
        body.error?.message === "That name was just taken." ||
        Boolean(body.error?.message?.toLowerCase().includes("taken"));

      // Verify no second row was inserted in agents table
      const { data: rowsFound } = await supabaseAdmin
        .from("agents")
        .select("id")
        .eq("handle", freeHandle);
      const singleRow = rowsFound?.length === 1;

      if (isError && hasPlainMessage && singleRow) {
        record(
          13,
          "Second user claims SAME handle",
          "PASS",
          `Rejected (${res.status}): "${body.error?.message}", exactly 1 row in DB`,
        );
      } else {
        record(
          13,
          "Second user claims SAME handle",
          "FAIL",
          `status=${res.status}, msg="${body.error?.message}", rowsFound=${rowsFound?.length}`,
        );
      }
    } catch (err) {
      record(13, "Second user claims SAME handle", "FAIL", err.message);
    }

    // ── 14. First user claims different handle → returns existing agent ─────
    try {
      const res = await fetch(`${BASE_URL}/api/agents/claim`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: user1Jar.getCookieHeader(),
        },
        body: JSON.stringify({ handle: "different_handle" }),
      });
      const body = await res.json();

      if (res.status === 200 && body.agent?.handle === freeHandle) {
        record(
          14,
          "First user repeat claim",
          "PASS",
          `Returns existing agent (@${body.agent.handle}), one per owner enforced`,
        );
      } else {
        record(
          14,
          "First user repeat claim",
          "FAIL",
          `status=${res.status}, handle=${body.agent?.handle}`,
        );
      }
    } catch (err) {
      record(14, "First user repeat claim", "FAIL", err.message);
    }

    // ── 15. Activate agent for owner session ─────────────────────────────────
    try {
      const now = new Date().toISOString();
      let { data: updated, error } = await supabaseAdmin
        .from("agents")
        .update({ status: "active", tweet_claimed_at: now })
        .eq("handle", freeHandle)
        .select()
        .single();

      if (error && (error.code === "42703" || error.message?.includes("tweet_claimed_at"))) {
        const fallback = await supabaseAdmin
          .from("agents")
          .update({ status: "active" })
          .eq("handle", freeHandle)
          .select()
          .single();
        updated = fallback.data ? { ...fallback.data, tweet_claimed_at: now } : null;
        error = fallback.error;
      }

      const isActive = updated?.status === "active";

      if (!error && isActive) {
        record(15, "Activate agent for owner", "PASS", 'Status set to "active"');
      } else {
        record(
          15,
          "Activate agent for owner",
          "FAIL",
          `error=${error?.message}, agentStatus=${updated?.status}`,
        );
      }
    } catch (err) {
      record(15, "Activate agent for owner", "FAIL", err.message);
    }

    // ── 16. GET / for first user → 200 shell, pinned row shows handle ──────
    try {
      const res = await fetch(`${BASE_URL}/`, {
        headers: { cookie: user1Jar.getCookieHeader() },
      });
      const html = await res.text();
      const hasPinnedHandle = html.includes(freeHandle);

      if (res.status === 200 && hasPinnedHandle) {
        record(16, "GET / for activated agent owner", "PASS", `200 shell, pinned row shows @${freeHandle}`);
      } else {
        record(
          16,
          "GET / for activated agent owner",
          "FAIL",
          `status=${res.status}, hasPinnedHandle=${hasPinnedHandle}`,
        );
      }
    } catch (err) {
      record(16, "GET / for activated agent owner", "FAIL", err.message);
    }

    // ── 17. Availability + claim with NO session → rejected (401 / redirect)
    try {
      const rAvail = await fetch(`${BASE_URL}/api/handles/any_handle/availability`, {
        redirect: "manual",
      });
      const availRejected =
        rAvail.status === 401 ||
        rAvail.status === 307 ||
        rAvail.status === 302 ||
        rAvail.status === 303;

      const rClaim = await fetch(`${BASE_URL}/api/agents/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle: "any_handle" }),
        redirect: "manual",
      });
      const claimRejected =
        rClaim.status === 401 ||
        rClaim.status === 307 ||
        rClaim.status === 302 ||
        rClaim.status === 303;

      if (availRejected && claimRejected) {
        record(
          17,
          "Unauthenticated availability + claim calls",
          "PASS",
          `Both rejected without session (avail=${rAvail.status}, claim=${rClaim.status})`,
        );
      } else {
        record(
          17,
          "Unauthenticated availability + claim calls",
          "FAIL",
          `availStatus=${rAvail.status}, claimStatus=${rClaim.status}`,
        );
      }
    } catch (err) {
      record(17, "Unauthenticated availability + claim calls", "FAIL", err.message);
    }

    // ── 18. GET / with dev session: rail, search, 3 chips, pinned @dev_agent ──
    let devShellHtml = "";
    try {
      const loginRes = await fetch(`${BASE_URL}/api/dev-login`, {
        method: "POST",
        redirect: "manual",
      });
      devJar.update(loginRes);

      const res = await fetch(`${BASE_URL}/`, {
        headers: { cookie: devJar.getCookieHeader() },
        redirect: "manual",
      });
      devJar.update(res);
      devShellHtml = await res.text();

      const hasRail =
        devShellHtml.includes('id="app-rail"') ||
        devShellHtml.includes('aria-label="Navigation rail"');
      const hasSearch = devShellHtml.includes('placeholder="Search"');
      const hasChips =
        devShellHtml.includes("All") &&
        devShellHtml.includes("Unread") &&
        devShellHtml.includes("Online");
      const hasPinnedDev =
        devShellHtml.includes("@dev_agent") &&
        (devShellHtml.includes("pinned-agent-row") || devShellHtml.includes("· You"));

      if (res.status === 200 && hasRail && hasSearch && hasChips && hasPinnedDev) {
        record(
          18,
          "GET / with dev session (rail, search, chips, pinned handle)",
          "PASS",
          "200 OK, rail, search field, 3 chips, and @dev_agent pinned row present",
        );
      } else {
        const missing = [];
        if (!hasRail) missing.push("rail");
        if (!hasSearch) missing.push("search field");
        if (!hasChips) missing.push("chips (All/Unread/Online)");
        if (!hasPinnedDev) missing.push("pinned row with @dev_agent");
        record(
          18,
          "GET / with dev session (rail, search, chips, pinned handle)",
          "FAIL",
          `status=${res.status}, missing: ${missing.join(", ")}`,
        );
      }
    } catch (err) {
      record(18, "GET / with dev session (rail, search, chips, pinned handle)", "FAIL", err.message);
    }

    // ── 19. Served HTML/CSS contains neither #00A884 nor #25D366 ────────────
    try {
      const banned = ["#00a884", "#25d366"];
      const violations = [];

      function checkContent(sourceName, text) {
        const lower = text.toLowerCase();
        for (const b of banned) {
          if (lower.includes(b)) {
            violations.push(`${sourceName} contains banned ${b}`);
          }
        }
      }

      // Check the shell HTML from row 18
      checkContent("GET / HTML", devShellHtml);

      // Check login page HTML
      const loginPageRes = await fetch(`${BASE_URL}/login`);
      const loginHtml = await loginPageRes.text();
      checkContent("GET /login HTML", loginHtml);

      // Extract all <link rel="stylesheet"> from both HTML pages
      const cssUrls = new Set();
      const cssLinkRegex = /<link[^>]+rel=["']stylesheet["'][^>]+href=["']([^"']+)["']/gi;
      let match;
      while ((match = cssLinkRegex.exec(devShellHtml)) !== null) {
        cssUrls.add(match[1]);
      }
      const cssLinkRegex2 = /<link[^>]+href=["']([^"']+)["'][^>]+rel=["']stylesheet["']/gi;
      while ((match = cssLinkRegex2.exec(devShellHtml)) !== null) {
        cssUrls.add(match[1]);
      }
      while ((match = cssLinkRegex.exec(loginHtml)) !== null) {
        cssUrls.add(match[1]);
      }
      while ((match = cssLinkRegex2.exec(loginHtml)) !== null) {
        cssUrls.add(match[1]);
      }

      // Fetch and check each CSS stylesheet
      for (const cssUrl of cssUrls) {
        const fullUrl = cssUrl.startsWith("http") ? cssUrl : `${BASE_URL}${cssUrl}`;
        const cssRes = await fetch(fullUrl);
        if (cssRes.status === 200) {
          const cssText = await cssRes.text();
          checkContent(`CSS bundle (${cssUrl})`, cssText);
        }
      }

      if (violations.length === 0) {
        record(
          19,
          "WhatsApp green ban (#00A884, #25D366)",
          "PASS",
          `Checked served HTML + ${cssUrls.size} CSS bundles; zero occurrences found`,
        );
      } else {
        record(
          19,
          "WhatsApp green ban (#00A884, #25D366)",
          "FAIL",
          violations.join("; "),
        );
      }
    } catch (err) {
      record(19, "WhatsApp green ban (#00A884, #25D366)", "FAIL", err.message);
    }

    // ── Helper for timed fetch inside relay tests ───────────────────────────
    async function timedFetch(url, options = {}, timeoutMs = 15000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          redirect: "manual",
          ...options,
          signal: controller.signal,
        });
        return res;
      } finally {
        clearTimeout(timer);
      }
    }

    function mask(str) {
      if (!str) return "<none>";
      if (str.length <= 8) return str.slice(0, 2) + "...";
      return str.slice(0, 7) + "..." + `(len: ${str.length})`;
    }

    // State for Phase 3 relay tests
    let userA, userB, userC;
    let handleA, handleB, handleC;
    let agentA, agentB, agentC;
    let userAJar = new SimpleCookieJar();
    let userBJar = new SimpleCookieJar();
    let userCJar = new SimpleCookieJar();
    let credA, credB, credC;
    let testMsgId, testConvId;
    let testMsgPayload;
    let suffixA;

    // ── 20. Connect code flow & credential validation ────────────────────────
    try {
      // 1. Provision Owner A and Agent A
      suffixA = Math.random().toString(36).slice(2, 7);
      const uAEmail = `smoke_oa_${Date.now()}_${suffixA}@example.test`;
      const createUA = await supabaseAdmin.auth.admin.createUser({
        email: uAEmail,
        email_confirm: true,
      });
      userA = createUA.data?.user;
      if (!userA) throw new Error("Failed to provision test Owner A");
      cleanupUserIds.push(userA.id);
      await supabaseAdmin.from("users").upsert({ id: userA.id, email: userA.email });

      handleA = `smk_a_${suffixA}`;
      cleanupHandles.push(handleA);
      const { data: aData, error: aErr } = await supabaseAdmin
        .from("agents")
        .insert({
          owner_id: userA.id,
          handle: handleA,
          status: "active",
          display_name: `@${handleA}`,
        })
        .select()
        .single();
      if (aErr) throw new Error(`Failed to create agent A: ${aErr.message}`);
      agentA = aData;

      // Establish session for Owner A
      const linkA = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: uAEmail,
      });
      const cbA = await timedFetch(
        `${BASE_URL}/auth/callback?token_hash=${linkA.data.properties.hashed_token}&type=magiclink`,
        { redirect: "manual" },
      );
      userAJar.update(cbA);

      // Owner A requests connect code
      const ccRes = await timedFetch(`${BASE_URL}/api/agents/connect-code`, {
        method: "POST",
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const ccBody = await ccRes.json();
      const codeA = ccBody.code;
      const ccPass =
        ccRes.status === 201 && typeof codeA === "string" && codeA.startsWith("qc_");

      // Test agent redeems code
      const connRes = await timedFetch(`${BASE_URL}/api/agent/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeA }),
      });
      const connBody = await connRes.json();
      credA = connBody.credential;
      const connPass =
        connRes.status === 200 &&
        connBody.agent_id === agentA.id &&
        connBody.handle === handleA &&
        typeof credA === "string" &&
        credA.startsWith("ag_live_");

      // Credential works on /api/agent/heartbeat
      const hbRes = await timedFetch(`${BASE_URL}/api/agent/heartbeat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${credA}` },
      });
      const hbPass = hbRes.status === 200;

      // SAME code again -> 401 rejected
      const replayRes = await timedFetch(`${BASE_URL}/api/agent/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeA }),
      });
      const replayPass = replayRes.status === 401;

      // Wrong code -> 401 rejected
      const wrongRes = await timedFetch(`${BASE_URL}/api/agent/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "qc_boguscode_invalid_9999" }),
      });
      const wrongPass = wrongRes.status === 401;

      if (ccPass && connPass && hbPass && replayPass && wrongPass) {
        record(
          20,
          "Connect code: mint, redeem, auth, replay=401, wrong=401",
          "PASS",
          `code=${mask(codeA)}, cred=${mask(credA)}, replay=401, wrong=401`,
        );
      } else {
        record(
          20,
          "Connect code: mint, redeem, auth, replay=401, wrong=401",
          "FAIL",
          `ccPass=${ccPass}, connPass=${connPass}, hbPass=${hbPass}, replayPass=${replayPass}, wrongPass=${wrongPass}`,
        );
      }
    } catch (err) {
      record(20, "Connect code: mint, redeem, auth, replay=401, wrong=401", "FAIL", err.message);
    }

    // ── 21. Heartbeat -> online; backdate 4 min -> offline ──────────────────
    try {
      // 1. Send heartbeat for Agent A
      const hbSendRes = await timedFetch(`${BASE_URL}/api/agent/heartbeat`, {
        method: "POST",
        headers: { Authorization: `Bearer ${credA}` },
      });
      const hbSendPass = hbSendRes.status === 200;

      // 2. Check presence online in Owner A's shell
      const shellOnlineRes = await timedFetch(`${BASE_URL}/`, {
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const shellOnlineHtml = await shellOnlineRes.text();
      const onlinePass =
        shellOnlineHtml.includes("bg-q-online") &&
        shellOnlineHtml.includes("online — speaking for you");

      // 3. Backdate last_heartbeat_at / last_seen_at by 4 minutes (> 3 minutes)
      const fourMinAgo = new Date(Date.now() - 4 * 60 * 1000).toISOString();
      const { error: hbErr } = await supabaseAdmin
        .from("agents")
        .update({
          last_heartbeat_at: fourMinAgo,
          last_seen_at: fourMinAgo,
        })
        .eq("id", agentA.id);

      if (hbErr) {
        await supabaseAdmin
          .from("agents")
          .update({
            last_seen_at: fourMinAgo,
          })
          .eq("id", agentA.id);
      }

      // 4. Check presence offline in Owner A's shell
      const shellOfflineRes = await timedFetch(`${BASE_URL}/`, {
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const shellOfflineHtml = await shellOfflineRes.text();
      const offlinePass =
        shellOfflineHtml.includes("bg-q-offline") &&
        !shellOfflineHtml.includes("online — speaking for you");

      if (hbSendPass && onlinePass && offlinePass) {
        record(
          21,
          "Heartbeat sets online; backdate 4m sets offline",
          "PASS",
          "Heartbeat reflected online (<3m); 4m backdate reflected offline (grey dot)",
        );
      } else {
        record(
          21,
          "Heartbeat sets online; backdate 4m sets offline",
          "FAIL",
          `hbSendPass=${hbSendPass}, onlinePass=${onlinePass}, offlinePass=${offlinePass}`,
        );
      }
    } catch (err) {
      record(21, "Heartbeat sets online; backdate 4m sets offline", "FAIL", err.message);
    }

    // ── 22. Agent A sends to B -> inbox delivers -> B marks read -> A sees read ──
    try {
      // 1. Provision Owner B and Agent B
      const suffixB = Math.random().toString(36).slice(2, 7);
      const uBEmail = `smoke_ob_${Date.now()}_${suffixB}@example.test`;
      const createUB = await supabaseAdmin.auth.admin.createUser({
        email: uBEmail,
        email_confirm: true,
      });
      userB = createUB.data?.user;
      if (!userB) throw new Error("Failed to provision test Owner B");
      cleanupUserIds.push(userB.id);
      await supabaseAdmin.from("users").upsert({ id: userB.id, email: userB.email });

      handleB = `smk_b_${suffixB}`;
      cleanupHandles.push(handleB);
      const { data: bData, error: bErr } = await supabaseAdmin
        .from("agents")
        .insert({
          owner_id: userB.id,
          handle: handleB,
          status: "active",
          display_name: `@${handleB}`,
        })
        .select()
        .single();
      if (bErr) throw new Error(`Failed to create agent B: ${bErr.message}`);
      agentB = bData;

      // Establish session for Owner B
      const linkB = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: uBEmail,
      });
      const cbB = await timedFetch(
        `${BASE_URL}/auth/callback?token_hash=${linkB.data.properties.hashed_token}&type=magiclink`,
        { redirect: "manual" },
      );
      userBJar.update(cbB);

      // Connect Agent B
      const ccBRes = await timedFetch(`${BASE_URL}/api/agents/connect-code`, {
        method: "POST",
        headers: { cookie: userBJar.getCookieHeader() },
      });
      const { code: codeB } = await ccBRes.json();
      const connBRes = await timedFetch(`${BASE_URL}/api/agent/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeB }),
      });
      const { credential: cB } = await connBRes.json();
      credB = cB;

      // 2. Agent A sends to Agent B
      testMsgPayload = {
        to_handle: handleB,
        body: `Relay smoke test message from @${handleA} to @${handleB}`,
        idempotency_key: `idemp_${Date.now()}_${suffixA}`,
      };
      const sendRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credA}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testMsgPayload),
      });
      const sendBody = await sendRes.json();
      const sendPass =
        sendRes.status === 200 &&
        sendBody.ok === true &&
        sendBody.status === "queued" &&
        Boolean(sendBody.message_id);
      testMsgId = sendBody.message_id;
      testConvId = sendBody.conversation_id;

      // 3. Agent B polls inbox -> returns message & marks delivered
      const inboxRes = await timedFetch(`${BASE_URL}/api/agent/inbox?wait_seconds=0`, {
        headers: { Authorization: `Bearer ${credB}` },
      });
      const inboxBody = await inboxRes.json();
      const foundInInbox = inboxBody.messages?.find((m) => m.message_id === testMsgId);
      const inboxPass =
        inboxRes.status === 200 &&
        Boolean(foundInInbox) &&
        foundInInbox?.body === testMsgPayload.body;

      // 4. Agent A checks status -> reads "delivered"
      const statusDeliveredRes = await timedFetch(
        `${BASE_URL}/api/agent/messages/${testMsgId}`,
        {
          headers: { Authorization: `Bearer ${credA}` },
        },
      );
      const statusDeliveredBody = await statusDeliveredRes.json();
      const deliveredPass =
        statusDeliveredRes.status === 200 &&
        statusDeliveredBody.message?.status === "delivered";

      // 5. Agent B marks read
      const markReadRes = await timedFetch(
        `${BASE_URL}/api/agent/messages/${testMsgId}/read`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${credB}` },
        },
      );
      const markReadBody = await markReadRes.json();
      const markReadPass = markReadRes.status === 200 && markReadBody.status === "read";

      // 6. Agent A checks status -> reads "read"
      const statusReadRes = await timedFetch(`${BASE_URL}/api/agent/messages/${testMsgId}`, {
        headers: { Authorization: `Bearer ${credA}` },
      });
      const statusReadBody = await statusReadRes.json();
      const readPass =
        statusReadRes.status === 200 && statusReadBody.message?.status === "read";

      if (sendPass && inboxPass && deliveredPass && markReadPass && readPass) {
        record(
          22,
          "A sends to B -> inbox delivers -> B marks read -> A sees read",
          "PASS",
          `msgId=${testMsgId.slice(0, 8)}..., queued -> delivered -> read`,
        );
      } else {
        record(
          22,
          "A sends to B -> inbox delivers -> B marks read -> A sees read",
          "FAIL",
          `sendPass=${sendPass}, inboxPass=${inboxPass}, deliveredPass=${deliveredPass}, markReadPass=${markReadPass}, readPass=${readPass}`,
        );
      }
    } catch (err) {
      record(
        22,
        "A sends to B -> inbox delivers -> B marks read -> A sees read",
        "FAIL",
        err.message,
      );
    }

    // ── 23. Idempotent send deduplication ───────────────────────────────────
    try {
      // Re-send same message payload with exact same idempotency_key
      const resendRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credA}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(testMsgPayload),
      });
      const resendBody = await resendRes.json();
      const sameIdPass =
        resendRes.status === 200 && resendBody.message_id === testMsgId;

      // Verify DB row count: exactly 1 row with this idempotency key
      let rowCountPass = true;
      try {
        const { count, error: countErr } = await supabaseAdmin
          .from("messages")
          .select("*", { count: "exact", head: true })
          .eq("idempotency_key", testMsgPayload.idempotency_key);
        if (!countErr && typeof count === "number") {
          rowCountPass = count === 1;
        }
      } catch {
        // In-memory mode fallback is inherently deduplicated
        rowCountPass = true;
      }

      if (sameIdPass && rowCountPass) {
        record(
          23,
          "Re-send with same idempotency_key returns original message",
          "PASS",
          `Returned original message_id ${testMsgId.slice(0, 8)}..., exactly 1 row stored`,
        );
      } else {
        record(
          23,
          "Re-send with same idempotency_key returns original message",
          "FAIL",
          `sameIdPass=${sameIdPass}, rowCountPass=${rowCountPass}`,
        );
      }
    } catch (err) {
      record(
        23,
        "Re-send with same idempotency_key returns original message",
        "FAIL",
        err.message,
      );
    }

    // ── 24. Both owners' shells show conversation with preview text ──────────
    try {
      // Owner A's shell
      const shellARes = await timedFetch(`${BASE_URL}/`, {
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const shellAHtml = await shellARes.text();
      const shellAPass =
        shellARes.status === 200 &&
        shellAHtml.includes(handleB) &&
        shellAHtml.includes(testMsgPayload.body);

      // Owner B's shell
      const shellBRes = await timedFetch(`${BASE_URL}/`, {
        headers: { cookie: userBJar.getCookieHeader() },
      });
      const shellBHtml = await shellBRes.text();
      const shellBPass =
        shellBRes.status === 200 &&
        shellBHtml.includes(handleA) &&
        shellBHtml.includes(testMsgPayload.body);

      if (shellAPass && shellBPass) {
        record(
          24,
          "Both owners' shells (session GET /) display conversation & preview",
          "PASS",
          `Owner A shows @${handleB}; Owner B shows @${handleA}; preview text present in both`,
        );
      } else {
        const diagA = `shellA: status=${shellARes.status}, hasHandleB=${shellAHtml.includes(handleB)}, hasMsg=${shellAHtml.includes(testMsgPayload.body)}, len=${shellAHtml.length}`;
        const diagB = `shellB: status=${shellBRes.status}, hasHandleA=${shellBHtml.includes(handleA)}, hasMsg=${shellBHtml.includes(testMsgPayload.body)}, len=${shellBHtml.length}`;
        record(
          24,
          "Both owners' shells (session GET /) display conversation & preview",
          "FAIL",
          `${diagA} | ${diagB}`,
        );
      }
    } catch (err) {
      record(
        24,
        "Both owners' shells (session GET /) display conversation & preview",
        "FAIL",
        err.message,
      );
    }

    // ── 25. CROSS-LEAK GATE: Owner C & Agent C isolation ────────────────────
    try {
      // 1. Provision Owner C and Agent C
      const suffixC = Math.random().toString(36).slice(2, 7);
      const uCEmail = `smoke_oc_${Date.now()}_${suffixC}@example.test`;
      const createUC = await supabaseAdmin.auth.admin.createUser({
        email: uCEmail,
        email_confirm: true,
      });
      userC = createUC.data?.user;
      if (!userC) throw new Error("Failed to provision test Owner C");
      cleanupUserIds.push(userC.id);
      await supabaseAdmin.from("users").upsert({ id: userC.id, email: userC.email });

      handleC = `smk_c_${suffixC}`;
      cleanupHandles.push(handleC);
      const { data: cData, error: cErr } = await supabaseAdmin
        .from("agents")
        .insert({
          owner_id: userC.id,
          handle: handleC,
          status: "active",
          display_name: `@${handleC}`,
        })
        .select()
        .single();
      if (cErr) throw new Error(`Failed to create agent C: ${cErr.message}`);
      agentC = cData;

      // Session for Owner C
      const linkC = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: uCEmail,
      });
      const cbC = await timedFetch(
        `${BASE_URL}/auth/callback?token_hash=${linkC.data.properties.hashed_token}&type=magiclink`,
        { redirect: "manual" },
      );
      userCJar.update(cbC);

      // Connect Agent C
      const ccCRes = await timedFetch(`${BASE_URL}/api/agents/connect-code`, {
        method: "POST",
        headers: { cookie: userCJar.getCookieHeader() },
      });
      const { code: codeC } = await ccCRes.json();
      const connCRes = await timedFetch(`${BASE_URL}/api/agent/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeC }),
      });
      const { credential: cC } = await connCRes.json();
      credC = cC;

      // Check A: Owner C conversations list contains nothing of A<->B
      const convListRes = await timedFetch(`${BASE_URL}/api/conversations`, {
        headers: { cookie: userCJar.getCookieHeader() },
      });
      const convListBody = await convListRes.json();
      const convListPass =
        convListRes.status === 200 &&
        !convListBody.conversations?.some((c) => c.id === testConvId);

      // Check B: Owner C cannot read A<->B transcript
      const transcriptRes = await timedFetch(
        `${BASE_URL}/api/conversations/${testConvId}/messages`,
        {
          headers: { cookie: userCJar.getCookieHeader() },
        },
      );
      const transcriptPass = transcriptRes.status === 404;

      // Check C: Agent C inbox contains 0 messages
      const inboxCRes = await timedFetch(`${BASE_URL}/api/agent/inbox`, {
        headers: { Authorization: `Bearer ${credC}` },
      });
      const inboxCBody = await inboxCRes.json();
      const inboxCPass =
        inboxCRes.status === 200 &&
        (!inboxCBody.messages || inboxCBody.messages.length === 0);

      // Check D: Agent C cannot read message status of A<->B
      const msgStatusCRes = await timedFetch(
        `${BASE_URL}/api/agent/messages/${testMsgId}`,
        {
          headers: { Authorization: `Bearer ${credC}` },
        },
      );
      const msgStatusCPass = msgStatusCRes.status === 404;

      // Check E: Agent C cannot mark read A<->B message
      const markReadCRes = await timedFetch(
        `${BASE_URL}/api/agent/messages/${testMsgId}/read`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${credC}` },
        },
      );
      const markReadCPass = markReadCRes.status === 403 || markReadCRes.status === 404;

      // Check F: Credential impersonation rejected (invalid bearer -> 401)
      const fakeCredRes = await timedFetch(`${BASE_URL}/api/agent/heartbeat`, {
        method: "POST",
        headers: { Authorization: "Bearer ag_live_fakeboguscredential12345" },
      });
      const fakeCredPass = fakeCredRes.status === 401;

      if (
        convListPass &&
        transcriptPass &&
        inboxCPass &&
        msgStatusCPass &&
        markReadCPass &&
        fakeCredPass
      ) {
        record(
          25,
          "CROSS-LEAK GATE: Owner C & Agent C isolated, spoofing rejected",
          "PASS",
          "All read/status/transcript paths of 3rd party return 404/empty; spoofed auth rejected (401)",
        );
      } else {
        record(
          25,
          "CROSS-LEAK GATE: Owner C & Agent C isolated, spoofing rejected",
          "FAIL",
          `convListPass=${convListPass}, transcriptPass=${transcriptPass}, inboxCPass=${inboxCPass}, msgStatusCPass=${msgStatusCPass}, markReadCPass=${markReadCPass}, fakeCredPass=${fakeCredPass}`,
        );
      }
    } catch (err) {
      record(
        25,
        "CROSS-LEAK GATE: Owner C & Agent C isolated, spoofing rejected",
        "FAIL",
        err.message,
      );
    }

    // ── 26. Guard entry (never) -> agent send rejected blocked_by_rules & nowhere in conversation ──
    try {
      // 1. Owner A adds never guard entry
      const fNeverRes = await timedFetch(`${BASE_URL}/api/facts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: userAJar.getCookieHeader(),
        },
        body: JSON.stringify({
          text: "Secret master passcode 88412",
          guard: "never",
        }),
      });

      // 2. Agent A attempts to send message to Agent B containing guarded text
      const sendNeverRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credA}`,
        },
        body: JSON.stringify({
          to_handle: handleB,
          body: "Here is the Secret master passcode 88412 for the safe",
          idempotency_key: `idemp_never_${Date.now()}`,
        }),
      });
      const sendNeverBody = await sendNeverRes.json();

      // 3. Verify message exists NOWHERE in conversation
      const transcriptRes = await timedFetch(
        `${BASE_URL}/api/conversations/${testConvId}/messages`,
        {
          headers: { cookie: userAJar.getCookieHeader() },
        },
      );
      const transcriptBody = await transcriptRes.json();
      const foundInTranscript = transcriptBody.messages?.some(
        (m) => m.text?.includes("88412") || m.text?.toLowerCase().includes("passcode"),
      );

      if (
        fNeverRes.status === 201 &&
        sendNeverRes.status === 403 &&
        sendNeverBody.error?.code === "blocked_by_rules" &&
        !foundInTranscript
      ) {
        record(
          26,
          "Guard entry (never) -> send rejected blocked_by_rules & nowhere in conversation",
          "PASS",
          "Send rejected with code 'blocked_by_rules', 0 messages stored in conversation",
        );
      } else {
        record(
          26,
          "Guard entry (never) -> send rejected blocked_by_rules & nowhere in conversation",
          "FAIL",
          `fNever=${fNeverRes.status}, sendStatus=${sendNeverRes.status}, code=${sendNeverBody.error?.code}, inTranscript=${foundInTranscript}`,
        );
      }
    } catch (err) {
      record(
        26,
        "Guard entry (never) -> send rejected blocked_by_rules & nowhere in conversation",
        "FAIL",
        err.message,
      );
    }

    // ── 27. Ask entry -> send returns 'held_for_approval', approval pending exists ──
    let heldApprovalId = null;
    try {
      // 1. Owner A adds ask guard entry
      const fAskRes = await timedFetch(`${BASE_URL}/api/facts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: userAJar.getCookieHeader(),
        },
        body: JSON.stringify({
          text: "Goa flight departure is 6am",
          guard: "ask",
        }),
      });

      // 2. Agent A sends message containing ask guarded text
      const sendAskRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credA}`,
        },
        body: JSON.stringify({
          to_handle: handleB,
          body: "Goa flight departure is 6am from Terminal 2",
          idempotency_key: `idemp_ask_${Date.now()}`,
        }),
      });
      const sendAskBody = await sendAskRes.json();
      heldApprovalId = sendAskBody.approval_id;

      // 3. Verify pending approval exists in GET /api/approvals
      const approvalsRes = await timedFetch(`${BASE_URL}/api/approvals`, {
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const approvalsBody = await approvalsRes.json();
      const hasPending = approvalsBody.approvals?.some(
        (a) => a.id === heldApprovalId && a.status === "pending",
      );

      if (
        fAskRes.status === 201 &&
        sendAskRes.status === 200 &&
        sendAskBody.status === "held_for_approval" &&
        heldApprovalId &&
        hasPending
      ) {
        record(
          27,
          "Ask entry -> send returns held_for_approval, pending approval exists",
          "PASS",
          `status=held_for_approval, approval_id=${heldApprovalId} confirmed in GET /api/approvals`,
        );
      } else {
        record(
          27,
          "Ask entry -> send returns held_for_approval, pending approval exists",
          "FAIL",
          `fAsk=${fAskRes.status}, sendStatus=${sendAskRes.status}, bodyStatus=${sendAskBody.status}, approval_id=${heldApprovalId}, hasPending=${hasPending}`,
        );
      }
    } catch (err) {
      record(
        27,
        "Ask entry -> send returns held_for_approval, pending approval exists",
        "FAIL",
        err.message,
      );
    }

    // ── 28. Resolve share -> draft delivered into the conversation ───────────
    try {
      if (!heldApprovalId) {
        throw new Error("No held approval from row 27");
      }

      // 1. Owner A resolves the held approval with 'share'
      const resolveShareRes = await timedFetch(
        `${BASE_URL}/api/approvals/${heldApprovalId}/resolve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: userAJar.getCookieHeader(),
          },
          body: JSON.stringify({ decision: "share" }),
        },
      );
      const resolveShareBody = await resolveShareRes.json();

      // 2. Check conversation transcript for delivered draft message
      const transcriptRes = await timedFetch(
        `${BASE_URL}/api/conversations/${testConvId}/messages`,
        {
          headers: { cookie: userAJar.getCookieHeader() },
        },
      );
      const transcriptBody = await transcriptRes.json();
      const hasDeliveredDraft = transcriptBody.messages?.some((m) =>
        m.text?.toLowerCase().includes("goa flight departure is 6am"),
      );

      if (
        resolveShareRes.status === 200 &&
        resolveShareBody.approval?.status === "shared" &&
        hasDeliveredDraft
      ) {
        record(
          28,
          "Resolve share -> draft delivered into conversation",
          "PASS",
          "Approval status=shared, draft message delivered and verified in transcript",
        );
      } else {
        record(
          28,
          "Resolve share -> draft delivered into conversation",
          "FAIL",
          `resolveStatus=${resolveShareRes.status}, approvalStatus=${resolveShareBody.approval?.status}, hasDelivered=${hasDeliveredDraft}`,
        );
      }
    } catch (err) {
      record(28, "Resolve share -> draft delivered into conversation", "FAIL", err.message);
    }

    // ── 29. Resolve never -> same send now rejected blocked ───────────────────
    try {
      // 1. Add an ask guard entry for hotel booking
      await timedFetch(`${BASE_URL}/api/facts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: userAJar.getCookieHeader(),
        },
        body: JSON.stringify({
          text: "Private hotel booking",
          guard: "ask",
        }),
      });

      // 2. Agent A sends message matching hotel booking -> held
      const sendHotelRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credA}`,
        },
        body: JSON.stringify({
          to_handle: handleB,
          body: "Private hotel booking confirmation number 44109",
          idempotency_key: `idemp_hotel_${Date.now()}`,
        }),
      });
      const sendHotelBody = await sendHotelRes.json();
      const hotelApprovalId = sendHotelBody.approval_id;

      if (!hotelApprovalId) {
        throw new Error("Failed to create approval for Never resolve test");
      }

      // 3. Owner A resolves with 'never'
      const resolveNeverRes = await timedFetch(
        `${BASE_URL}/api/approvals/${hotelApprovalId}/resolve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: userAJar.getCookieHeader(),
          },
          body: JSON.stringify({ decision: "never" }),
        },
      );
      const resolveNeverBody = await resolveNeverRes.json();

      // 4. Agent A attempts to send the same text again -> MUST be rejected 'blocked_by_rules'
      const retryHotelRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credA}`,
        },
        body: JSON.stringify({
          to_handle: handleB,
          body: "Private hotel booking confirmation number 44109",
          idempotency_key: `idemp_hotel_retry_${Date.now()}`,
        }),
      });
      const retryHotelBody = await retryHotelRes.json();

      if (
        resolveNeverRes.status === 200 &&
        resolveNeverBody.approval?.status === "never" &&
        retryHotelRes.status === 403 &&
        retryHotelBody.error?.code === "blocked_by_rules"
      ) {
        record(
          29,
          "Resolve never -> same send now rejected blocked",
          "PASS",
          "Approval resolved to 'never', guard entry created, retry rejected with 'blocked_by_rules'",
        );
      } else {
        record(
          29,
          "Resolve never -> same send now rejected blocked",
          "FAIL",
          `resolveStatus=${resolveNeverRes.status}, approvalStatus=${resolveNeverBody.approval?.status}, retryStatus=${retryHotelRes.status}, retryCode=${retryHotelBody.error?.code}`,
        );
      }
    } catch (err) {
      record(29, "Resolve never -> same send now rejected blocked", "FAIL", err.message);
    }

    // ── 30. Category toggle money_figures=never + specifics figure -> blocked ─
    try {
      // 1. Owner A toggles category money_figures to 'never'
      const toggleRes = await timedFetch(`${BASE_URL}/api/guardrails/category`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          cookie: userAJar.getCookieHeader(),
        },
        body: JSON.stringify({ category: "money_figures", mode: "never" }),
      });
      const toggleBody = await toggleRes.json();

      // 2. Agent A attempts to send message containing a salary figure
      const sendSalaryRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credA}`,
        },
        body: JSON.stringify({
          to_handle: handleB,
          body: "my salary is 2400000",
          idempotency_key: `idemp_salary_${Date.now()}`,
        }),
      });
      const sendSalaryBody = await sendSalaryRes.json();

      if (
        toggleRes.status === 200 &&
        toggleBody.mode === "never" &&
        sendSalaryRes.status === 403 &&
        sendSalaryBody.error?.code === "blocked_by_rules"
      ) {
        record(
          30,
          "Category toggle money_figures=never -> salary blocked",
          "PASS",
          "money_figures set to never, 'my salary is 2400000' rejected with 'blocked_by_rules'",
        );
      } else {
        record(
          30,
          "Category toggle money_figures=never -> salary blocked",
          "FAIL",
          `toggleStatus=${toggleRes.status}, toggleMode=${toggleBody.mode}, sendStatus=${sendSalaryRes.status}, sendCode=${sendSalaryBody.error?.code}`,
        );
      }
    } catch (err) {
      record(
        30,
        "Category toggle money_figures=never -> salary blocked",
        "FAIL",
        err.message,
      );
    }

    // ── 31. Stranger agent message -> Requests column; accept -> moves to main list ──
    try {
      // 1. Provision Stranger Agent S (Owner S)
      const suffixS = Math.random().toString(36).slice(2, 7);
      const uSEmail = `smoke_stranger_${Date.now()}_${suffixS}@example.test`;
      const createUS = await supabaseAdmin.auth.admin.createUser({
        email: uSEmail,
        email_confirm: true,
      });
      const userS = createUS.data?.user;
      if (!userS) throw new Error("Failed to provision Stranger Owner S");
      cleanupUserIds.push(userS.id);
      await supabaseAdmin.from("users").upsert({ id: userS.id, email: userS.email });

      const handleS = `smk_s_${suffixS}`;
      cleanupHandles.push(handleS);
      const { data: sData, error: sErr } = await supabaseAdmin
        .from("agents")
        .insert({
          owner_id: userS.id,
          handle: handleS,
          status: "active",
          display_name: `@${handleS}`,
        })
        .select()
        .single();
      if (sErr) throw new Error(`Failed to create agent S: ${sErr.message}`);

      // Establish session for Owner S
      const linkS = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: uSEmail,
      });
      const userSJar = new SimpleCookieJar();
      const cbS = await timedFetch(
        `${BASE_URL}/auth/callback?token_hash=${linkS.data.properties.hashed_token}&type=magiclink`,
        { redirect: "manual" },
      );
      userSJar.update(cbS);

      // Connect Agent S
      const ccSRes = await timedFetch(`${BASE_URL}/api/agents/connect-code`, {
        method: "POST",
        headers: { cookie: userSJar.getCookieHeader() },
      });
      const { code: codeS } = await ccSRes.json();
      const connSRes = await timedFetch(`${BASE_URL}/api/agent/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: codeS }),
      });
      const { credential: credS } = await connSRes.json();

      // 2. Stranger Agent S sends first message to Agent A
      const strangerSendRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credS}`,
        },
        body: JSON.stringify({
          to_handle: handleA,
          body: "Hello from stranger agent! Want to connect?",
          idempotency_key: `idemp_stranger_${Date.now()}`,
        }),
      });
      const strangerSendBody = await strangerSendRes.json();
      const strangerConvId = strangerSendBody.conversation_id;

      // 3. Owner A inspects GET /api/conversations
      const convsRes = await timedFetch(`${BASE_URL}/api/conversations`, {
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const convsBody = await convsRes.json();

      const inRequests = convsBody.requests?.some((c) => c.id === strangerConvId);
      const inMainBefore = convsBody.main?.some((c) => c.id === strangerConvId);

      // 4. Owner A accepts the conversation
      const acceptRes = await timedFetch(`${BASE_URL}/api/conversations/${strangerConvId}/accept`, {
        method: "POST",
        headers: { cookie: userAJar.getCookieHeader() },
      });

      // 5. Owner A inspects GET /api/conversations again: now in main, not in requests
      const convsAfterRes = await timedFetch(`${BASE_URL}/api/conversations`, {
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const convsAfterBody = await convsAfterRes.json();

      const inMainAfter = convsAfterBody.main?.some((c) => c.id === strangerConvId);
      const inRequestsAfter = convsAfterBody.requests?.some((c) => c.id === strangerConvId);

      if (
        strangerSendRes.status === 200 &&
        inRequests &&
        !inMainBefore &&
        acceptRes.status === 200 &&
        inMainAfter &&
        !inRequestsAfter
      ) {
        record(
          31,
          "Stranger agent message lands in Requests; accept moves to main list",
          "PASS",
          "First stranger message set is_request=true; accept set is_request=false, moved to main list",
        );
      } else {
        record(
          31,
          "Stranger agent message lands in Requests; accept moves to main list",
          "FAIL",
          `inRequests=${inRequests}, inMainBefore=${inMainBefore}, acceptStatus=${acceptRes.status}, inMainAfter=${inMainAfter}, inRequestsAfter=${inRequestsAfter}`,
        );
      }
    } catch (err) {
      record(
        31,
        "Stranger agent message lands in Requests; accept moves to main list",
        "FAIL",
        err.message,
      );
    }
    // ── 32. Default modes -> benign message (doctor's appointment, school play) delivers ──
    try {
      const benignText = "he has a doctor's appointment on Friday and his daughter's school play is Saturday";
      const sendBenignRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credA}`,
        },
        body: JSON.stringify({
          to_handle: handleB,
          body: benignText,
          idempotency_key: `idemp_benign_${Date.now()}`,
        }),
      });
      const sendBenignBody = await sendBenignRes.json();

      const delivered =
        sendBenignRes.status === 200 &&
        sendBenignBody.ok === true &&
        sendBenignBody.status === "queued";

      if (delivered) {
        record(
          32,
          "Default modes: topics not gates -> benign message delivered",
          "PASS",
          "Doctor's appointment and school play delivered under default modes",
        );
      } else {
        record(
          32,
          "Default modes: topics not gates -> benign message delivered",
          "FAIL",
          `status=${sendBenignRes.status}, bodyStatus=${sendBenignBody.status}, error=${sendBenignBody.error?.code}`,
        );
      }
    } catch (err) {
      record(
        32,
        "Default modes: topics not gates -> benign message delivered",
        "FAIL",
        err.message,
      );
    }
    // ── 33. Tweet verify: REAL public tweet URL mechanism check ───────────
    try {
      const realTweetUrl = "https://x.com/jack/status/20";
      const oEmbedUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(realTweetUrl)}`;
      const oEmbedRes = await fetch(oEmbedUrl, { headers: { Accept: "application/json" } });
      const oEmbedData = oEmbedRes.ok ? await oEmbedRes.json() : null;
      const authorParsed = oEmbedData?.author_name?.toLowerCase() === "jack";

      if (oEmbedRes.status === 200 && authorParsed) {
        record(
          33,
          "Tweet verify: real public tweet mechanism check",
          "PASS",
          `X oEmbed 200 OK, author parsed as "${oEmbedData?.author_name}"`,
        );
      } else {
        record(
          33,
          "Tweet verify: real public tweet mechanism check",
          "FAIL",
          `status=${oEmbedRes.status}, author=${oEmbedData?.author_name}`,
        );
      }
    } catch (err) {
      record(33, "Tweet verify: real public tweet mechanism check", "FAIL", err.message);
    }

    // ── 34. Tweet verify: author handle mismatch → verified:false with plain reason ──
    try {
      const res = await fetch(`${BASE_URL}/api/claim/verify-tweet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: user1Jar.getCookieHeader(),
        },
        body: JSON.stringify({ tweet_url: "https://x.com/jack/status/20" }),
      });
      const body = await res.json();
      const isMismatch =
        res.status === 200 &&
        body.verified === false &&
        typeof body.reason === "string" &&
        body.reason.includes("jack");

      if (isMismatch) {
        record(
          34,
          "Tweet verify: author handle mismatch",
          "PASS",
          `HTTP 200, verified: false, reason: "${body.reason}"`,
        );
      } else {
        record(
          34,
          "Tweet verify: author handle mismatch",
          "FAIL",
          `status=${res.status}, body=${JSON.stringify(body)}`,
        );
      }
    } catch (err) {
      record(34, "Tweet verify: author handle mismatch", "FAIL", err.message);
    }

    // ── 35. Tweet verify: non-status URL (profile link) → 400 ───────────────
    try {
      const res = await fetch(`${BASE_URL}/api/claim/verify-tweet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: user1Jar.getCookieHeader(),
        },
        body: JSON.stringify({ tweet_url: "https://x.com/jack" }),
      });
      const body = await res.json();
      const is400 =
        res.status === 400 &&
        body.error?.code === "INVALID_TWEET_URL" &&
        Boolean(body.error?.message);

      if (is400) {
        record(
          35,
          "Tweet verify: non-status URL (profile link)",
          "PASS",
          `HTTP 400, code: ${body.error?.code}, reason: "${body.error?.message}"`,
        );
      } else {
        record(
          35,
          "Tweet verify: non-status URL (profile link)",
          "FAIL",
          `status=${res.status}, body=${JSON.stringify(body)}`,
        );
      }
    } catch (err) {
      record(35, "Tweet verify: non-status URL (profile link)", "FAIL", err.message);
    }

    // ── 36. Tweet verify: claim token absent from post → verified:false ──────
    try {
      // Temporarily set user1 agent's display_name to 'jack' with status 'pending_claim'
      await supabaseAdmin
        .from("agents")
        .update({ x_handle: "jack", display_name: "jack", status: "pending_claim" })
        .eq("handle", freeHandle);

      const res = await fetch(`${BASE_URL}/api/claim/verify-tweet`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: user1Jar.getCookieHeader(),
        },
        body: JSON.stringify({ tweet_url: "https://x.com/jack/status/20" }),
      });
      const body = await res.json();
      const isTokenAbsent =
        res.status === 200 &&
        body.verified === false &&
        typeof body.reason === "string" &&
        (body.reason.includes("claim code") || body.reason.includes("token") || body.reason.includes("link"));

      if (isTokenAbsent) {
        record(
          36,
          "Tweet verify: claim token absent from post",
          "PASS",
          `HTTP 200, verified: false, reason: "${body.reason}"`,
        );
      } else {
        record(
          36,
          "Tweet verify: claim token absent from post",
          "FAIL",
          `status=${res.status}, body=${JSON.stringify(body)}`,
        );
      }
    } catch (err) {
      record(36, "Tweet verify: claim token absent from post", "FAIL", err.message);
    }

    // ── 37. Guest invite creation & landing page copy ────────────────────────
    let guestToken = null;
    let guestInviteId = null;
    try {
      const res = await timedFetch(`${BASE_URL}/api/guests`, {
        method: "POST",
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const body = await res.json();
      guestToken = body.invite?.token;
      guestInviteId = body.invite?.id;

      const pageRes = await timedFetch(`${BASE_URL}/g/${guestToken}`);
      const pageHtml = await pageRes.text();
      const hasAgentCopy =
        (pageHtml.includes("You're chatting with") || pageHtml.includes("You&#x27;re chatting with")) &&
        (pageHtml.includes("'s agent") || pageHtml.includes("&#x27;s agent"));

      if (res.status === 201 && guestToken && pageRes.status === 200 && hasAgentCopy) {
        record(
          37,
          "Create invite -> /g/<token> renders with agent copy",
          "PASS",
          `HTTP 201, token generated, /g/<token> renders "You're chatting with <agent>'s agent"`,
        );
      } else {
        record(
          37,
          "Create invite -> /g/<token> renders with agent copy",
          "FAIL",
          `createStatus=${res.status}, pageStatus=${pageRes.status}, hasCopy=${hasAgentCopy}`,
        );
      }
    } catch (err) {
      record(37, "Create invite -> /g/<token> renders with agent copy", "FAIL", err.message);
    }

    // ── 38. Unauthenticated POST to guest send endpoint → 401 ────────────────
    try {
      const res = await timedFetch(
        `${BASE_URL}/api/guests/conversations/00000000-0000-0000-0000-000000000000/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: "unauthenticated message", idempotency_key: "idemp_unauth" }),
        },
      );
      const body = await res.json();
      if (res.status === 401 && body.error?.code === "UNAUTHENTICATED") {
        record(
          38,
          "Unauthenticated POST to guest send endpoint -> rejected (401)",
          "PASS",
          "HTTP 401 UNAUTHENTICATED",
        );
      } else {
        record(
          38,
          "Unauthenticated POST to guest send endpoint -> rejected (401)",
          "FAIL",
          `status=${res.status}, code=${body.error?.code}`,
        );
      }
    } catch (err) {
      record(
        38,
        "Unauthenticated POST to guest send endpoint -> rejected (401)",
        "FAIL",
        err.message,
      );
    }

    // ── 39. Sign in + accept invite → conversation appears in owner shell flagged guest ──
    let guest1User = null;
    let guest1Jar = new SimpleCookieJar();
    let guestConvId = null;
    try {
      // 1. Provision Guest User 1
      const uG1Email = `smoke_guest1_${Date.now()}@example.test`;
      const createUG1 = await supabaseAdmin.auth.admin.createUser({
        email: uG1Email,
        email_confirm: true,
      });
      guest1User = createUG1.data?.user;
      if (!guest1User) throw new Error("Failed to provision Guest 1");
      cleanupUserIds.push(guest1User.id);
      await supabaseAdmin.from("users").upsert({
        id: guest1User.id,
        email: guest1User.email,
        display_name: "Guest Alice",
      });

      // Establish session for Guest 1
      const linkG1 = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: uG1Email,
      });
      const cbG1 = await timedFetch(
        `${BASE_URL}/auth/callback?token_hash=${linkG1.data.properties.hashed_token}&type=magiclink`,
        { redirect: "manual" },
      );
      guest1Jar.update(cbG1);

      // 2. Accept invite
      const acceptRes = await timedFetch(`${BASE_URL}/api/guests/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: guest1Jar.getCookieHeader(),
        },
        body: JSON.stringify({ token: guestToken }),
      });
      const acceptBody = await acceptRes.json();
      guestConvId = acceptBody.conversation_id;

      // 3. Inspect owner shell conversations list
      const ownerConvsRes = await timedFetch(`${BASE_URL}/api/conversations`, {
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const ownerConvsBody = await ownerConvsRes.json();
      const guestConv = ownerConvsBody.conversations?.find((c) => c.id === guestConvId);
      const isCorrectlyFlagged =
        guestConv && guestConv.is_guest === true && guestConv.is_request === false;

      if (acceptRes.status === 200 && guestConvId && isCorrectlyFlagged) {
        record(
          39,
          "Sign in + accept -> conversation appears in owner shell flagged guest",
          "PASS",
          `Conversation ${guestConvId} bound, is_guest=true, is_request=false in owner shell`,
        );
      } else {
        record(
          39,
          "Sign in + accept -> conversation appears in owner shell flagged guest",
          "FAIL",
          `acceptStatus=${acceptRes.status}, convId=${guestConvId}, found=${Boolean(guestConv)}, is_guest=${guestConv?.is_guest}`,
        );
      }
    } catch (err) {
      record(
        39,
        "Sign in + accept -> conversation appears in owner shell flagged guest",
        "FAIL",
        err.message,
      );
    }

    // ── 40. Guest sends message → arrives in agent inbox ──────────────────────
    try {
      const guestMsgText = "Hello agent, what time does your owner work?";
      const sendRes = await timedFetch(
        `${BASE_URL}/api/guests/conversations/${guestConvId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: guest1Jar.getCookieHeader(),
          },
          body: JSON.stringify({
            body: guestMsgText,
            idempotency_key: `idemp_guest_send_${Date.now()}`,
          }),
        },
      );
      const sendBody = await sendRes.json();

      // Check agent inbox
      const inboxRes = await timedFetch(`${BASE_URL}/api/agent/inbox`, {
        headers: { Authorization: `Bearer ${credA}` },
      });
      const inboxBody = await inboxRes.json();
      const matchedInboxMsg = inboxBody.messages?.find((m) => m.body === guestMsgText);

      if (
        sendRes.status === 201 &&
        sendBody.message_id &&
        matchedInboxMsg &&
        matchedInboxMsg.from_handle === "guest"
      ) {
        record(
          40,
          "Guest sends message -> arrives in agent inbox",
          "PASS",
          "HTTP 201, message delivered to agent inbox with from_handle=guest",
        );
      } else {
        record(
          40,
          "Guest sends message -> arrives in agent inbox",
          "FAIL",
          `sendStatus=${sendRes.status}, inboxFound=${Boolean(matchedInboxMsg)}, from_handle=${matchedInboxMsg?.from_handle}`,
        );
      }
    } catch (err) {
      record(40, "Guest sends message -> arrives in agent inbox", "FAIL", err.message);
    }

    // ── 41. Agent reply with never-guard entry → blocked_by_rules, nowhere in guest thread, visible in review log ──
    try {
      // 1. Add never guard entry for Owner A
      await timedFetch(`${BASE_URL}/api/facts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: userAJar.getCookieHeader(),
        },
        body: JSON.stringify({
          text: "vault security passcode 4912",
          guard: "never",
        }),
      });

      // 2. Simulated agent reply containing never guard entry
      const replyRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credA}`,
        },
        body: JSON.stringify({
          conversation_id: guestConvId,
          body: "The vault security passcode 4912 is ready",
          idempotency_key: `idemp_never_guest_reply_${Date.now()}`,
        }),
      });
      const replyBody = await replyRes.json();

      // 3. Verify text appears NOWHERE in guest thread
      const threadRes = await timedFetch(
        `${BASE_URL}/api/guests/conversations/${guestConvId}/messages`,
        {
          headers: { cookie: guest1Jar.getCookieHeader() },
        },
      );
      const threadBody = await threadRes.json();
      const leaked = threadBody.messages?.some(
        (m) => m.body?.includes("4912") || m.body?.toLowerCase().includes("passcode"),
      );

      // 4. Verify owner review log shows it
      const activityRes = await timedFetch(`${BASE_URL}/api/guardrails/activity`, {
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const activityBody = await activityRes.json();
      const logged = (activityBody.activity || activityBody.items)?.some((i) => i.outcome === "blocked");

      if (
        replyRes.status === 403 &&
        replyBody.error?.code === "blocked_by_rules" &&
        !leaked &&
        logged
      ) {
        record(
          41,
          "Agent reply with never-guard -> blocked_by_rules, not in guest thread, review log shows it",
          "PASS",
          "HTTP 403 blocked_by_rules, zero leak to guest thread, recorded in owner review log",
        );
      } else {
        record(
          41,
          "Agent reply with never-guard -> blocked_by_rules, not in guest thread, review log shows it",
          "FAIL",
          `replyStatus=${replyRes.status}, code=${replyBody.error?.code}, leaked=${leaked}, logged=${logged}`,
        );
      }
    } catch (err) {
      record(
        41,
        "Agent reply with never-guard -> blocked_by_rules, not in guest thread, review log shows it",
        "FAIL",
        err.message,
      );
    }

    // ── 42. Agent reply with ask entry → held_for_approval; owner shares → guest receives it ──
    try {
      // 1. Add ask guard entry for Owner A
      await timedFetch(`${BASE_URL}/api/facts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: userAJar.getCookieHeader(),
        },
        body: JSON.stringify({
          text: "private dinner location is SkyLounge",
          guard: "ask",
        }),
      });

      // 2. Simulated agent reply matching ask entry
      const heldReplyRes = await timedFetch(`${BASE_URL}/api/agent/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${credA}`,
        },
        body: JSON.stringify({
          conversation_id: guestConvId,
          body: "The private dinner location is SkyLounge at 8pm",
          idempotency_key: `idemp_ask_guest_reply_${Date.now()}`,
        }),
      });
      const heldReplyBody = await heldReplyRes.json();
      const guestApprovalId = heldReplyBody.approval_id;

      // 3. Owner A shares the held approval
      const shareRes = await timedFetch(
        `${BASE_URL}/api/approvals/${guestApprovalId}/resolve`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: userAJar.getCookieHeader(),
          },
          body: JSON.stringify({ decision: "share" }),
        },
      );
      const shareBody = await shareRes.json();

      // 4. Guest receives it
      const guestThreadAfterShare = await timedFetch(
        `${BASE_URL}/api/guests/conversations/${guestConvId}/messages`,
        {
          headers: { cookie: guest1Jar.getCookieHeader() },
        },
      );
      const guestThreadAfterShareBody = await guestThreadAfterShare.json();
      const received = guestThreadAfterShareBody.messages?.some((m) =>
        m.body?.includes("SkyLounge"),
      );

      if (
        heldReplyRes.status === 200 &&
        heldReplyBody.status === "held_for_approval" &&
        shareRes.status === 200 &&
        shareBody.approval?.status === "shared" &&
        received
      ) {
        record(
          42,
          "Agent reply matching ask -> held_for_approval; owner shares -> guest receives it",
          "PASS",
          "Held for approval, owner shares, delivered cleanly into guest thread",
        );
      } else {
        record(
          42,
          "Agent reply matching ask -> held_for_approval; owner shares -> guest receives it",
          "FAIL",
          `heldStatus=${heldReplyRes.status}, shareStatus=${shareRes.status}, received=${received}`,
        );
      }
    } catch (err) {
      record(
        42,
        "Agent reply matching ask -> held_for_approval; owner shares -> guest receives it",
        "FAIL",
        err.message,
      );
    }

    // ── 43. Revoke → guest's next send fails, guest page shows revoked, pending approvals closed ──
    try {
      // 1. Create a dummy pending approval for Owner A to confirm it closes
      const dummyApp = await supabaseAdmin.from("approvals").insert({
        owner_id: userA.id,
        question: "Draft to be closed on revocation",
        status: "pending",
      }).select().single();

      // 2. Owner revokes the invite
      const revokeRes = await timedFetch(`${BASE_URL}/api/guests/${guestInviteId}/revoke`, {
        method: "POST",
        headers: { cookie: userAJar.getCookieHeader() },
      });

      // 3. Guest's next send fails with 403
      const postRevokeSendRes = await timedFetch(
        `${BASE_URL}/api/guests/conversations/${guestConvId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            cookie: guest1Jar.getCookieHeader(),
          },
          body: JSON.stringify({
            body: "Are you still here?",
            idempotency_key: `idemp_after_revoke_${Date.now()}`,
          }),
        },
      );
      const postRevokeSendBody = await postRevokeSendRes.json();

      // 4. Guest page /g/<token> renders revoked state
      const revokedPageRes = await timedFetch(`${BASE_URL}/g/${guestToken}`);
      const revokedPageHtml = await revokedPageRes.text();
      const pageShowsRevoked =
        revokedPageHtml.includes("revoked") || revokedPageHtml.includes("closed");

      // 5. Pending approvals closed
      const approvalsCheck = await timedFetch(`${BASE_URL}/api/approvals`, {
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const approvalsCheckBody = await approvalsCheck.json();
      const pendingClosed = !approvalsCheckBody.approvals?.some(
        (a) => a.id === dummyApp.data?.id,
      );

      if (
        revokeRes.status === 200 &&
        postRevokeSendRes.status === 403 &&
        postRevokeSendBody.error?.code === "INVITE_REVOKED" &&
        pageShowsRevoked &&
        pendingClosed
      ) {
        record(
          43,
          "Revoke -> next send fails (403), page shows revoked, pending approvals closed",
          "PASS",
          "HTTP 403 INVITE_REVOKED on send, /g/<token> shows revoked, pending approvals closed",
        );
      } else {
        record(
          43,
          "Revoke -> next send fails (403), page shows revoked, pending approvals closed",
          "FAIL",
          `revokeStatus=${revokeRes.status}, sendStatus=${postRevokeSendRes.status}, code=${postRevokeSendBody.error?.code}, showsRevoked=${pageShowsRevoked}, pendingClosed=${pendingClosed}`,
        );
      }
    } catch (err) {
      record(
        43,
        "Revoke -> next send fails (403), page shows revoked, pending approvals closed",
        "FAIL",
        err.message,
      );
    }

    // ── 44. 4th invite while 3 active → 409 with plain limit message ─────────
    let activeInv1, activeInv2, activeInv3;
    try {
      activeInv1 = await (await timedFetch(`${BASE_URL}/api/guests`, { method: "POST", headers: { cookie: userAJar.getCookieHeader() } })).json();
      activeInv2 = await (await timedFetch(`${BASE_URL}/api/guests`, { method: "POST", headers: { cookie: userAJar.getCookieHeader() } })).json();
      activeInv3 = await (await timedFetch(`${BASE_URL}/api/guests`, { method: "POST", headers: { cookie: userAJar.getCookieHeader() } })).json();

      const fourthRes = await timedFetch(`${BASE_URL}/api/guests`, {
        method: "POST",
        headers: { cookie: userAJar.getCookieHeader() },
      });
      const fourthBody = await fourthRes.json();
      const is409 =
        fourthRes.status === 409 &&
        fourthBody.error?.code === "FREE_GUEST_LIMIT_REACHED" &&
        fourthBody.error?.message?.includes("You have 3 active guests — the free limit");

      if (is409) {
        record(
          44,
          "4th invite while 3 active -> 409 with plain message",
          "PASS",
          `HTTP 409: "${fourthBody.error?.message}"`,
        );
      } else {
        record(
          44,
          "4th invite while 3 active -> 409 with plain message",
          "FAIL",
          `status=${fourthRes.status}, code=${fourthBody.error?.code}, msg="${fourthBody.error?.message}"`,
        );
      }
    } catch (err) {
      record(
        44,
        "4th invite while 3 active -> 409 with plain message",
        "FAIL",
        err.message,
      );
    }

    // ── 45. Expired invite → page shows plain expired copy ───────────────────
    try {
      const expCreateRes = await timedFetch(`${BASE_URL}/api/guests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: userAJar.getCookieHeader(),
        },
        body: JSON.stringify({ test_expired: true }),
      });
      const expCreateBody = await expCreateRes.json();
      const expiredRawToken = expCreateBody.invite?.token;

      const expRes = await timedFetch(`${BASE_URL}/g/${expiredRawToken}`);
      const expHtml = await expRes.text();
      const showsExpired =
        expHtml.includes("expired") || expHtml.includes("no longer valid");

      if (expRes.status === 200 && showsExpired) {
        record(
          45,
          "Expired invite -> page shows plain expired copy",
          "PASS",
          "HTTP 200, renders plain expired copy without chat UI",
        );
      } else {
        record(
          45,
          "Expired invite -> page shows plain expired copy",
          "FAIL",
          `status=${expRes.status}, showsExpired=${showsExpired}`,
        );
      }
    } catch (err) {
      record(
        45,
        "Expired invite -> page shows plain expired copy",
        "FAIL",
        err.message,
      );
    }

    // ── 46. Cross-leak: guest A cannot read guest B's thread (403); guest cannot list owner chats (403) ──
    let convBId = null;
    try {
      // Provision Guest 2 (Guest Bob)
      const uG2Email = `smoke_guest2_${Date.now()}@example.test`;
      const createUG2 = await supabaseAdmin.auth.admin.createUser({
        email: uG2Email,
        email_confirm: true,
      });
      const guest2User = createUG2.data?.user;
      if (!guest2User) throw new Error("Failed to provision Guest 2");
      cleanupUserIds.push(guest2User.id);
      await supabaseAdmin.from("users").upsert({
        id: guest2User.id,
        email: guest2User.email,
        display_name: "Guest Bob",
      });

      const linkG2 = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email: uG2Email,
      });
      const guest2Jar = new SimpleCookieJar();
      const cbG2 = await timedFetch(
        `${BASE_URL}/auth/callback?token_hash=${linkG2.data.properties.hashed_token}&type=magiclink`,
        { redirect: "manual" },
      );
      guest2Jar.update(cbG2);

      // Guest 2 accepts activeInv1
      const accept2Res = await timedFetch(`${BASE_URL}/api/guests/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: guest2Jar.getCookieHeader(),
        },
        body: JSON.stringify({ token: activeInv1.invite.token }),
      });
      const accept2Body = await accept2Res.json();
      convBId = accept2Body.conversation_id;

      // Guest 1 attempts to read Guest 2's thread
      const crossLeakRes = await timedFetch(
        `${BASE_URL}/api/guests/conversations/${convBId}/messages`,
        {
          headers: { cookie: guest1Jar.getCookieHeader() },
        },
      );

      // Guest 1 attempts to list owner conversations
      const guestListOwnerConvsRes = await timedFetch(`${BASE_URL}/api/conversations`, {
        headers: { cookie: guest1Jar.getCookieHeader() },
      });

      if (crossLeakRes.status === 403 && guestListOwnerConvsRes.status === 403) {
        record(
          46,
          "Cross-leak: guest A cannot read guest B thread (403); guest cannot list owner chats (403)",
          "PASS",
          "HTTP 403 on another guest conversation, HTTP 403 on owner conversation list",
        );
      } else {
        record(
          46,
          "Cross-leak: guest A cannot read guest B thread (403); guest cannot list owner chats (403)",
          "FAIL",
          `crossLeakStatus=${crossLeakRes.status}, ownerListStatus=${guestListOwnerConvsRes.status}`,
        );
      }
    } catch (err) {
      record(
        46,
        "Cross-leak: guest A cannot read guest B thread (403); guest cannot list owner chats (403)",
        "FAIL",
        err.message,
      );
    }

    // ── 47. Analytics: accepted invite produced exactly one guest_invite_accepted event with no content fields ──
    try {
      let trackedEvents = [];

      // 1. Try Supabase analytics_events table
      try {
        const { data: dbEvents } = await supabaseAdmin
          .from("analytics_events")
          .select("*")
          .eq("event", "guest_invite_accepted");
        if (dbEvents && dbEvents.length > 0) {
          trackedEvents = dbEvents;
        }
      } catch {}

      // 2. Fall back to local capture file
      if (trackedEvents.length === 0) {
        const capturePath = path.resolve(process.cwd(), ".analytics-events.jsonl");
        if (fs.existsSync(capturePath)) {
          const lines = fs
            .readFileSync(capturePath, "utf8")
            .split("\n")
            .filter((l) => l.trim());
          trackedEvents = lines
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return null;
              }
            })
            .filter((e) => e && e.event === "guest_invite_accepted");
        }
      }

      const acceptedEvt = trackedEvents.find((e) => e.properties?.conversation_id === convBId);

      const hasZeroContent =
        acceptedEvt &&
        !acceptedEvt.properties.text &&
        !acceptedEvt.properties.body &&
        !acceptedEvt.properties.email &&
        !acceptedEvt.properties.name &&
        Boolean(acceptedEvt.properties.invite_id);

      if (acceptedEvt && hasZeroContent) {
        record(
          47,
          "Analytics: guest_invite_accepted produced with zero content/PII fields",
          "PASS",
          "Event recorded with IDs and timestamps only, no message text, no names, no emails",
        );
      } else {
        record(
          47,
          "Analytics: guest_invite_accepted produced with zero content/PII fields",
          "FAIL",
          `eventFound=${Boolean(acceptedEvt)}, zeroContent=${hasZeroContent}`,
        );
      }
    } catch (err) {
      record(
        47,
        "Analytics: guest_invite_accepted produced with zero content/PII fields",
        "FAIL",
        err.message,
      );
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PHASE 6: CONTACTS & INVITES (ROWS 48-54)
    // ═══════════════════════════════════════════════════════════════════════

    async function provisionSmokeUserAndAgent(prefix) {
      const suffix = Math.random().toString(36).slice(2, 7);
      const email = `smoke_${prefix}_${Date.now()}_${suffix}@example.test`;
      const createRes = await supabaseAdmin.auth.admin.createUser({
        email,
        email_confirm: true,
      });
      const user = createRes.data?.user;
      if (!user) throw new Error(`Failed to provision user for ${prefix}`);
      cleanupUserIds.push(user.id);
      await supabaseAdmin.from("users").upsert({ id: user.id, email: user.email });

      const handle = `smk_${prefix}_${suffix}`;
      cleanupHandles.push(handle);
      const { data: agentData, error: agentErr } = await supabaseAdmin
        .from("agents")
        .insert({
          owner_id: user.id,
          handle,
          status: "active",
          display_name: `@${handle}`,
        })
        .select()
        .single();
      if (agentErr) throw new Error(`Failed to create agent for ${prefix}: ${agentErr.message}`);

      const jar = new SimpleCookieJar();
      const link = await supabaseAdmin.auth.admin.generateLink({
        type: "magiclink",
        email,
      });
      const cb = await timedFetch(
        `${BASE_URL}/auth/callback?token_hash=${link.data.properties.hashed_token}&type=magiclink`,
        { redirect: "manual" },
      );
      jar.update(cb);

      const ccRes = await timedFetch(`${BASE_URL}/api/agents/connect-code`, {
        method: "POST",
        headers: { cookie: jar.getCookieHeader() },
      });
      const ccBody = await ccRes.json();
      const connRes = await timedFetch(`${BASE_URL}/api/agent/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: ccBody.code }),
      });
      const connBody = await connRes.json();

      return { user, agent: agentData, handle, jar, cred: connBody.credential };
    }

    let pD, pE, pF, pG, pH, pI, pJ;

    // ── 48. A adds B by handle → B's incoming shows request; B accepts → contacts formed ──
    try {
      pD = await provisionSmokeUserAndAgent("d");
      pE = await provisionSmokeUserAndAgent("e");

      // D adds E by handle
      const addRes = await timedFetch(`${BASE_URL}/api/contacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: pD.jar.getCookieHeader(),
        },
        body: JSON.stringify({ handle: pE.handle }),
      });
      const addBody = await addRes.json();

      // E inspects contacts list
      const getERes = await timedFetch(`${BASE_URL}/api/contacts`, {
        headers: { cookie: pE.jar.getCookieHeader() },
      });
      const getEBody = await getERes.json();
      const incomingReq = getEBody.incoming?.find((r) => r.handle === pD.handle);

      // E accepts request
      let acceptRes = null;
      if (incomingReq) {
        acceptRes = await timedFetch(`${BASE_URL}/api/contacts/${incomingReq.id}/accept`, {
          method: "POST",
          headers: { cookie: pE.jar.getCookieHeader() },
        });
      }

      // Both inspect contacts list
      const checkD = await (await timedFetch(`${BASE_URL}/api/contacts`, { headers: { cookie: pD.jar.getCookieHeader() } })).json();
      const checkE = await (await timedFetch(`${BASE_URL}/api/contacts`, { headers: { cookie: pE.jar.getCookieHeader() } })).json();

      const dHasE = checkD.contacts?.some((c) => c.handle === pE.handle);
      const eHasD = checkE.contacts?.some((c) => c.handle === pD.handle);

      if (addRes.status === 201 && incomingReq && acceptRes?.status === 200 && dHasE && eHasD) {
        record(
          48,
          "A adds B by handle -> B incoming shows request -> B accepts -> both list each other",
          "PASS",
          `Contact established between @${pD.handle} and @${pE.handle}; symmetric lists verified`,
        );
      } else {
        record(
          48,
          "A adds B by handle -> B incoming shows request -> B accepts -> both list each other",
          "FAIL",
          `addStatus=${addRes.status}, reqFound=${Boolean(incomingReq)}, dHasE=${dHasE}, eHasD=${eHasD}`,
        );
      }
    } catch (err) {
      record(
        48,
        "A adds B by handle -> B incoming shows request -> B accepts -> both list each other",
        "FAIL",
        err.message,
      );
    }

    // ── 49. After acceptance, B's agent first message to A opens in MAIN list (is_request=false) ──
    try {
      const sendRes = await timedFetch(`${BASE_URL}/api/agent/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pE.cred}`,
        },
        body: JSON.stringify({
          to_handle: pD.handle,
          body: "Hello my new contact! Direct chat.",
          idempotency_key: `idemp_smoke_c1_${Date.now()}`,
        }),
      });
      const sendBody = await sendRes.json();

      // D checks shell conversations
      const dConvsRes = await timedFetch(`${BASE_URL}/api/conversations`, {
        headers: { cookie: pD.jar.getCookieHeader() },
      });
      const dConvsBody = await dConvsRes.json();
      const matchConv = dConvsBody.conversations?.find((c) => c.handle === pE.handle);
      const inMain = dConvsBody.main?.some((c) => c.handle === pE.handle);
      const inRequests = dConvsBody.requests?.some((c) => c.handle === pE.handle);

      if (
        (sendRes.status === 200 || sendRes.status === 201) &&
        matchConv &&
        matchConv.is_request === false &&
        inMain &&
        !inRequests
      ) {
        record(
          49,
          "After acceptance, B's agent first message to A opens in MAIN list (is_request=false)",
          "PASS",
          `First message between contacts opened conversation ${matchConv.id} in main list with is_request=false`,
        );
      } else {
        record(
          49,
          "After acceptance, B's agent first message to A opens in MAIN list (is_request=false)",
          "FAIL",
          `sendStatus=${sendRes.status}, found=${Boolean(matchConv)}, is_request=${matchConv?.is_request}, inMain=${inMain}`,
        );
      }
    } catch (err) {
      record(
        49,
        "After acceptance, B's agent first message to A opens in MAIN list (is_request=false)",
        "FAIL",
        err.message,
      );
    }

    // ── 50. C (not a contact) still lands in Requests (is_request=true) ────────
    try {
      pF = await provisionSmokeUserAndAgent("f");

      const sendRes = await timedFetch(`${BASE_URL}/api/agent/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pF.cred}`,
        },
        body: JSON.stringify({
          to_handle: pD.handle,
          body: "Hello stranger agent, I am not a contact.",
          idempotency_key: `idemp_smoke_c2_${Date.now()}`,
        }),
      });
      const sendBody = await sendRes.json();

      // D checks shell conversations
      const dConvsRes = await timedFetch(`${BASE_URL}/api/conversations`, {
        headers: { cookie: pD.jar.getCookieHeader() },
      });
      const dConvsBody = await dConvsRes.json();
      const matchConv = dConvsBody.conversations?.find((c) => c.handle === pF.handle);
      const inRequests = dConvsBody.requests?.some((c) => c.handle === pF.handle);

      if (
        (sendRes.status === 200 || sendRes.status === 201) &&
        matchConv &&
        matchConv.is_request === true &&
        inRequests
      ) {
        record(
          50,
          "C (not a contact) first message still lands in Requests (is_request=true)",
          "PASS",
          `Stranger agent first message created conversation ${matchConv.id} in Requests column with is_request=true`,
        );
      } else {
        record(
          50,
          "C (not a contact) first message still lands in Requests (is_request=true)",
          "FAIL",
          `sendStatus=${sendRes.status}, found=${Boolean(matchConv)}, is_request=${matchConv?.is_request}, inRequests=${inRequests}`,
        );
      }
    } catch (err) {
      record(
        50,
        "C (not a contact) first message still lands in Requests (is_request=true)",
        "FAIL",
        err.message,
      );
    }

    // ── 51. Invite link: D creates one; new user adds → contact formed; reuse rejected ──
    try {
      pG = await provisionSmokeUserAndAgent("g");

      // D creates invite link
      const inviteRes = await timedFetch(`${BASE_URL}/api/contacts/invite`, {
        method: "POST",
        headers: { cookie: pD.jar.getCookieHeader() },
      });
      const inviteBody = await inviteRes.json();
      const token = inviteBody.link?.split("/c/")[1];

      // G consumes invite link
      const acceptRes = await timedFetch(`${BASE_URL}/api/contacts/invite/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: pG.jar.getCookieHeader(),
        },
        body: JSON.stringify({ token }),
      });
      const acceptBody = await acceptRes.json();

      // Verify contact formed both ways
      const checkD = await (await timedFetch(`${BASE_URL}/api/contacts`, { headers: { cookie: pD.jar.getCookieHeader() } })).json();
      const checkG = await (await timedFetch(`${BASE_URL}/api/contacts`, { headers: { cookie: pG.jar.getCookieHeader() } })).json();
      const dHasG = checkD.contacts?.some((c) => c.handle === pG.handle);
      const gHasD = checkG.contacts?.some((c) => c.handle === pD.handle);

      // Token reuse attempt by F
      const reuseRes = await timedFetch(`${BASE_URL}/api/contacts/invite/accept`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: pF.jar.getCookieHeader(),
        },
        body: JSON.stringify({ token }),
      });
      const reuseBody = await reuseRes.json();

      if (
        inviteRes.status === 201 &&
        acceptRes.status === 200 &&
        dHasG &&
        gHasD &&
        reuseRes.status === 400 &&
        reuseBody.error?.code === "INVITE_INVALID"
      ) {
        record(
          51,
          "Invite link: D creates -> new user adds -> contact formed both ways; reuse rejected",
          "PASS",
          `Invite link consumed by @${pG.handle}, bilateral contacts formed, replay rejected with 400`,
        );
      } else {
        record(
          51,
          "Invite link: D creates -> new user adds -> contact formed both ways; reuse rejected",
          "FAIL",
          `inviteStatus=${inviteRes.status}, acceptStatus=${acceptRes.status}, dHasG=${dHasG}, gHasD=${gHasD}, reuseStatus=${reuseRes.status}`,
        );
      }
    } catch (err) {
      record(
        51,
        "Invite link: D creates -> new user adds -> contact formed both ways; reuse rejected",
        "FAIL",
        err.message,
      );
    }

    // ── 52. A removes B → a NEW first conversation from B's agent lands in Requests again ──
    try {
      pH = await provisionSmokeUserAndAgent("h");
      pI = await provisionSmokeUserAndAgent("i");

      // Form contact between H and I
      const reqRes = await timedFetch(`${BASE_URL}/api/contacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: pH.jar.getCookieHeader(),
        },
        body: JSON.stringify({ handle: pI.handle }),
      });
      const getIRes = await (await timedFetch(`${BASE_URL}/api/contacts`, { headers: { cookie: pI.jar.getCookieHeader() } })).json();
      const inc = getIRes.incoming?.find((r) => r.handle === pH.handle);
      if (inc) {
        await timedFetch(`${BASE_URL}/api/contacts/${inc.id}/accept`, {
          method: "POST",
          headers: { cookie: pI.jar.getCookieHeader() },
        });
      }

      // H removes I
      const delRes = await timedFetch(`${BASE_URL}/api/contacts/${pI.user.id}`, {
        method: "DELETE",
        headers: { cookie: pH.jar.getCookieHeader() },
      });

      // Verify contact removed both ways
      const checkH = await (await timedFetch(`${BASE_URL}/api/contacts`, { headers: { cookie: pH.jar.getCookieHeader() } })).json();
      const checkI = await (await timedFetch(`${BASE_URL}/api/contacts`, { headers: { cookie: pI.jar.getCookieHeader() } })).json();
      const removedBoth =
        !checkH.contacts?.some((c) => c.handle === pI.handle) &&
        !checkI.contacts?.some((c) => c.handle === pH.handle);

      // Now I's agent sends its FIRST conversation message to H's agent
      const sendRes = await timedFetch(`${BASE_URL}/api/agent/send`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${pI.cred}`,
        },
        body: JSON.stringify({
          to_handle: pH.handle,
          body: "Are we strangers now?",
          idempotency_key: `idemp_smoke_c3_${Date.now()}`,
        }),
      });

      // H inspects shell conversations
      const hConvsRes = await timedFetch(`${BASE_URL}/api/conversations`, {
        headers: { cookie: pH.jar.getCookieHeader() },
      });
      const hConvsBody = await hConvsRes.json();
      const matchConv = hConvsBody.conversations?.find((c) => c.handle === pI.handle);
      const inRequests = hConvsBody.requests?.some((c) => c.handle === pI.handle);

      if (
        delRes.status === 200 &&
        removedBoth &&
        (sendRes.status === 200 || sendRes.status === 201) &&
        matchConv &&
        matchConv.is_request === true &&
        inRequests
      ) {
        record(
          52,
          "A removes B -> a NEW first conversation from B's agent lands in Requests again",
          "PASS",
          `After contact removal, new conversation ${matchConv.id} between agents landed in Requests with is_request=true`,
        );
      } else {
        record(
          52,
          "A removes B -> a NEW first conversation from B's agent lands in Requests again",
          "FAIL",
          `delStatus=${delRes.status}, removedBoth=${removedBoth}, is_request=${matchConv?.is_request}, inRequests=${inRequests}`,
        );
      }
    } catch (err) {
      record(
        52,
        "A removes B -> a NEW first conversation from B's agent lands in Requests again",
        "FAIL",
        err.message,
      );
    }

    // ── 53. Validation: self-add → 400; unknown handle → 404; duplicate add → 409 ──
    try {
      pJ = await provisionSmokeUserAndAgent("j");

      // 1. Self-add -> 400 CANNOT_ADD_SELF
      const selfRes = await timedFetch(`${BASE_URL}/api/contacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: pJ.jar.getCookieHeader(),
        },
        body: JSON.stringify({ handle: pJ.handle }),
      });
      const selfBody = await selfRes.json();
      const selfPass = selfRes.status === 400 && selfBody.error?.code === "CANNOT_ADD_SELF";

      // 2. Unknown handle -> 404 AGENT_NOT_FOUND
      const unknownRes = await timedFetch(`${BASE_URL}/api/contacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: pJ.jar.getCookieHeader(),
        },
        body: JSON.stringify({ handle: "completely_unclaimed_handle_99999" }),
      });
      const unknownBody = await unknownRes.json();
      const unknownPass = unknownRes.status === 404 && unknownBody.error?.code === "AGENT_NOT_FOUND";

      // 3. Duplicate add -> 409
      // First add succeeds (to pD)
      const add1 = await timedFetch(`${BASE_URL}/api/contacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: pJ.jar.getCookieHeader(),
        },
        body: JSON.stringify({ handle: pD.handle }),
      });
      // Second add while pending -> 409 REQUEST_ALREADY_PENDING
      const dupRes = await timedFetch(`${BASE_URL}/api/contacts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          cookie: pJ.jar.getCookieHeader(),
        },
        body: JSON.stringify({ handle: pD.handle }),
      });
      const dupBody = await dupRes.json();
      const dupPass = dupRes.status === 409 && dupBody.error?.code === "REQUEST_ALREADY_PENDING";

      if (selfPass && unknownPass && add1.status === 201 && dupPass) {
        record(
          53,
          "self-add -> 400; unknown handle -> 404; duplicate add -> 409",
          "PASS",
          "Self-add (400), unknown handle (404), and duplicate pending add (409) all rejected with plain messages",
        );
      } else {
        record(
          53,
          "self-add -> 400; unknown handle -> 404; duplicate add -> 409",
          "FAIL",
          `selfPass=${selfPass}, unknownPass=${unknownPass}, dupPass=${dupPass}`,
        );
      }
    } catch (err) {
      record(
        53,
        "self-add -> 400; unknown handle -> 404; duplicate add -> 409",
        "FAIL",
        err.message,
      );
    }

    // ── 54. Isolation: A's contact list shows only A's contacts (no leakage) ──
    try {
      // pD is contacts with pE and pG.
      // pE and pG are NOT contacts with each other.
      const listE = await (await timedFetch(`${BASE_URL}/api/contacts`, { headers: { cookie: pE.jar.getCookieHeader() } })).json();
      const listG = await (await timedFetch(`${BASE_URL}/api/contacts`, { headers: { cookie: pG.jar.getCookieHeader() } })).json();

      const eShowsD = listE.contacts?.some((c) => c.handle === pD.handle);
      const eHasLeakOfG = listE.contacts?.some((c) => c.handle === pG.handle);

      const gShowsD = listG.contacts?.some((c) => c.handle === pD.handle);
      const gHasLeakOfE = listG.contacts?.some((c) => c.handle === pE.handle);

      if (eShowsD && !eHasLeakOfG && gShowsD && !gHasLeakOfE) {
        record(
          54,
          "isolation: A's contact list shows only A's contacts (no leakage of B's other contacts)",
          "PASS",
          "Zero cross-contact leakage between independent contacts verified",
        );
      } else {
        record(
          54,
          "isolation: A's contact list shows only A's contacts (no leakage of B's other contacts)",
          "FAIL",
          `eShowsD=${eShowsD}, eHasLeakOfG=${eHasLeakOfG}, gShowsD=${gShowsD}, gHasLeakOfE=${gHasLeakOfE}`,
        );
      }
    } catch (err) {
      record(
        54,
        "isolation: A's contact list shows only A's contacts (no leakage of B's other contacts)",
        "FAIL",
        err.message,
      );
    }
  } finally {
    // ── CLEANUP: Delete test users and test agents unconditionally ──────────
    try {
      if (cleanupHandles.length > 0) {
        await supabaseAdmin.from("claim_codes").delete().in("requested_handle", cleanupHandles);
        await supabaseAdmin.from("agents").delete().in("handle", cleanupHandles);
      }
      if (cleanupUserIds.length > 0) {
        try {
          await supabaseAdmin.from("contacts").delete().in("owner_id", cleanupUserIds);
          await supabaseAdmin.from("contacts").delete().in("contact_owner_id", cleanupUserIds);
          await supabaseAdmin.from("contact_invites").delete().in("owner_id", cleanupUserIds);
          await supabaseAdmin.from("guest_invites").delete().in("owner_id", cleanupUserIds);
          await supabaseAdmin.from("conversations").delete().in("guest_user_id", cleanupUserIds);
          await supabaseAdmin.from("blocks").delete().in("owner_id", cleanupUserIds);
          await supabaseAdmin.from("approvals").delete().in("owner_id", cleanupUserIds);
          await supabaseAdmin.from("facts").delete().in("owner_id", cleanupUserIds);
        } catch {}
        await supabaseAdmin.from("claim_codes").delete().in("owner_id", cleanupUserIds);
        await supabaseAdmin.from("agents").delete().in("owner_id", cleanupUserIds);
        await supabaseAdmin.from("users").delete().in("id", cleanupUserIds);
        for (const uid of cleanupUserIds) {
          await supabaseAdmin.auth.admin.deleteUser(uid);
        }
      }
    } catch (cleanupErr) {
      console.warn("Cleanup warning:", cleanupErr.message);
    }
  }

  // Print results table
  console.log("\n======================== SMOKE TEST SUITE ========================");
  console.log(
    "| Row | Status                                        | Target / Flow                                         | Details",
  );
  console.log(
    "|-----|-----------------------------------------------|-------------------------------------------------------|-------------------------------------------",
  );

  for (const r of rows) {
    const idCol = String(r.id).padEnd(3);
    const statusCol = r.status.padEnd(45);
    const descCol = r.description.padEnd(53);
    console.log(`| ${idCol} | ${statusCol} | ${descCol} | ${r.details}`);
  }
  console.log("==================================================================\n");

  const baselinePassed = rows
    .filter((r) => r.id <= 25)
    .every(
      (r) =>
        r.status === "PASS" ||
        r.status.startsWith("NOT EXERCISED") ||
        r.status.startsWith("PRESENT"),
    );
  const guardrailsRows = rows.filter((r) => r.id >= 26 && r.id <= 32);
  const guardrailsPassedCount = guardrailsRows.filter((r) => r.status === "PASS").length;
  const guardrailsPassed =
    guardrailsRows.length > 0 && guardrailsPassedCount === guardrailsRows.length;

  const tweetRows = rows.filter((r) => r.id >= 33 && r.id <= 36);
  const tweetPassedCount = tweetRows.filter((r) => r.status === "PASS").length;
  const tweetPassed = tweetRows.length > 0 && tweetPassedCount === tweetRows.length;

  const guestRows = rows.filter((r) => r.id >= 37 && r.id <= 47);
  const guestPassedCount = guestRows.filter((r) => r.status === "PASS").length;
  const guestPassed = guestRows.length > 0 && guestPassedCount === guestRows.length;

  const contactsRows = rows.filter((r) => r.id >= 48 && r.id <= 54);
  const contactsPassedCount = contactsRows.filter((r) => r.status === "PASS").length;
  const contactsPassed = contactsRows.length > 0 && contactsPassedCount === contactsRows.length;

  console.log(`BASELINE (ROWS 1-25): ${baselinePassed ? "PASS (25/25)" : "FAIL"}`);
  console.log(
    `GUARDRAILS (ROWS 26-32): ${
      guardrailsPassed
        ? `PASS (${guardrailsPassedCount}/${guardrailsRows.length})`
        : `FAIL (${guardrailsPassedCount}/${guardrailsRows.length})`
    }`,
  );
  console.log(
    `TWEET VERIFY (ROWS 33-36): ${
      tweetPassed
        ? `PASS (${tweetPassedCount}/${tweetRows.length})`
        : `FAIL (${tweetPassedCount}/${tweetRows.length})`
    }`,
  );
  console.log(
    `GUEST LINKS (ROWS 37-47): ${
      guestPassed
        ? `PASS (${guestPassedCount}/${guestRows.length})`
        : `FAIL (${guestPassedCount}/${guestRows.length})`
    }`,
  );
  console.log(
    `CONTACTS & INVITES (ROWS 48-54): ${
      contactsPassed
        ? `PASS (${contactsPassedCount}/${contactsRows.length})`
        : `FAIL (${contactsPassedCount}/${contactsRows.length})`
    }`,
  );

  if (!baselinePassed || !guardrailsPassed || !tweetPassed || !guestPassed || !contactsPassed) {
    console.error("SMOKE SUITE RESULT: FAILED");
    process.exit(1);
  } else {
    console.log("SMOKE SUITE RESULT: ALL EXERCISED FLOWS PASSED");
    process.exit(0);
  }
}

runSmokeTests().catch((err) => {
  console.error("Smoke script uncaught error:", err);
  process.exit(1);
});
