import "server-only";
import postgres from "postgres";
import type { VerifiedClaims } from "./claims";

/**
 * The ONE door to the database (DB-DESIGN 10, S1). Nothing else may import "postgres";
 * lib/one-door.test.ts enforces that.
 *
 * We connect as axiomic_server: a login with NO rights of its own (noinherit). Every user
 * query runs inside withUser(), which in one transaction does
 *   set local role authenticated;  set local request.jwt.claims = '<claims>';
 * so row-level security sees exactly that user. "local" = undone at commit/rollback, so
 * nothing leaks to the next request that reuses the pooled connection.
 *
 * Pooler: Supavisor transaction mode (port 6543). It can hand each transaction to a
 * different Postgres connection, so prepared statements are off (prepare: false).
 */

/** Claims for a browser request: the verified Supabase session (lib/auth.ts). */
export type BrowserClaims = VerifiedClaims;

/** Claims for a CLI or agent-key request, built from a resolved Bearer token (lib/tokens.ts). */
export type TokenClaims = {
  sub: string;
  role: "authenticated";
  axm_kind: "cli" | "agent";
  axm_project_id?: string; // agent keys only
};

export type DbClaims = BrowserClaims | TokenClaims;
export type Tx = postgres.TransactionSql;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One pool per server process. Kept on globalThis so Next's dev hot reload doesn't open a new pool per edit.
const g = globalThis as unknown as { __axiomicSql?: postgres.Sql };

function sql(): postgres.Sql {
  if (g.__axiomicSql) return g.__axiomicSql;
  const url = process.env.AXIOMIC_DATABASE_URL;
  if (!url) throw new Error("AXIOMIC_DATABASE_URL is not set");
  g.__axiomicSql = postgres(url, {
    prepare: false, // transaction-mode pooler
    max: Number(process.env.AXIOMIC_DB_POOL_MAX ?? 5), // small: serverless runs many copies
    idle_timeout: 20, // seconds; give connections back to the pooler
    connect_timeout: 10,
    connection: { application_name: "axiomic-web" },
    onnotice: () => {}, // don't print Postgres notices
  });
  return g.__axiomicSql;
}

/**
 * Runs fn as this user, under row-level security, in one transaction.
 * snapshot: every query sees the same moment (repeatable read), e.g. pull reads counters and rules together.
 */
export async function withUser<T>(
  claims: DbClaims,
  fn: (tx: Tx) => Promise<T>,
  opts: { snapshot?: boolean } = {},
): Promise<T> {
  if (!claims || typeof claims.sub !== "string" || !UUID.test(claims.sub) || claims.role !== "authenticated") {
    throw new Error("withUser: refused, no valid user");
  }
  const json = JSON.stringify(claims);
  const mode = opts.snapshot ? "isolation level repeatable read" : "isolation level read committed";
  return (await sql().begin(mode, async (tx) => {
    await tx`set local role authenticated`;
    await tx`select set_config('request.jwt.claims', ${json}, true)`;
    await tx`set local statement_timeout = '10s'`;
    return fn(tx);
  })) as T;
}

/**
 * Runs fn as the bare server login, with no user. It can do almost nothing: only
 * private.resolve_token (who owns this Bearer token?) and reading private.key_canary.
 */
export async function withServer<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return (await sql().begin(async (tx) => {
    await tx`set local statement_timeout = '5s'`;
    return fn(tx);
  })) as T;
}

/** Postgres error code, if this is a database error (e.g. "42501" = permission denied). */
export function pgCode(e: unknown): string | undefined {
  return e instanceof postgres.PostgresError ? e.code : undefined;
}

/** For tests and scripts: close the pool so the process can exit. */
export async function closeDb(): Promise<void> {
  await g.__axiomicSql?.end({ timeout: 5 });
  g.__axiomicSql = undefined;
}
