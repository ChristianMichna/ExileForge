import { describe, expect, it } from "vitest";
import { payloadValue } from "../src/mcp/forge-mcp.js";

describe("payloadValue", () => {
  it("passes objects and arrays through", () => {
    const value = { a: 1 };
    expect(payloadValue(value)).toBe(value);
    expect(payloadValue([1, 2])).toEqual([1, 2]);
  });

  it("parses a string holding a JSON object or array", () => {
    expect(payloadValue('{"mainSkillId":"x","rationale":[]}')).toEqual({
      mainSkillId: "x",
      rationale: [],
    });
    expect(payloadValue("[1,2]")).toEqual([1, 2]);
  });

  it("leaves other strings alone so the schema check reports them", () => {
    expect(payloadValue("hello")).toBe("hello");
    expect(payloadValue("42")).toBe("42");
    expect(payloadValue("null")).toBe("null");
    expect(payloadValue("{broken")).toBe("{broken");
  });
});
