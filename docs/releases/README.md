# Human-first release notes

GitHub releases are product communication, not a copy of the commit log. Keep
`CHANGELOG.md` as the technical, generated history and add one curated file here
for every public tag.

## Required structure

Each `vX.Y.Z.md` file must include:

1. **Why this release matters** — the problem it solves in everyday language.
2. **What changed** — grouped by operator outcome rather than code area.
3. **Before you use it** — limitations, migration notes, and any proof that is
   still missing.
4. **Downloads** — a link to the matching GitHub release and a clear platform
   availability note.

Write for owners, managers, and cashiers first. Put implementation detail in a
short technical appendix or link to the generated changelog. Never imply fiscal
certification, hardware qualification, cloud operation, support coverage, or a
delivery date without fresh evidence.

## Release flow

Before merging a Release Please PR:

1. determine the version proposed by the PR;
2. add `docs/releases/vX.Y.Z.md` with the structure above;
3. verify every claim against `docs/PROJECT-STATUS.md` and the release-candidate
   evidence;
4. run `pnpm run ci:release`.

After Release Please creates the tag, `.github/workflows/release-please.yml`
checks out that exact tag and replaces the generated GitHub release body with
the curated file. The generated `CHANGELOG.md` remains available for readers
who want commit-level detail.
