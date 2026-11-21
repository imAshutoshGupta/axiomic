import { promises as fs } from "node:fs";
import path from "node:path";
import { merge, renderClaude, renderIndex } from "@axiomic/shared";
import { describe, expect, it } from "vitest";
import { writeCredentials } from "../../src/server/credentials";
import { diffLines, formatDiff } from "../../src/utils/line-diff";
import { diffProject } from "../../src/commands/diff";
import type { ProjectDeps } from "../../src/commands/linked-project";
import { pullProject } from "../../src/commands/pull";
import { pushEdits } from "../../src/commands/push";
import { writeProjectConfig } from "../../src/project/project-config";
import { fakeServer, fakeToken, makeSandbox, type FakeRoute, type Sandbox } from "../helpers/test-helpers";

const API = "https://axiomic.example";
const MAIN = ".claude/rules/axiomic.md";
const MOD = ".claude/rules/axiomic-payments.md";
const ID = (n: number) => `50000000-0000-4000-8000-00000000000${n}`;

/** A realistic server answer: the real merge + renderer + index, like the server builds it. */
function serverAnswer(projectBody = "Use Vitest.\n\n# Details\nTest behaviour.", marker = 1) {
  const result = merge({
    company: [{ id: ID(1), title: "Security", body: "Never commit secrets.", locked: true }],
    team: [],
    project: [{ id: ID(2), title: "Testing", body: projectBody }],
    modules: [{ id: "m1", name: "payments", path: "src/payments", rules: [{ id: ID(3), title: "Money", body: "Amounts in paise." }] }],
    personal: [],
  });
  return {
    project: { id: "p", name: "Web app", slug: "web-app", space: "acme" },
    versions: { space: 1, team: 0, personal: 0 },
    files: renderClaude(result, marker),
    rules: renderIndex(result).map((r) => ({ path: r.path, id: r.ruleId, layer: r.layer, version: 4, title: r.title })),
    blocked: [],
  };
}

async function setup(extra: Record<string, FakeRoute> = {}, answer = serverAnswer()) {
  const box = await makeSandbox();
  await writeCredentials(box.dirs.config, { schemaVersion: 1, token: fakeToken("t"), apiUrl: API });
  await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
  const server = fakeServer({ "GET /api/v1/pull": () => ({ status: 200, body: answer }), ...extra });
  const deps: ProjectDeps = { fetch: server.fetch, env: box.env, cwd: box.project, dirs: box.dirs };
  await pullProject(deps);
  return { box, server, deps };
}

const file = (box: Sandbox, rel: string) => path.join(box.project, rel);
const edit = async (box: Sandbox, rel: string, from: string, to: string) => {
  const text = await fs.readFile(file(box, rel), "utf8");
  if (!text.includes(from)) throw new Error(`test setup: "${from}" not in ${rel}`);
  await fs.writeFile(file(box, rel), text.replace(from, to));
};

describe("push: working out what changed", () => {
  it("nothing edited → nothing to send", async () => {
    const { deps } = await setup();
    expect((await pushEdits(deps, { send: false })).plan.changes).toEqual([]);
  });

  it("an edited section → an update of that rule, with the version you pulled and headings pulled back up", async () => {
    const { deps, box } = await setup();
    await edit(box, MAIN, "Use Vitest.", "Use Vitest. Mock the network.");
    const { plan, results } = await pushEdits(deps, { send: false });
    expect(results).toBeUndefined(); // preview only
    expect(plan.changes).toEqual([
      { kind: "update", ruleId: ID(2), baseVersion: 4, title: "Testing", layer: "project", path: MAIN, body: "Use Vitest. Mock the network.\n\n# Details\nTest behaviour." },
    ]);
  });

  it("a new section under a layer heading → a new rule in that layer; in a folder file → a folder rule", async () => {
    const { deps, box } = await setup();
    await edit(box, MAIN, "### Testing", "### Reviews\n\nTwo approvals.\n\n### Testing");
    await fs.appendFile(file(box, MOD), "\n### Refunds\n\nWithin 7 days.\n");
    const { plan } = await pushEdits(deps, { send: false });
    expect(plan.changes).toEqual([
      { kind: "create", layer: "project", title: "Reviews", body: "Two approvals.", path: MAIN },
      { kind: "create", layer: "module", module: "payments", title: "Refunds", body: "Within 7 days.", path: MOD },
    ]);
  });

  it("a deleted section and an edited intro are NOT sent, only noted", async () => {
    const { deps, box } = await setup();
    await edit(box, MAIN, "# Rules from axiomic", "# My rules");
    const text = await fs.readFile(file(box, MOD), "utf8");
    await fs.writeFile(file(box, MOD), text.slice(0, text.indexOf("### Money")));
    const { plan } = await pushEdits(deps, { send: false });
    expect(plan.changes).toEqual([]);
    expect(plan.notes.join("\n")).toMatch(/"Money" was deleted or renamed/);
    expect(plan.notes.join("\n")).toMatch(/outside the "### " sections/);
  });

  it("an edit to a MANDATORY rule is matched to the rule (the label isn't part of the title)", async () => {
    const { deps, box } = await setup();
    await edit(box, MAIN, "Never commit secrets.", "Never commit secrets or keys.");
    expect((await pushEdits(deps, { send: false })).plan.changes[0]).toMatchObject({ kind: "update", ruleId: ID(1), title: "Security" });
  });
});

