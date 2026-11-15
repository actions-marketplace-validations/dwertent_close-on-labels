import { parse as parseYaml } from "yaml";
import { fromList, parse, type Node } from "./expression";

export type Target = "issues" | "prs" | "all";
export type CloseReason = "completed" | "not_planned";

export interface Rule {
  name: string;
  when: Node;
  target: Target;
  reason: CloseReason;
  comment: string;
  lock: boolean;
}

/** Raw action inputs, as strings, before validation. */
export interface RawInputs {
  labels: string;
  operator: string;
  expression: string;
  target: string;
  comment: string;
  closeReason: string;
  lock: boolean;
}

interface Defaults {
  target: Target;
  reason: CloseReason;
  comment: string;
  lock: boolean;
}

const TARGETS: readonly Target[] = ["issues", "prs", "all"];
const REASONS: readonly CloseReason[] = ["completed", "not_planned"];
const RULE_KEYS = ["name", "when", "labels", "operator", "target", "reason", "comment", "lock"];

export function parseList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], what: string): T {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;
  if (allowed.includes(normalized as T)) return normalized as T;
  throw new Error(`${what} must be one of ${allowed.join(", ")} (got ${JSON.stringify(value)})`);
}

function parseOperator(value: unknown, what: string): "and" | "or" {
  return oneOf(value, ["and", "or"] as const, what);
}

/**
 * Builds the ordered rule list: the inline rule (if any) first, then the
 * rules from the file. The first rule that matches wins.
 */
export function buildRules(inputs: RawInputs, rulesFile?: { path: string; content: string }): Rule[] {
  const defaults: Defaults = {
    target: oneOf(inputs.target, TARGETS, "target"),
    reason: oneOf(inputs.closeReason, REASONS, "close-reason"),
    comment: inputs.comment,
    lock: inputs.lock,
  };

  const rules: Rule[] = [];
  const labels = parseList(inputs.labels);
  const expression = inputs.expression.trim();

  if (labels.length > 0 && expression) {
    throw new Error("Use either `labels` or `expression`, not both");
  }
  if (labels.length > 0) {
    rules.push({ name: "inline", when: fromList(labels, parseOperator(inputs.operator, "operator")), ...defaults });
  } else if (expression) {
    rules.push({ name: "inline", when: parse(expression), ...defaults });
  }

  if (rulesFile) rules.push(...parseRulesFile(rulesFile.content, rulesFile.path, defaults));

  if (rules.length === 0) {
    throw new Error("No rules: set `labels`, `expression` or `rules-file`");
  }
  return rules;
}

export function parseRulesFile(content: string, path: string, defaults: Defaults): Rule[] {
  let doc: unknown;
  try {
    doc = parseYaml(content);
  } catch (error) {
    throw new Error(`${path}: invalid YAML: ${(error as Error).message}`);
  }
  if (!isRecord(doc) || !Array.isArray(doc.rules) || doc.rules.length === 0) {
    throw new Error(`${path}: expected a non-empty \`rules\` list`);
  }

  const seen = new Set<string>();
  return doc.rules.map((raw: unknown, index: number): Rule => {
    const where = `${path}: rules[${index}]`;
    if (!isRecord(raw)) throw new Error(`${where} must be a mapping`);

    const unknown = Object.keys(raw).filter((key) => !RULE_KEYS.includes(key));
    if (unknown.length > 0) {
      throw new Error(`${where} has unknown key(s): ${unknown.join(", ")} (allowed: ${RULE_KEYS.join(", ")})`);
    }

    const name = raw.name === undefined ? `rule-${index + 1}` : String(raw.name).trim();
    if (!name) throw new Error(`${where}: \`name\` is empty`);
    if (seen.has(name)) throw new Error(`${where}: duplicate rule name "${name}"`);
    seen.add(name);
    const label = `${where} (${name})`;

    const hasWhen = raw.when !== undefined;
    const hasLabels = raw.labels !== undefined;
    if (hasWhen === hasLabels) {
      throw new Error(`${label}: set exactly one of \`when\` or \`labels\``);
    }

    let when: Node;
    if (hasWhen) {
      if (typeof raw.when !== "string") throw new Error(`${label}: \`when\` must be a string`);
      if (raw.operator !== undefined) throw new Error(`${label}: \`operator\` only applies to \`labels\``);
      try {
        when = parse(raw.when);
      } catch (error) {
        throw new Error(`${label}: ${(error as Error).message}`);
      }
    } else {
      const list = Array.isArray(raw.labels)
        ? raw.labels.map((item) => String(item).trim()).filter(Boolean)
        : parseList(String(raw.labels));
      if (list.length === 0) throw new Error(`${label}: \`labels\` is empty`);
      when = fromList(list, parseOperator(raw.operator ?? "or", `${label}: operator`));
    }

    if (raw.comment !== undefined && typeof raw.comment !== "string") {
      throw new Error(`${label}: \`comment\` must be a string`);
    }
    if (raw.lock !== undefined && typeof raw.lock !== "boolean") {
      throw new Error(`${label}: \`lock\` must be true or false`);
    }

    return {
      name,
      when,
      target: raw.target === undefined ? defaults.target : oneOf(raw.target, TARGETS, `${label}: target`),
      reason: raw.reason === undefined ? defaults.reason : oneOf(raw.reason, REASONS, `${label}: reason`),
      comment: raw.comment ?? defaults.comment,
      lock: raw.lock ?? defaults.lock,
    };
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
