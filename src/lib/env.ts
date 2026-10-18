import { z } from "zod";

export const envSchema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url("NEXT_PUBLIC_SUPABASE_URL must be a valid URL"),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be a non-empty string"),
  SUPABASE_SECRET_KEY: z
    .string()
    .min(1, "SUPABASE_SECRET_KEY must be a non-empty string"),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url("NEXT_PUBLIC_APP_URL must be a valid URL"),

  // Security secrets
  CLAIM_CODE_SECRET: z.string().min(1, "CLAIM_CODE_SECRET must be a non-empty string"),
  AGENT_TOKEN_SECRET: z.string().min(1, "AGENT_TOKEN_SECRET must be a non-empty string"),

  // Embeddings
  EMBEDDING_PROVIDER: z.string().min(1).default("gemini"),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY must be a non-empty string"),

  // Email
  RESEND_API_KEY: z.string().min(1, "RESEND_API_KEY must be a non-empty string"),
  EMAIL_FROM: z.string().min(1, "EMAIL_FROM must be a non-empty string"),

  // Dev test login (local testing only, never set in production)
  DEV_TEST_LOGIN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(rawEnv: Record<string, unknown>): Env {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Environment validation failed. Missing or invalid variables:\n${issues}`);
  }
  return result.data;
}

export const env: Env = validateEnv(process.env);
