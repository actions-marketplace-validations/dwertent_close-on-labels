import type { CloseReason, Rule } from "./config";
import { evaluate, matchedLabels } from "./expression";

export interface Item {
  number: number;
  isPullRequest: boolean;
  state: string;
  labels: string[];
}

/** The GitHub calls the action needs. Faked in unit tests. */
export interface Api {
  getItem(number: number): Promise<Item>;
  comment(number: number, body: string): Promise<void>;
  /** `reason` is only sent for issues. */
  close(number: number, reason?: CloseReason): Promise<void>;
  lock(number: number): Promise<void>;
}

export interface Result {
  number: number;
  closed: boolean;
  matchedRule: string;
  matchedLabels: string[];
}

export interface Options {
  number: number;
  rules: Rule[];
  dryRun: boolean;
}

export function renderComment(template: string, rule: string, matched: string[]): string {
  return template
    .replaceAll("{{matched}}", matched.map((label) => `\`${label}\``).join(", "))
    .replaceAll("{{rule}}", rule);
}

export async function execute(options: Options, api: Api, log: (message: string) => void): Promise<Result> {
  const { number, rules, dryRun } = options;
  const item = await api.getItem(number);
  const kind = item.isPullRequest ? "prs" : "issues";
  const what = `${item.isPullRequest ? "Pull request" : "Issue"} #${number}`;
  const none: Result = { number, closed: false, matchedRule: "", matchedLabels: [] };

  if (item.state !== "open") {
    log(`${what} is already ${item.state}, nothing to do`);
    return none;
  }
  log(`${what} has labels: ${item.labels.join(", ") || "(none)"}`);

  const rule = rules.find((r) => (r.target === "all" || r.target === kind) && evaluate(r.when, item.labels));
  if (!rule) {
    log(`No rule matched ${what}`);
    return none;
  }

  const matched = matchedLabels(rule.when, item.labels);
  const result: Result = { number, closed: false, matchedRule: rule.name, matchedLabels: matched };

  if (dryRun) {
    log(`[dry-run] Rule "${rule.name}" matched, would close ${what}`);
    return result;
  }

  if (rule.comment) await api.comment(number, renderComment(rule.comment, rule.name, matched));
  await api.close(number, item.isPullRequest ? undefined : rule.reason);
  if (rule.lock) await api.lock(number);
  log(`Rule "${rule.name}" matched, closed ${what}`);
  return { ...result, closed: true };
}
