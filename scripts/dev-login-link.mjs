import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

const founderEmail = process.argv[2] || process.env.FOUNDER_EMAIL;

if (!founderEmail) {
  console.error("Error: Missing email address. Usage: node scripts/dev-login-link.mjs <email>");
  process.exit(1);
}

try {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const envContent = fs.readFileSync(envPath, "utf8");
  const env = Object.fromEntries(
    envContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const idx = line.indexOf("=");
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      }),
  );

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !secretKey) {
    console.error("Error: Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // 1. Create user if doesn't exist
  const { error: createError } = await supabase.auth.admin.createUser({
    email: founderEmail,
    email_confirm: true,
  });

  if (createError && !createError.message.toLowerCase().includes("already registered")) {
    // If it's another error, check if user exists or continue
  }

  // 2. Generate magic link
  const { data, error: linkError } = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: founderEmail,
    options: {
      redirectTo: "http://localhost:3000/auth/callback",
    },
  });

  if (linkError) {
    console.error(linkError.message);
    process.exit(1);
  }

  if (data?.properties?.action_link) {
    console.log(data.properties.action_link);
  } else {
    console.error("Error: No action_link returned");
    process.exit(1);
  }
} catch (err) {
  console.error(err.message || String(err));
  process.exit(1);
}
