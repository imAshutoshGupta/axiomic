/**
 * The 8-character code `axiomic login` shows, e.g. "ABCD-1234" (DB-DESIGN 6.15).
 * Same alphabet as api.start_device_login: no I, O, 0 or 1, so nothing can be misread.
 * "abcd1234", "ABCD-1234", " abcd-1234 " → "ABCD-1234"; anything else → null.
 */
export function normalizeUserCode(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 20) return null;
  const s = raw.toUpperCase().replace(/[\s-]/g, "");
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
}