describe("push --yes", () => {
  it("sends the changes in one request, shows each result, then pulls", async () => {
    let sent: unknown;
    const { deps, box, server } = await setup({
      "POST /api/v1/push": (req) => ((sent = req.body), { status: 200, body: { results: [{ status: "suggested", suggestionId: "s1" }] } }),
    });
    await edit(box, MAIN, "Use Vitest.", "Use Vitest. Mock the network.");
    const out = await pushEdits(deps, { send: true });
    expect(sent).toMatchObject({ space: "acme", project: "web-app", changes: [{ kind: "update", ruleId: ID(2), baseVersion: 4 }] });
    expect(out.results).toEqual([{ status: "suggested", suggestionId: "s1" }]);
    expect(server.seen.at(-1)!.url).toContain("/api/v1/pull"); // pulled afterwards
    expect(out.after!.report.keptModified).toEqual([MAIN]); // the edit stays until decided
  });

  it("all saved: the file is refreshed from the server, not kept as 'edited' (even though the version line changed)", async () => {
    let answer = serverAnswer();
    const box = await makeSandbox();
    await writeCredentials(box.dirs.config, { schemaVersion: 1, token: fakeToken("t"), apiUrl: API });
    await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    const server = fakeServer({
      "GET /api/v1/pull": () => ({ status: 200, body: answer }),
      "POST /api/v1/push": () => {
        answer = { ...serverAnswer("Use Vitest. Mock the network.\n\n# Details\nTest behaviour.", 2), versions: { space: 2, team: 0, personal: 0 } };
        return { status: 200, body: { results: [{ status: "saved", ruleId: ID(2), version: 5 }] } };
      },
    });
    const deps: ProjectDeps = { fetch: server.fetch, env: box.env, cwd: box.project, dirs: box.dirs };
    await pullProject(deps);
    await edit(box, MAIN, "Use Vitest.", "Use Vitest. Mock the network.");
    const out = await pushEdits(deps, { send: true });
    expect(out.after!.report.keptModified).toEqual([]);
    expect(out.after!.report.written).toEqual([MAIN, MOD]); // the version line changed in both
    const text = await fs.readFile(file(box, MAIN), "utf8");
    expect(text).toContain("Mock the network.");
    expect(text).toContain("(version 2)");
  });

  it("without a pull first: a clear error", async () => {
    const box = await makeSandbox();
    await writeCredentials(box.dirs.config, { schemaVersion: 1, token: fakeToken("t"), apiUrl: API });
    await writeProjectConfig(box.project, { schemaVersion: 1, space: "acme", project: "web-app" });
    await expect(pushEdits({ fetch: fakeServer({}).fetch, env: box.env, cwd: box.project, dirs: box.dirs }, { send: true })).rejects.toThrow(/axiomic pull/);
  });
});

describe("diff", () => {
  it("no difference → empty; asks the server with dry=1 (not recorded as a pull)", async () => {
    const { deps, server } = await setup();
    expect((await diffProject(deps)).files).toEqual([]);
    expect(server.seen.at(-1)!.url).toContain("dry=1");
  });

  it("shows the changed lines: - server, + yours", async () => {
    const { deps, box } = await setup();
    await edit(box, MAIN, "Use Vitest.", "Use Jest.");
    const out = await diffProject(deps);
    expect(out.files).toHaveLength(1);
    expect(out.files[0]!.text).toContain("- Use Vitest.");
    expect(out.files[0]!.text).toContain("+ Use Jest.");
  });

  it("a file deleted locally shows as only on the server", async () => {
    const { deps, box } = await setup();
    await fs.rm(file(box, MOD));
    expect((await diffProject(deps)).files).toEqual([{ path: MOD, state: "only-server" }]);
  });
});

describe("diffLines", () => {
  it("finds the changed line and keeps the rest", () => {
    const ops = diffLines("a\nb\nc", "a\nB\nc")!;
    expect(formatDiff(ops)).toBe("  a\n- b\n+ B\n  c");
  });
  it("gives up (undefined) on huge files rather than use a lot of memory", () => {
    expect(diffLines("x\n".repeat(4000), "y")).toBeUndefined();
  });
});
