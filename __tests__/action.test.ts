import { describe, expect, it } from "vitest";
import { execute, renderComment, type Api, type Item } from "../src/action";
import { buildRules, type RawInputs } from "../src/config";

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

function fake(item: Partial<Item>) {
  const calls: unknown[][] = [];
  const api: Api = {
    getItem: async (number) => ({ number, isPullRequest: false, state: "open", labels: [], ...item }),
    comment: async (number, body) => void calls.push(["comment", number, body]),
    close: async (number, reason) => void calls.push(["close", number, reason]),
    lock: async (number) => void calls.push(["lock", number]),
  };
  return { api, calls };
}

const run = (item: Partial<Item>, raw: Partial<RawInputs>, extra: { dryRun?: boolean; file?: string } = {}) => {
  const { api, calls } = fake(item);
  const rules = buildRules(inputs(raw), extra.file ? { path: "rules.yml", content: extra.file } : undefined);
  return execute({ number: 7, rules, dryRun: extra.dryRun ?? false }, api, () => {}).then((result) => ({
    result,
    calls,
  }));
};

describe("execute", () => {
  it("closes an issue when a label matches", async () => {
    const { result, calls } = await run({ labels: ["bug", "wontfix"] }, { labels: "wontfix, invalid" });
    expect(result).toEqual({ number: 7, closed: true, matchedRule: "inline", matchedLabels: ["wontfix"] });
    expect(calls).toEqual([["close", 7, "not_planned"]]);
  });

  it("does nothing when no label matches", async () => {
    const { result, calls } = await run({ labels: ["bug"] }, { labels: "wontfix" });
    expect(result).toEqual({ number: 7, closed: false, matchedRule: "", matchedLabels: [] });
    expect(calls).toEqual([]);
  });

  it("requires every label with AND", async () => {
    const raw = { labels: "a, b", operator: "AND" };
    expect((await run({ labels: ["a"] }, raw)).calls).toEqual([]);
    expect((await run({ labels: ["a", "b"] }, raw)).result.closed).toBe(true);
  });

  it("comments, closes, then locks, in that order", async () => {
    const { calls } = await run(
      { labels: ["invalid"] },
      { labels: "invalid", comment: "Closed by {{rule}}: {{matched}}", lock: true, closeReason: "completed" },
    );
    expect(calls).toEqual([
      ["comment", 7, "Closed by inline: `invalid`"],
      ["close", 7, "completed"],
      ["lock", 7],
    ]);
  });

  it("does not send a close reason for pull requests", async () => {
    const { calls } = await run({ labels: ["wontfix"], isPullRequest: true }, { labels: "wontfix" });
    expect(calls).toEqual([["close", 7, undefined]]);
  });

  it("respects target", async () => {
    const issue = { labels: ["x"] };
    const pr = { labels: ["x"], isPullRequest: true };
    expect((await run(issue, { labels: "x", target: "prs" })).result.closed).toBe(false);
    expect((await run(pr, { labels: "x", target: "prs" })).result.closed).toBe(true);
    expect((await run(issue, { labels: "x", target: "issues" })).result.closed).toBe(true);
    expect((await run(pr, { labels: "x", target: "issues" })).result.closed).toBe(false);
  });

  it("skips items that are already closed", async () => {
    const { result, calls } = await run({ labels: ["wontfix"], state: "closed" }, { labels: "wontfix" });
    expect(result.closed).toBe(false);
    expect(calls).toEqual([]);
  });

  it("reports the match but changes nothing in dry-run", async () => {
    const { result, calls } = await run(
      { labels: ["wontfix"] },
      { labels: "wontfix", comment: "bye", lock: true },
      { dryRun: true },
    );
    expect(result).toEqual({ number: 7, closed: false, matchedRule: "inline", matchedLabels: ["wontfix"] });
    expect(calls).toEqual([]);
  });

  it("uses the first matching rule and skips rules for another target", async () => {
    const file = `
rules:
  - name: prs-only
    when: stale
    target: prs
  - name: second
    when: stale AND NOT keep-open
    reason: completed
  - name: third
    when: stale
`;
    const { result, calls } = await run({ labels: ["stale"] }, {}, { file });
    expect(result.matchedRule).toBe("second");
    expect(calls).toEqual([["close", 7, "completed"]]);

    const kept = await run({ labels: ["stale", "keep-open"] }, {}, { file });
    expect(kept.result.matchedRule).toBe("third");
  });
});

describe("renderComment", () => {
  it("replaces every placeholder", () => {
    expect(renderComment("{{rule}}/{{rule}}: {{matched}}", "r", ["a", "b c"])).toBe("r/r: `a`, `b c`");
  });
});
