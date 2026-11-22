# Contribution triage

**Language:** English · [Español](../../docs/es/repository/TRIAGE-REVIEW.md)

Every pull request and issue from an outside contributor gets an automated first review from [Centinela](https://github.com/johnny4young/centinela).
It posts one comment, keeps it updated, and sets the `centinela` status on the pull request.
A maintainer still reviews every contribution; the bot only makes sure it is ready for that review.

## What it checks

| Area         | Pull request                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Description  | Conventional Commit title and the **What**, **Why** and **How to test** sections of the template      |
| Evidence     | Screenshots or a recording for UI changes, reproduction steps for fixes, tests for new source code    |
| Size         | Lines changed without lockfiles or generated files; large pull requests are asked to split or justify |
| Language     | Spelling in added lines, Spanish copy in the usted register, every locale key in English and Spanish  |
| Safety       | Workflows, install scripts, licenses, Electron hardening, hidden Unicode, secrets, encoded blobs      |
| Identity     | Commits that carry a maintainer identity without a verified signature                                 |
| Dependencies | New dependencies, their license and how long ago the version was published                            |

Issues that report a bug need steps to reproduce, expected and actual behavior, the Puntovivo version and the operating system.
Reports that look like a security vulnerability are pointed to the private process in [SECURITY](../../docs/SECURITY.md).

## Results

- **To move forward**: the author needs to fix it; the pull request gets `status: waiting-on-author`.
- **Needs a maintainer review**: a maintainer has to look at it; the pull request gets `status: needs-maintainer`.
- **Suggestions**: worth doing, never blocking.

The `centinela` status fails while either of the first two groups has items. Adding the `triage: approved` label marks them as accepted by a maintainer for the current commit; a new push needs a new approval.
Incomplete issues get `needs-info`.

## When it runs

It runs again only when something it reads changes: a new commit, the title, the description, the opt-in or approval labels, or its own rules.
Maintainer contributions are skipped unless they carry the `triage` label. Drafts and automation accounts are skipped.

The workflow runs from `main` and reads the pull request only through the GitHub API; it never checks out or executes contributed code.

## Improving the rules

The Puntovivo rules live in `.github/centinela.json`; the checks themselves live in the [Centinela repository](https://github.com/johnny4young/centinela).
Any change to either changes the rules version, so each open contribution is reviewed once more with the new rules.

To try a change against a real pull request without posting anything, from a Centinela checkout:

```bash
GITHUB_REPOSITORY=johnny4young/puntovivo GH_TOKEN=$(gh auth token) node src/centinela.mjs --dry-run --force --pr 123 --config ../puntovivo/.github/centinela.json
```
