# Contributing

Thanks for taking the time to contribute.

## Workflow

1. Fork the repository and clone your fork.
2. Create a branch from `main`:
   `git checkout -b feature/short-description`
3. Install dependencies: `npm install`
4. Make your change. Keep code, comments and tests in English.
5. Run the checks:

   ```bash
   npm run typecheck
   npm run lint
   npm test
   npm run package
   ```

   `npm run package` builds `dist/*.pbiviz` and then runs `tests/bundle.cjs`
   against the packaged file. All four must pass.

6. Add or update tests for the behaviour you changed. The suites are described
   in [docs/development.md](docs/development.md).
7. Update `CHANGELOG.md` under an *Unreleased* heading.
8. Open a pull request against `main` and describe what changed and why.

## Guidelines

- Do not use an API newer than `powerbi-visuals-api` 5.3.0; Power BI Report
  Server compatibility is a requirement of this project (see
  [docs/report-server.md](docs/report-server.md)).
- Do not add a custom popup, a modal dialog, or anything that draws outside the
  visual; the reasons are in [docs/behavior.md](docs/behavior.md).
- Do not persist the selection with `persistProperties`.
- New user-facing text goes into `stringResources/<locale>/resources.resjson`
  and `src/strings.ts`, not into string literals.
- Keep pull requests focused; unrelated refactors are easier to review
  separately.

## Reporting issues

Use the issue templates. For bugs, the Power BI Desktop version, the Report
Server version if applicable, the visual version, the selection mode and the
steps to reproduce make the difference between a quick fix and a guess.
