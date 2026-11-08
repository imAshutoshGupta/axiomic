import { describe, expect, it } from "vitest";
import { LAYERS } from "./layers";

describe("LAYERS", () => {
  it("lists layers from widest to narrowest", () => {
    expect(LAYERS).toEqual(["company", "team", "project", "module", "personal"]);
  });
});
