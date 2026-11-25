import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/** Routes that never require authentication. */
const PUBLIC_PATHS = [
  "/login",
  "/auth",
  "/api/healthz",
  "/api/readyz",
  "/api/dev-login",
  "/api/agent",
  "/g",
];

function isPublic(pathname: string): boolean {
  if (pathname === "/g/chat" || pathname.startsWith("/g/chat/")) {
    return false;
  }
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function hasAuthCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") || c.name.includes("auth-token"));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Static health checks, auth callbacks, and agent protocol endpoints never need cookie session refresh
  if (
    pathname === "/api/healthz" ||
    pathname === "/api/readyz" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/agent")
  ) {
    return NextResponse.next({ request });
  }

  // Fast path: unauthenticated visitor on /login doesn't need a Supabase call
  if (pathname === "/login" && !hasAuthCookie(request)) {
    return NextResponse.next({ request });
  }

  // Fast path: unauthenticated user on protected path redirected immediately
  if (!isPublic(pathname) && !hasAuthCookie(request)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required.",
          },
        },
        { status: 401 },
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({
    request,
  });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refresh session with 5s timeout per docs/RELIABILITY.md
  let user = null;
  try {
    const timeoutPromise = new Promise<{ data: { user: null } }>((resolve) =>
      setTimeout(() => resolve({ data: { user: null } }), 5000),
    );
    const result = await Promise.race([supabase.auth.getUser(), timeoutPromise]);
    user = result.data?.user ?? null;
  } catch {
    user = null;
  }

  // Redirect unauthenticated users to /login for protected routes.
  if (!user && !isPublic(pathname)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        {
          error: {
            code: "UNAUTHENTICATED",
            message: "Authentication required.",
          },
        },
        { status: 401 },
      );
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);
  }

  // Redirect authenticated users away from /login.
  if (user && pathname === "/login") {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Run on all paths except Next.js internals and static assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
