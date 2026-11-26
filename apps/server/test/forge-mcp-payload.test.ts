import { describe, expect, it } from "vitest";
import { parseStringifiedArguments, payloadValue } from "../src/mcp/forge-mcp.js";

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

describe("parseStringifiedArguments", () => {
  const call = (args: unknown) => ({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "calc_evaluate", arguments: args },
  });

  it("parses object and array arguments that came as JSON strings", () => {
    const out = parseStringifiedArguments(
      call({ state: '{"classId":"c","level":1}', refs: '[{"kind":"gem","id":"g"}]', runId: "r1" }),
    );
    expect(out).toEqual(
      call({ state: { classId: "c", level: 1 }, refs: [{ kind: "gem", id: "g" }], runId: "r1" }),
    );
  });

  it("leaves other messages and plain strings alone", () => {
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { a: "{}" } };
    expect(parseStringifiedArguments(init)).toBe(init);
    expect(parseStringifiedArguments(call({ text: "not json {" }))).toEqual(
      call({ text: "not json {" }),
    );
    expect(parseStringifiedArguments("x")).toBe("x");
  });

  it("handles batches", () => {
    const out = parseStringifiedArguments([call({ state: "{}" })]) as unknown[];
    expect(out).toEqual([call({ state: {} })]);
  });
});
