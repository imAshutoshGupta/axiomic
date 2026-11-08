import { describe, expect, it } from "vitest";
import { merge, titleKey } from "./merge";
import type { LockableRule, MergeInput, Rule } from "./rules";

// Small helpers so each test reads like a sentence.
const rule = (id: string, title: string, body = `${title} text`): Rule => ({ id, title, body });
const lockable = (id: string, title: string, locked = false): LockableRule => ({ ...rule(id, title), locked });
const input = (layers: Partial<MergeInput>): MergeInput => ({
  company: [],
  team: [],
  project: [],
  modules: [],
  personal: [],
  ...layers,
});
/** Just the ids of the main list, in order: easy to compare. */
const ids = (i: MergeInput) => merge(i).main.map((r) => r.id);

describe("titleKey", () => {
  it("ignores case and extra spaces", () => {
    expect(titleKey("  Code   Style ")).toBe(titleKey("code style"));
  });

  it("ignores invisible characters", () => {
    expect(titleKey("Dep​loys")).toBe(titleKey("Deploys"));
  });
});

describe("merge: adding and replacing", () => {
  it("keeps rules with different titles, widest layer first", () => {
    const result = input({
      company: [lockable("c1", "Security")],
      team: [lockable("t1", "Reviews")],
      project: [rule("p1", "Testing")],
      personal: [rule("me1", "Answer style")],
    });
    expect(ids(result)).toEqual(["c1", "t1", "p1", "me1"]);
  });

  it("lets a project rule replace a team rule with the same title", () => {
    const result = input({
      team: [lockable("t1", "Indentation")],
      project: [rule("p1", "indentation")],
    });
    expect(ids(result)).toEqual(["p1"]);
  });

  it("lets a team rule replace an unlocked company rule", () => {
    const result = input({
      company: [lockable("c1", "Indentation")],
      team: [lockable("t1", "Indentation")],
    });
    expect(ids(result)).toEqual(["t1"]);
  });

  it("keeps two rules with the same title in the same layer", () => {
    const result = input({ project: [rule("p1", "Testing"), rule("p2", "Testing")] });
    expect(ids(result)).toEqual(["p1", "p2"]);
  });

  it("records which layer each rule came from", () => {
    const { main } = merge(input({ team: [lockable("t1", "Reviews")], project: [rule("p1", "Testing")] }));
    expect(main.map((r) => r.source)).toEqual(["team", "project"]);
  });
});

describe("merge: locks", () => {
  it("blocks a team or project rule that tries to replace a locked company rule", () => {
    const result = merge(
      input({
        company: [lockable("c1", "Deploys", true)],
        team: [lockable("t1", "Deploys")],
        project: [rule("p1", "DEPLOYS")],
      }),
    );
    expect(result.main.map((r) => r.id)).toEqual(["c1"]);
    expect(result.blocked).toEqual([
      { ruleId: "t1", source: "team", title: "Deploys", blockedById: "c1", reason: "locked" },
      { ruleId: "p1", source: "project", title: "DEPLOYS", blockedById: "c1", reason: "locked" },
    ]);
  });

  it("can't be fooled by an invisible character in the title", () => {
    const result = merge(input({ team: [lockable("t1", "Deploys", true)], project: [rule("p1", "Dep​loys")] }));
    expect(result.blocked.map((b) => b.ruleId)).toEqual(["p1"]);
  });

  it("marks locked rules mandatory without moving them above a wider layer", () => {
    const { main } = merge(
      input({
        company: [lockable("c1", "Security")],
        team: [lockable("t1", "Deploys", true)],
      }),
    );
    expect(main.map((r) => [r.id, r.mandatory])).toEqual([
      ["c1", false],
      ["t1", true],
    ]);
  });

  it("puts locked rules first inside the same layer", () => {
    const { main } = merge(input({ team: [lockable("t1", "Reviews"), lockable("t2", "Deploys", true)] }));
    expect(main.map((r) => r.id)).toEqual(["t2", "t1"]);
  });

  it("ignores a 'locked' flag on a project rule (only company and team can lock)", () => {
    const sneaky = { ...rule("p1", "Testing"), locked: true };
    const result = merge(input({ project: [sneaky], personal: [rule("me1", "Other")] }));
    expect(result.main.find((r) => r.id === "p1")?.mandatory).toBe(false);
  });
});

