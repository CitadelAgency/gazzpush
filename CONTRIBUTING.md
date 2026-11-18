# Contributing to Gazzpush

Thanks for helping build tools that make journalism more verifiable. This guide covers how to propose changes and what
a good pull request looks like.

## Ways to contribute

- **Report a bug** with the [bug report template](https://github.com/CitadelAgency/gazzpush/issues/new?template=bug_report.yml).
- **Propose a feature** with the [feature request template](https://github.com/CitadelAgency/gazzpush/issues/new?template=feature_request.yml).
  Explain the reporting or editing problem first, then the solution.
- **Improve the docs**, including translations of the UI strings.
- **Fix an issue.** Comment on it first so work isn't duplicated. For anything larger than a small fix, open an issue
  to agree on the approach before you write code.

Security vulnerabilities must not be reported in public issues. See [SECURITY.md](SECURITY.md).

## Development setup

Follow [docs/development.md](docs/development.md). In short:

```sh
npm ci
cp .dev.vars.example .dev.vars
npm run types
npm run db:migrate:local
npm run check && npm test
```

## Before you open a pull request

- [ ] `npm run check` passes (Worker, tests and web types).
- [ ] `npm test` passes. New behavior has tests, and bug fixes have a test that fails without the fix.
- [ ] `npm run web:build` succeeds if you touched `web/`.
- [ ] Every new UI string has both languages: `t("Português", "English")`.
- [ ] Schema changes are a new migration file. Shipped migrations are never edited.
- [ ] Docs are updated when behavior, configuration or limits change.

## Project principles

These are the rules reviewers check first. They come from what the tool is for: a story that has to survive a
lawyer's reading.

1. **The model points, the code verifies.** Model output is never shown as fact until code has checked it against
   stored data: literal passages, cited pages, recomputed numbers.
2. **The model never writes the journalist's text.** Suggestions are offered for the person to copy or decide on.
   Nothing is inserted silently.
3. **Every decision is recorded** with who made it and when, and the actor always comes from the session.
4. **Never fail silently.** Outages, refusals and invalid answers become visible states with a reason.
5. **Small and auditable.** One Worker, pure functions in `src/lib/`, status changes only through `transitar`, no
   speculative abstractions.

## Code style

- TypeScript in strict mode. Match the style of the file you are editing.
- Identifiers use the project's Portuguese domain vocabulary. Keep new names consistent and check the
  [glossary](docs/glossary.md). Comments may be in English or Portuguese. Docs, issues, pull requests and commit
  messages are in English.
- Keep pull requests focused: one concern per pull request, with no unrelated formatting changes.

## Commit messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(story-desk): flag quotes missing from every recording
fix(queue): release file ownership after the last retry
docs(self-hosting): document the Email Routing rule
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`. Common scopes: `story-desk`,
`legal-shield`, `documents`, `recordings`, `living`, `pipeline`, `distribution`, `reels`, `web`, `api`, `queue`,
`workflows`, `i18n`, `deps`.

## Licensing of contributions

Gazzpush is licensed under the [AGPL-3.0-only](LICENSE). The maintainers have not yet published the terms for
outside contributions (for example, whether a contributor license agreement will be required). Until they do, please
open an issue before submitting a substantial code contribution, so the terms can be agreed first. Documentation fixes
and bug reports are welcome at any time.
