# Close on Labels

A GitHub Action that closes issues and pull requests when their labels match a rule.

- Labels inline in the workflow, or rules in a YAML file
- `OR`, `AND`, `NOT` and parentheses
- Optional comment, close reason and lock
- Dry-run mode

## Quick start

Close anything labeled `wontfix` or `invalid`:

```yaml
name: Close on labels
on:
  issues:
    types: [labeled]
  pull_request_target:
    types: [labeled]

permissions:
  issues: write
  pull-requests: write

jobs:
  close:
    runs-on: ubuntu-latest
    steps:
      - uses: dwertent/close-on-labels@v1
        with:
          labels: wontfix, invalid
          comment: "Closing because this was labeled {{matched}}."
```

Require all labels instead of any:

```yaml
      - uses: dwertent/close-on-labels@v1
        with:
          labels: duplicate, has-replacement
          operator: AND
```

Use an expression:

```yaml
      - uses: dwertent/close-on-labels@v1
        with:
          expression: (wontfix OR invalid) AND NOT keep-open
```

## Rules file

For more than one rule, put them in a file:

```yaml
      - uses: dwertent/close-on-labels@v1
        with:
          rules-file: .github/close-rules.yml
```

```yaml
# .github/close-rules.yml
rules:
  - name: rejected
    when: (wontfix OR invalid) AND NOT keep-open
    reason: not_planned
    comment: "Closing because this was labeled {{matched}}."

  - name: superseded
    labels: [duplicate, has-replacement]
    operator: AND
    target: prs
    lock: true
```

Rules are checked in order and the first one that matches wins.

| Key | Meaning |
| --- | --- |
| `name` | Shown in logs, the `matched-rule` output and `{{rule}}`. Defaults to `rule-N`. |
| `when` | A label expression. Use this or `labels`. |
| `labels` | A list of labels. Use this or `when`. |
| `operator` | `OR` (default) or `AND`. Only with `labels`. |
| `target` | `issues`, `prs` or `all`. Defaults to the `target` input. |
| `reason` | `completed` or `not_planned`. Defaults to the `close-reason` input. |
| `comment` | Defaults to the `comment` input. Set `""` for no comment. |
| `lock` | `true` or `false`. Defaults to the `lock` input. |

The file is read from the checkout if there is one. Without a checkout, the
action reads it from the repository at the commit the workflow runs on.

If you set `labels` or `expression` together with `rules-file`, the inline rule
is checked first.

## Expressions

```
wontfix OR invalid
duplicate AND has-replacement
(wontfix OR invalid) AND NOT keep-open
"good first issue" AND NOT 'help wanted'
```

- `NOT` binds tighter than `AND`, which binds tighter than `OR`.
- Keywords and label names are case-insensitive.
- Quote labels that contain spaces, quotes or parentheses, or that are named `and`, `or` or `not`.

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `labels` | | Inline labels, separated by commas or newlines. |
| `operator` | `OR` | `OR` or `AND`, for `labels`. |
| `expression` | | Inline expression. Cannot be combined with `labels`. |
| `rules-file` | | Path to a rules file. |
| `target` | `all` | `issues`, `prs` or `all`. |
| `comment` | | Comment posted before closing. Supports `{{matched}}` and `{{rule}}`. |
| `close-reason` | `not_planned` | `completed` or `not_planned`. Issues only. |
| `lock` | `false` | Lock the conversation after closing. |
| `dry-run` | `false` | Log the match without changing anything. |
| `number` | from the event | Issue or pull request number to check. |
| `token` | `github.token` | Needs `issues: write` and `pull-requests: write`. |

## Outputs

| Output | Description |
| --- | --- |
| `closed` | `true` if this run closed the issue or pull request. |
| `matched-rule` | Name of the rule that matched (`inline` for inline inputs). Set in dry-run too. |
| `matched-labels` | Comma separated labels that made the rule match. |
| `number` | The number that was checked. |

## Notes

- Labels are read from the API when the action runs, not from the event payload.
- Already closed issues and pull requests are skipped.
- For pull requests from forks, trigger on `pull_request_target`. The token on `pull_request` is read-only there.
- Closing with the default `GITHUB_TOKEN` does not trigger other workflows.

## Development

```bash
npm ci
```

```bash
npm run all
```

`npm run all` runs the typecheck, the unit tests and the build. Commit `dist/` with your change.

The project tests itself in three ways:

- **CI** ([ci.yml](.github/workflows/ci.yml)): typecheck, unit tests, and a check that `dist/` matches the source.
- **E2E** ([e2e.yml](.github/workflows/e2e.yml)): creates real issues and a pull request in this repository, runs the action from the checkout on each, and checks the resulting state, close reason, comments, lock and outputs.
- **Dogfooding** ([dogfood.yml](.github/workflows/dogfood.yml)): the repository runs its own action with [.github/close-rules.yml](.github/close-rules.yml).

Each E2E run leaves its closed `[e2e]` issues and pull request behind.

## Branch protection and dependency updates

`main` requires the `test` (CI) and `e2e` (E2E) checks to pass. This applies to
administrators too, so every change goes through a pull request.

[dependabot-merge.yml](.github/workflows/dependabot-merge.yml) runs every Monday
and merges open Dependabot security updates whose checks all passed. An update
to a bundled dependency fails the `dist/` check until someone rebuilds `dist/`
on the pull request, so it stays open.

## Releasing

Push a tag like `v1.2.3`. [release.yml](.github/workflows/release.yml) moves `v1` to it.

## License

[MIT](LICENSE)
