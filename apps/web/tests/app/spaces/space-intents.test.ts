import { describe, expect, it } from "vitest";
import { runSpaceIntent } from "@/app/(app)/spaces/[space]/intents";
import type { Tx } from "@/lib/db";

const SPACE_ID = "10000000-0000-4000-8000-000000000001";
const TEAM_ID = "20000000-0000-4000-8000-000000000002";

/** A pretend transaction: records each query's SQL and values, and answers the few this file needs. No database. */
function fakeTx() {
  const queries: { sql: string; values: unknown[] }[] = [];
  const query = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const sql = strings.join("?");
    queries.push({ sql, values });
    if (sql.includes("from public.spaces where slug")) return Promise.resolve([{ id: SPACE_ID }]);
    if (sql.includes("from public.spaces where id")) return Promise.resolve([{ slug: "acme" }]);
    if (sql.includes("api.create_invite")) return Promise.resolve([{ r: { secret: "s".repeat(43) } }]);
    return Promise.resolve([]);
  };
  // runApi() wraps each api.* call in a savepoint; here the savepoint is the same pretend transaction.
  const tx = Object.assign(query, { savepoint: (fn: (sp: unknown) => unknown) => fn(tx) }) as unknown as Tx;
  return { tx, queries, apiCalls: () => queries.filter((q) => q.sql.includes("api.")) };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("space intents: the optional team picker", () => {
  const invite = { email: "ravi@acme.in", role: "editor" };
  const project = { name: "Web app", slug: "web-app" };

  it("an empty team means no team: the database gets null", async () => {
    for (const [intent, fields] of [["create-invite", invite], ["create-project", project]] as const) {
      const { tx, apiCalls } = fakeTx();
      expect((await runSpaceIntent(tx, "acme", intent, form({ ...fields, team: "" }))).ok, intent).toBe(true);
      expect(apiCalls(), intent).toHaveLength(1);
      expect(apiCalls()[0]!.values, intent).toContain(null);
    }
  });

  it("a real team id is passed on", async () => {
    for (const [intent, fields] of [["create-invite", invite], ["create-project", project]] as const) {
      const { tx, apiCalls } = fakeTx();
      expect((await runSpaceIntent(tx, "acme", intent, form({ ...fields, team: TEAM_ID }))).ok, intent).toBe(true);
      expect(apiCalls()[0]!.values, intent).toContain(TEAM_ID);
    }
  });

  it("a team that is not an id is refused (it used to count as no team), and nothing is created", async () => {
    for (const intent of ["create-invite", "create-project"]) {
      const { tx, apiCalls } = fakeTx();
      const fields = intent === "create-invite" ? invite : project;
      const result = await runSpaceIntent(tx, "acme", intent, form({ ...fields, team: "not-a-team-id" }));
      expect(result, intent).toEqual({ ok: false, reason: "Reload the page and try again." });
      expect(apiCalls(), intent).toEqual([]);
    }
  });

  it("typing mistakes are still reported first", async () => {
    const { tx } = fakeTx();
    const result = await runSpaceIntent(tx, "acme", "create-invite", form({ email: "nope", role: "editor", team: "not-a-team-id" }));
    expect(result).toEqual({ ok: false, reason: "That doesn't look like an email address." });
  });
});
