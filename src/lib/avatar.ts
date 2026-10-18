/**
 * Derives initials from an email address for avatar display.
 * e.g. "alice@example.com" → "A"
 *      "alice.smith@example.com" → "AS"
 */
export function initialsFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[.\-_+]/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return (parts[0]![0] ?? "?").toUpperCase();
  return ((parts[0]![0] ?? "") + (parts[1]![0] ?? "")).toUpperCase();
}

/**
 * Maps a handle/email to one of the 8 locked avatar background colours
 * specified in Prompt 6:
 * #7C6AAE #4E7FA0 #A05B4E #5B8C5A #B0894F #5E7A9C #8A6FA8 #4F8A7A
 */
export const AVATAR_PALETTE = [
  "#7C6AAE",
  "#4E7FA0",
  "#A05B4E",
  "#5B8C5A",
  "#B0894F",
  "#5E7A9C",
  "#8A6FA8",
  "#4F8A7A",
] as const;

export const AVATAR_BG_CLASSES = [
  "bg-q-avatar-0",
  "bg-q-avatar-1",
  "bg-q-avatar-2",
  "bg-q-avatar-3",
  "bg-q-avatar-4",
  "bg-q-avatar-5",
  "bg-q-avatar-6",
  "bg-q-avatar-7",
] as const;

export function avatarColorIndex(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % AVATAR_PALETTE.length;
}

export function avatarBgClass(seed: string): string {
  const index = avatarColorIndex(seed);
  return AVATAR_BG_CLASSES[index] ?? AVATAR_BG_CLASSES[0];
}

export function avatarColor(seed: string): string {
  return AVATAR_PALETTE[avatarColorIndex(seed)]!;
}

/**
 * Derives initials from a handle for avatar display.
 * e.g. "dev_agent" → "DA"
 *      "agent" → "AG"
 *      "@alice" → "AL"
 */
export function initialsFromHandle(handle: string): string {
  const clean = handle.replace(/^@/, "").trim();
  if (!clean) return "?";
  const parts = clean.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    return ((parts[0]![0] ?? "") + (parts[1]![0] ?? "")).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}
