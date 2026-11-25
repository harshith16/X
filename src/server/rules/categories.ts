import { getServiceClient } from "@/server/db/clients";
import { logger } from "@/lib/logger";
import {
  GuardCategoryKey,
  GuardCategoryMode,
  GuardCategoryDefinition,
  GuardCategoryState,
} from "@/types/brain";

// ── Sensitive Specifics Categories Catalogue (Prompt 8c-UI v2) ──────────────────

export const GUARD_CATEGORIES_CATALOGUE: Record<GuardCategoryKey, GuardCategoryDefinition> = {
  secrets: {
    id: "secrets",
    label: "Secrets",
    description: "Passwords, PINs, one-time codes, card numbers, and banking details",
    defaultMode: "never",
    allowedModes: ["never", "ask"],
  },
  home_address: {
    id: "home_address",
    label: "Home address",
    description: "The exact street address",
    defaultMode: "ask",
    allowedModes: ["open", "ask", "never"],
  },
  phone_number: {
    id: "phone_number",
    label: "Phone number",
    description: "Direct telephone and mobile numbers",
    defaultMode: "ask",
    allowedModes: ["open", "ask", "never"],
  },
  personal_email: {
    id: "personal_email",
    label: "Personal email",
    description: "Private personal email addresses",
    defaultMode: "ask",
    allowedModes: ["open", "ask", "never"],
  },
  live_location: {
    id: "live_location",
    label: "Live location",
    description: "Real-time location, map pins, and coordinates",
    defaultMode: "never",
    allowedModes: ["open", "ask", "never"],
  },
  money_figures: {
    id: "money_figures",
    label: "Money figures",
    description: "Salary, account balance, and debt amounts",
    defaultMode: "ask",
    allowedModes: ["open", "ask", "never"],
  },
  health_specifics: {
    id: "health_specifics",
    label: "Health specifics",
    description: "Named medical conditions and prescriptions",
    defaultMode: "ask",
    allowedModes: ["open", "ask", "never"],
  },
  family_specifics: {
    id: "family_specifics",
    label: "Family specifics",
    description: "School names and family identifying details",
    defaultMode: "open",
    allowedModes: ["open", "ask", "never"],
  },
};

// ── In-Memory Fallback Store (active if remote Postgres table is pending migration) ──

const globalForCategories = globalThis as unknown as {
  __guardCategories?: Map<string, Map<GuardCategoryKey, GuardCategoryMode>>;
};

const memoryCategories = (globalForCategories.__guardCategories ??= new Map<
  string,
  Map<GuardCategoryKey, GuardCategoryMode>
>());

/**
 * Returns default mode for a category.
 */
export function getDefaultCategoryMode(category: GuardCategoryKey): GuardCategoryMode {
  return GUARD_CATEGORIES_CATALOGUE[category]?.defaultMode ?? "open";
}

/**
 * Returns all categories with active modes for an owner.
 * Merges defaults with any stored owner toggles.
 */
export async function getOwnerCategoryModes(
  ownerId: string,
  requestId?: string,
): Promise<GuardCategoryState[]> {
  const db = getServiceClient();
  const storedModes = new Map<GuardCategoryKey, GuardCategoryMode>();

  // 1. Try fetching from Supabase
  try {
    const { data, error } = await db
      .from("guard_categories")
      .select("category, mode")
      .eq("owner_id", ownerId);

    if (!error && data) {
      for (const row of data) {
        if (row.category in GUARD_CATEGORIES_CATALOGUE) {
          storedModes.set(row.category as GuardCategoryKey, row.mode as GuardCategoryMode);
        }
      }
    }
  } catch {
    // Remote table pending migration, fall back to memory
  }

  // 2. Check in-memory fallback
  const memMap = memoryCategories.get(ownerId);
  if (memMap) {
    for (const [cat, mode] of memMap.entries()) {
      if (!storedModes.has(cat) && cat in GUARD_CATEGORIES_CATALOGUE) {
        storedModes.set(cat, mode);
      }
    }
  }

  // 3. Assemble catalogue with effective modes
  const allKeys: GuardCategoryKey[] = [
    "secrets",
    "home_address",
    "phone_number",
    "personal_email",
    "live_location",
    "money_figures",
    "health_specifics",
    "family_specifics",
  ];

  return allKeys.map((key) => {
    const def = GUARD_CATEGORIES_CATALOGUE[key];
    let mode = storedModes.get(key) ?? def.defaultMode;
    // secrets key never allows 'open'
    if (key === "secrets" && mode === "open") {
      mode = "never";
    }
    return {
      category: key,
      label: def.label,
      description: def.description,
      mode,
    };
  });
}

/**
 * Updates an owner's category toggle mode.
 */
export async function setOwnerCategoryMode(
  ownerId: string,
  category: GuardCategoryKey,
  mode: GuardCategoryMode,
  requestId?: string,
): Promise<GuardCategoryMode> {
  if (category === "secrets" && mode === "open") {
    throw new Error("Secrets category can only be set to 'never' or 'ask'.");
  }

  const db = getServiceClient();

  // 1. Update in-memory fallback unconditionally
  let memMap = memoryCategories.get(ownerId);
  if (!memMap) {
    memMap = new Map<GuardCategoryKey, GuardCategoryMode>();
    memoryCategories.set(ownerId, memMap);
  }
  memMap.set(category, mode);

  // 2. Resolve agent id if available
  const { data: agent } = await db
    .from("agents")
    .select("id")
    .eq("owner_id", ownerId)
    .maybeSingle();

  // 3. Try upserting to Supabase
  try {
    await db.from("guard_categories").upsert(
      {
        owner_id: ownerId,
        agent_id: agent?.id ?? null,
        category,
        mode,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id,category" },
    );
  } catch (err) {
    if (requestId) {
      logger.warn({
        msg: `Failed to upsert guard_category in Supabase (using memory fallback): ${
          err instanceof Error ? err.message : String(err)
        }`,
        request_id: requestId,
        owner_id: ownerId,
        category,
      });
    }
  }

  return mode;
}