describe("merge: personal rules only add", () => {
  it("adds a personal rule on a new topic", () => {
    expect(ids(input({ project: [rule("p1", "Testing")], personal: [rule("me1", "Answer style")] }))).toEqual([
      "p1",
      "me1",
    ]);
  });

  it("blocks a personal rule that tries to replace an unlocked work rule", () => {
    const result = merge(input({ team: [lockable("t1", "Testing")], personal: [rule("me1", "testing")] }));
    expect(result.main.map((r) => r.id)).toEqual(["t1"]);
    expect(result.blocked).toEqual([
      { ruleId: "me1", source: "personal", title: "testing", blockedById: "t1", reason: "personal-adds-only" },
    ]);
  });

  it("points a blocked personal rule at the locked rule when there is one", () => {
    const result = merge(input({ team: [lockable("t1", "Deploys", true)], personal: [rule("me1", "Deploys")] }));
    expect(result.blocked[0]?.blockedById).toBe("t1");
  });
});

describe("merge: output", () => {
  it("doesn't copy unknown fields from the input", () => {
    const withExtra = { ...rule("p1", "Testing"), secretNote: "internal" };
    const { main } = merge(input({ project: [withExtra] }));
    expect(main[0]).toEqual({ id: "p1", title: "Testing", body: "Testing text", source: "project", mandatory: false });
  });
});

describe("merge: order", () => {
  it("always puts company rules before team, project and personal rules", () => {
    const result = input({
      personal: [rule("me1", "Answer style")],
      project: [rule("p1", "Testing")],
      team: [lockable("t1", "Reviews")],
      company: [lockable("c1", "Security")],
    });
    expect(ids(result)).toEqual(["c1", "t1", "p1", "me1"]);
  });

  it("puts locked company rules before locked team rules", () => {
    const { main } = merge(
      input({ company: [lockable("c1", "Security", true)], team: [lockable("t1", "Deploys", true)] }),
    );
    expect(main.map((r) => r.id)).toEqual(["c1", "t1"]);
  });
});

const folder = (id: string, path: string, rules: Rule[]) => ({ id, name: id, path, rules });

describe("merge: folder (module) rules", () => {
  it("puts folder rules in their own list, not the main one", () => {
    const result = merge(input({ modules: [folder("payments", "src/payments", [rule("m1", "Money")])] }));
    expect(result.main).toEqual([]);
    expect(result.modules).toEqual([
      {
        id: "payments",
        name: "payments",
        path: "src/payments",
        rules: [{ id: "m1", title: "Money", body: "Money text", source: "module", mandatory: false }],
      },
    ]);
  });

  it("keeps the project rule for everywhere else when a folder uses the same title", () => {
    const result = merge(
      input({
        project: [rule("p1", "Testing")],
        modules: [folder("payments", "src/payments", [rule("m1", "Testing")])],
      }),
    );
    expect(result.main.map((r) => r.id)).toEqual(["p1"]);
    expect(result.modules[0]?.rules.map((r) => r.id)).toEqual(["m1"]);
    expect(result.blocked).toEqual([]);
  });

  it("blocks a folder rule that clashes with a locked rule", () => {
    const result = merge(
      input({
        company: [lockable("c1", "Deploys", true)],
        modules: [folder("payments", "src/payments", [rule("m1", "Deploys"), rule("m2", "Money")])],
      }),
    );
    expect(result.modules[0]?.rules.map((r) => r.id)).toEqual(["m2"]);
    expect(result.blocked).toEqual([
      { ruleId: "m1", source: "module", title: "Deploys", blockedById: "c1", reason: "locked" },
    ]);
  });

  it("leaves out a folder whose rules were all blocked", () => {
    const result = merge(
      input({
        team: [lockable("t1", "Deploys", true)],
        modules: [folder("payments", "src/payments", [rule("m1", "Deploys")])],
      }),
    );
    expect(result.modules).toEqual([]);
  });

  it("blocks a personal rule that shares a title with any folder rule, for the whole project", () => {
    const result = merge(
      input({
        modules: [folder("payments", "src/payments", [rule("m1", "Testing")])],
        personal: [rule("me1", "testing")],
      }),
    );
    expect(result.main).toEqual([]);
    expect(result.blocked).toEqual([
      { ruleId: "me1", source: "personal", title: "testing", blockedById: "m1", reason: "personal-adds-only" },
    ]);
  });

  it("keeps folders inside folders as separate lists", () => {
    const result = merge(
      input({
        modules: [
          folder("payments", "src/payments", [rule("m1", "Testing")]),
          folder("refunds", "src/payments/refunds", [rule("m2", "Testing")]),
        ],
      }),
    );
    expect(result.modules.map((m) => [m.path, m.rules.map((r) => r.id)])).toEqual([
      ["src/payments", ["m1"]],
      ["src/payments/refunds", ["m2"]],
    ]);
  });
});
