import { describe, expect, it } from "vitest";
import { buildRules, parseList, type RawInputs } from "../src/config";
import { evaluate } from "../src/expression";

const inputs = (overrides: Partial<RawInputs> = {}): RawInputs => ({
  labels: "",
  operator: "OR",
  expression: "",
  target: "all",
  comment: "",
  closeReason: "not_planned",
  lock: false,
  ...overrides,
});

const file = (content: string) => ({ path: "rules.yml", content });

describe("parseList", () => {
  it("splits on commas and newlines and trims", () => {
    expect(parseList(" a, b\n c ,,\n\n good first issue ")).toEqual(["a", "b", "c", "good first issue"]);
    expect(parseList("")).toEqual([]);
  });
});

describe("inline rules", () => {
  it("builds an OR rule from labels by default", () => {
    const [rule] = buildRules(inputs({ labels: "wontfix, invalid" }));
    expect(rule).toMatchObject({ name: "inline", target: "all", reason: "not_planned", comment: "", lock: false });
    expect(evaluate(rule!.when, ["invalid"])).toBe(true);
    expect(evaluate(rule!.when, ["bug"])).toBe(false);
  });

  it("builds an AND rule", () => {
    const [rule] = buildRules(inputs({ labels: "a\nb", operator: "and" }));
    expect(evaluate(rule!.when, ["a"])).toBe(false);
    expect(evaluate(rule!.when, ["a", "b"])).toBe(true);
  });

  it("builds a rule from an expression", () => {
    const [rule] = buildRules(inputs({ expression: "a AND NOT b", target: "prs", closeReason: "completed" }));
    expect(rule).toMatchObject({ target: "prs", reason: "completed" });
    expect(evaluate(rule!.when, ["a"])).toBe(true);
  });

  it("rejects labels together with expression", () => {
    expect(() => buildRules(inputs({ labels: "a", expression: "b" }))).toThrow(/not both/);
  });

  it("rejects missing rules", () => {
    expect(() => buildRules(inputs())).toThrow(/No rules/);
  });

  it("rejects bad enums", () => {
    expect(() => buildRules(inputs({ labels: "a", operator: "XOR" }))).toThrow(/operator must be one of and, or/);
    expect(() => buildRules(inputs({ labels: "a", target: "both" }))).toThrow(/target must be one of issues, prs, all/);
    expect(() => buildRules(inputs({ labels: "a", closeReason: "spam" }))).toThrow(/close-reason must be one of/);
  });
});

describe("rules file", () => {
  it("loads rules and applies input defaults", () => {
    const rules = buildRules(
      inputs({ comment: "default comment", target: "issues" }),
      file(`
rules:
  - name: rejected
    when: "wontfix OR invalid"
  - name: superseded
    labels: [duplicate, has-replacement]
    operator: AND
    target: prs
    reason: completed
    comment: "Superseded ({{matched}})"
    lock: true
  - labels: stale, abandoned
`),
    );
    expect(rules.map((r) => r.name)).toEqual(["rejected", "superseded", "rule-3"]);
    expect(rules[0]).toMatchObject({ target: "issues", reason: "not_planned", comment: "default comment", lock: false });
    expect(rules[1]).toMatchObject({ target: "prs", reason: "completed", comment: "Superseded ({{matched}})", lock: true });
    expect(evaluate(rules[1]!.when, ["duplicate"])).toBe(false);
    expect(evaluate(rules[1]!.when, ["duplicate", "has-replacement"])).toBe(true);
    expect(evaluate(rules[2]!.when, ["abandoned"])).toBe(true);
  });

  it("puts the inline rule before file rules", () => {
    const rules = buildRules(inputs({ labels: "a" }), file("rules:\n  - name: from-file\n    when: b\n"));
    expect(rules.map((r) => r.name)).toEqual(["inline", "from-file"]);
  });

  it("lets a rule turn off the default comment", () => {
    const [rule] = buildRules(inputs({ comment: "default" }), file('rules:\n  - when: a\n    comment: ""\n'));
    expect(rule!.comment).toBe("");
  });

  const bad: [string, string, RegExp][] = [
    ["invalid YAML", "rules: [", /invalid YAML/],
    ["missing rules", "other: 1", /non-empty `rules` list/],
    ["empty rules", "rules: []", /non-empty `rules` list/],
    ["non-mapping rule", "rules:\n  - just a string", /must be a mapping/],
    ["neither when nor labels", "rules:\n  - name: x", /exactly one of `when` or `labels`/],
    ["both when and labels", "rules:\n  - when: a\n    labels: [a]", /exactly one of/],
    ["operator with when", "rules:\n  - when: a\n    operator: AND", /only applies to `labels`/],
    ["unknown key", "rules:\n  - when: a\n    wen: b", /unknown key\(s\): wen/],
    ["bad expression", "rules:\n  - name: broken\n    when: a OR", /rules\[0\] \(broken\): .*expression ended/s],
    ["bad target", "rules:\n  - when: a\n    target: both", /target must be one of/],
    ["bad reason", "rules:\n  - when: a\n    reason: spam", /reason must be one of/],
    ["bad lock", "rules:\n  - when: a\n    lock: maybe", /`lock` must be true or false/],
    ["empty labels", "rules:\n  - labels: []", /`labels` is empty/],
    ["duplicate names", "rules:\n  - name: x\n    when: a\n  - name: x\n    when: b", /duplicate rule name "x"/],
  ];
  it.each(bad)("rejects %s", (_title, content, message) => {
    expect(() => buildRules(inputs(), file(content))).toThrow(message);
    expect(() => buildRules(inputs(), file(content))).toThrow(/^rules\.yml: /);
  });
});
