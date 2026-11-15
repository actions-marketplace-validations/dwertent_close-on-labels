import { describe, expect, it } from "vitest";
import { evaluate, ExpressionError, fromList, matchedLabels, parse } from "../src/expression";

const check = (expression: string, labels: string[]): boolean => evaluate(parse(expression), labels);

describe("parse + evaluate", () => {
  it("matches a single label", () => {
    expect(check("wontfix", ["wontfix"])).toBe(true);
    expect(check("wontfix", ["bug"])).toBe(false);
    expect(check("wontfix", [])).toBe(false);
  });

  it("handles OR", () => {
    expect(check("a OR b", ["b"])).toBe(true);
    expect(check("a OR b", ["c"])).toBe(false);
  });

  it("handles AND", () => {
    expect(check("a AND b", ["a", "b"])).toBe(true);
    expect(check("a AND b", ["a"])).toBe(false);
  });

  it("handles NOT", () => {
    expect(check("NOT a", [])).toBe(true);
    expect(check("NOT a", ["a"])).toBe(false);
    expect(check("NOT NOT a", ["a"])).toBe(true);
    expect(check("a AND NOT keep", ["a", "keep"])).toBe(false);
    expect(check("a AND NOT keep", ["a"])).toBe(true);
  });

  it("gives AND higher precedence than OR", () => {
    // a OR (b AND c)
    expect(check("a OR b AND c", ["a"])).toBe(true);
    expect(check("a OR b AND c", ["b"])).toBe(false);
    expect(check("a AND b OR c", ["c"])).toBe(true);
  });

  it("gives NOT higher precedence than AND", () => {
    // (NOT a) AND b
    expect(check("NOT a AND b", ["b"])).toBe(true);
    expect(check("NOT a AND b", [])).toBe(false);
  });

  it("respects parentheses", () => {
    expect(check("(a OR b) AND c", ["a"])).toBe(false);
    expect(check("(a OR b) AND c", ["b", "c"])).toBe(true);
    expect(check("NOT (a OR b)", ["b"])).toBe(false);
    expect(check("((a))", ["a"])).toBe(true);
  });

  it("accepts keywords in any case", () => {
    expect(check("a and b or not c", [])).toBe(true);
    expect(check("a And b", ["a", "b"])).toBe(true);
  });

  it("compares labels case-insensitively", () => {
    expect(check("WontFix", ["wontfix"])).toBe(true);
    expect(check("wontfix", ["WONTFIX"])).toBe(true);
  });

  it("supports quoted labels with spaces and keywords", () => {
    expect(check('"good first issue" AND bug', ["good first issue", "bug"])).toBe(true);
    expect(check("'needs info'", ["needs info"])).toBe(true);
    expect(check('"or"', ["or"])).toBe(true);
    expect(check('"a (b)"', ["a (b)"])).toBe(true);
  });

  it("supports punctuation in bare labels", () => {
    expect(check("kind/bug OR priority:high OR v1.2-rc", ["priority:high"])).toBe(true);
  });
});

describe("parse errors", () => {
  const cases: [string, RegExp][] = [
    ["", /empty/i],
    ["   ", /empty/i],
    ["a OR", /expression ended/],
    ["AND a", /found AND/],
    ["a b", /Expected AND or OR before "b"/],
    ["(a OR b", /Missing closing parenthesis/],
    ["a)", /Unexpected "\)"/],
    ['"unterminated', /Unterminated/],
    ['""', /Empty quoted label/],
    ["NOT", /expression ended/],
    ["()", /found "\)"/],
  ];
  it.each(cases)("rejects %j", (expression, message) => {
    expect(() => parse(expression)).toThrow(ExpressionError);
    expect(() => parse(expression)).toThrow(message);
  });

  it("points at the failing position", () => {
    try {
      parse("a OR (b AND");
      expect.unreachable();
    } catch (error) {
      expect((error as ExpressionError).position).toBe(11);
      expect((error as Error).message).toContain("a OR (b AND\n             ^");
    }
  });
});

describe("fromList", () => {
  it("builds OR and AND chains", () => {
    expect(evaluate(fromList(["a", "b", "c"], "or"), ["c"])).toBe(true);
    expect(evaluate(fromList(["a", "b", "c"], "and"), ["a", "b"])).toBe(false);
    expect(evaluate(fromList(["a", "b", "c"], "and"), ["a", "b", "c"])).toBe(true);
  });

  it("does not parse list items as expressions", () => {
    expect(evaluate(fromList(["good first issue", "or"], "and"), ["good first issue", "or"])).toBe(true);
  });

  it("rejects an empty list", () => {
    expect(() => fromList([], "or")).toThrow(/At least one label/);
  });
});

describe("matchedLabels", () => {
  it("returns the wanted labels that are present, with the item's casing", () => {
    expect(matchedLabels(parse("wontfix OR invalid OR duplicate"), ["Invalid", "bug", "duplicate"])).toEqual([
      "Invalid",
      "duplicate",
    ]);
  });

  it("leaves out labels under NOT", () => {
    expect(matchedLabels(parse("a AND NOT keep"), ["a"])).toEqual(["a"]);
    expect(matchedLabels(parse("NOT keep"), ["other"])).toEqual([]);
  });

  it("includes labels under a double NOT", () => {
    expect(matchedLabels(parse("NOT NOT a"), ["a"])).toEqual(["a"]);
  });
});
