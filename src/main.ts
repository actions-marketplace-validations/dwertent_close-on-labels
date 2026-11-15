import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as core from "@actions/core";
import * as github from "@actions/github";
import { execute, type Api } from "./action";
import { buildRules } from "./config";

type Octokit = ReturnType<typeof github.getOctokit>;

function resolveNumber(input: string): number {
  if (input) {
    if (!/^[1-9]\d*$/.test(input)) throw new Error(`number must be a positive integer (got "${input}")`);
    return Number(input);
  }
  const { issue, pull_request: pullRequest } = github.context.payload;
  const number = issue?.number ?? pullRequest?.number;
  if (!number) {
    throw new Error(
      `No issue or pull request in the "${github.context.eventName}" event. Set the \`number\` input.`,
    );
  }
  return number;
}

/** Reads the rules file from the checkout, or from the repository if it was not checked out. */
async function loadRulesFile(octokit: Octokit, path: string): Promise<string> {
  const local = resolve(process.env.GITHUB_WORKSPACE ?? process.cwd(), path);
  if (existsSync(local)) return readFileSync(local, "utf8");

  core.info(`${path} is not in the workspace, reading it from ${github.context.sha}`);
  try {
    const { data } = await octokit.rest.repos.getContent({ ...github.context.repo, path, ref: github.context.sha });
    if (Array.isArray(data) || data.type !== "file") throw new Error("not a file");
    return Buffer.from(data.content, "base64").toString("utf8");
  } catch (error) {
    throw new Error(`Could not read rules-file "${path}": ${(error as Error).message}`);
  }
}

function createApi(octokit: Octokit): Api {
  const repo = github.context.repo;
  return {
    async getItem(number) {
      const { data } = await octokit.rest.issues.get({ ...repo, issue_number: number });
      return {
        number,
        isPullRequest: Boolean(data.pull_request),
        state: data.state,
        labels: data.labels
          .map((label) => (typeof label === "string" ? label : (label.name ?? "")))
          .filter(Boolean),
      };
    },
    async comment(number, body) {
      await octokit.rest.issues.createComment({ ...repo, issue_number: number, body });
    },
    async close(number, reason) {
      await octokit.rest.issues.update({
        ...repo,
        issue_number: number,
        state: "closed",
        ...(reason ? { state_reason: reason } : {}),
      });
    },
    async lock(number) {
      await octokit.rest.issues.lock({ ...repo, issue_number: number });
    },
  };
}

async function main(): Promise<void> {
  const octokit = github.getOctokit(core.getInput("token", { required: true }));
  const rulesPath = core.getInput("rules-file");

  const rules = buildRules(
    {
      labels: core.getInput("labels"),
      operator: core.getInput("operator"),
      expression: core.getInput("expression"),
      target: core.getInput("target"),
      comment: core.getInput("comment"),
      closeReason: core.getInput("close-reason"),
      lock: core.getBooleanInput("lock"),
    },
    rulesPath ? { path: rulesPath, content: await loadRulesFile(octokit, rulesPath) } : undefined,
  );

  const result = await execute(
    { number: resolveNumber(core.getInput("number").trim()), rules, dryRun: core.getBooleanInput("dry-run") },
    createApi(octokit),
    core.info,
  );

  core.setOutput("closed", String(result.closed));
  core.setOutput("matched-rule", result.matchedRule);
  core.setOutput("matched-labels", result.matchedLabels.join(","));
  core.setOutput("number", String(result.number));
}

main().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : String(error));
});
