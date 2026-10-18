import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient } from "@/server/db/clients";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { logger, newRequestId } from "@/lib/logger";

export async function POST(request: NextRequest) {
  // First line: return 404 if flag is not "true" or running in production
  if (process.env.DEV_TEST_LOGIN !== "true" || process.env.NODE_ENV === "production") {
    return new NextResponse(null, { status: 404 });
  }

  const requestId = newRequestId();
  const devEmail = "dev@qurelium.local";
  const serviceClient = getServiceClient();

  try {
    // 1. Ensure dev user exists
    const { data: createData, error: createError } = await serviceClient.auth.admin.createUser({
      email: devEmail,
      email_confirm: true,
    });

    if (createError && !createError.message.toLowerCase().includes("already registered")) {
      logger.info({
        msg: `dev-login: createUser notice: ${createError.message}`,
        request_id: requestId,
      });
    }

    let devUserId = createData?.user?.id;
    if (!devUserId) {
      const { data: usersData } = await serviceClient.auth.admin.listUsers();
      devUserId = usersData?.users?.find((u) => u.email === devEmail)?.id;
    }

    if (devUserId) {
      // Ensure row in public.users exists
      await serviceClient.from("users").upsert({
        id: devUserId,
        email: devEmail,
      });

      // Ensure active agent row exists for shell access
      const { data: existingAgent } = await serviceClient
        .from("agents")
        .select("id")
        .eq("owner_id", devUserId)
        .maybeSingle();

      if (!existingAgent) {
        await serviceClient.from("agents").insert({
          owner_id: devUserId,
          handle: "dev_agent",
          display_name: "dev_agent",
          status: "active",
        });
      }
    }

    // 2. Generate magic link token
    const { data: linkData, error: linkError } = await serviceClient.auth.admin.generateLink({
      type: "magiclink",
      email: devEmail,
    });

    const hashedToken = linkData?.properties?.hashed_token;

    if (linkError || !hashedToken) {
      logger.error({
        msg: `dev-login: failed to generate magic link: ${linkError?.message ?? "missing hashed_token"}`,
        request_id: requestId,
      });
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to generate development sign-in token.",
            request_id: requestId,
          },
        },
        { status: 500 },
      );
    }

    // 3. Verify OTP using SSR server client so session cookies are written to the response
    const supabase = await createSupabaseServerClient();
    const { error: verifyError } = await supabase.auth.verifyOtp({
      token_hash: hashedToken,
      type: "magiclink",
    });

    if (verifyError) {
      logger.error({
        msg: `dev-login: verifyOtp failed: ${verifyError.message}`,
        request_id: requestId,
      });
      return NextResponse.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to establish test session.",
            request_id: requestId,
          },
        },
        { status: 500 },
      );
    }

    logger.info({
      msg: "dev-login: successful test session established",
      request_id: requestId,
    });

    // 4. Redirect to /
    return NextResponse.redirect(new URL("/", request.url), 303);
  } catch (err: unknown) {
    logger.error({
      msg: `dev-login unexpected exception: ${err instanceof Error ? err.message : String(err)}`,
      request_id: requestId,
    });
    return NextResponse.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "An unexpected error occurred during dev login.",
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }
}
