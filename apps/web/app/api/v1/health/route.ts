// GET /api/v1/health: a quick "is the server up?" check. No database, no login.
export function GET(): Response {
  return Response.json({ ok: true });
}
