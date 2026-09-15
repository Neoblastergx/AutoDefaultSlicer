# Development

## Prerequisites

- Node.js 18 or newer (the project is built and tested on Node 24)
- npm 9 or newer
- `powerbi-visuals-tools` is a dev dependency; no global install is needed

## Commands

All commands are defined in `package.json`:

| Command | What it does |
| --- | --- |
| `npm install` | installs the pinned dependencies |
| `npm run typecheck` | `tsc --noEmit` over the sources and the tests |
| `npm run lint` | ESLint with Microsoft's `eslint-plugin-powerbi-visuals` rules |
| `npm test` | builds the test bundles with esbuild and runs the three source-level suites |
| `npm run test:logic` / `test:session` / `test:dom` | one suite at a time |
| `npm run package` | `pbiviz package`, then `tests/bundle.cjs` against the produced package |
| `npm run test:bundle` | runs the packaged-bundle tests against an existing `dist/*.pbiviz` |
| `npm start` | `pbiviz start`, the developer-mode server |

The packaged visual is written to `dist/<guid>.<version>.pbiviz`. Releases
attach it as `AutoDefaultSlicer.pbiviz`.

`npm start` needs a local development certificate. On Windows `pbiviz` creates
it with PowerShell 7 (`pwsh`); if that is not installed, run
`npx pbiviz --create-cert` from a shell where it is. This affects only live
debugging, not packaging.

## Project layout

```
.
├── capabilities.json         data roles, DataView mapping, object definitions
├── pbiviz.json               visual metadata; apiVersion 5.3.0
├── tsconfig.json             build configuration (entry: src/visual.ts)
├── tsconfig.test.json        type-check configuration for the tests
├── eslint.config.mjs         lint rules
├── build-tests.mjs           esbuild bundler for the test suites
├── assets/icon.png           20 x 20 icon
├── style/visual.less         geometry of the closed control and the list box
├── stringResources/          <locale>/resources.resjson, packaged by pbiviz
├── src/
│   ├── visual.ts             IVisual: update loop, host wiring, user actions
│   ├── types.ts              shared types
│   ├── settings.ts           reads persisted objects into typed settings
│   ├── formatPane.ts         getFormattingModel, written against the API types
│   ├── dataView.ts           categorical DataView -> de-duplicated, ordered items; Max/Min
│   ├── selectionResolver.ts  default, auto / explicit / all rules, clear behavior
│   ├── sessionState.ts       in-memory selection for one instance's lifetime
│   ├── filterManager.ts      applyJsonFilter and the loop guards
│   ├── dropdown.ts           the native <select>: single, multi-dropdown, multi-list
│   └── strings.ts            UI text keys, fallback tables, resolution order
├── tests/
│   ├── acceptance.ts         transform, Max/Min, resolution, locale defaults
│   ├── session.ts            load/session lifecycle against a fake host that stores the filter
│   ├── dom.ts                jsdom tests for the <select>, list box, auto-reopen, localization
│   └── bundle.cjs            runs the JavaScript inside dist/*.pbiviz in jsdom
└── docs/
```

## Tests

The three source-level suites (`acceptance`, `session`, `dom`) import the
TypeScript directly. The `powerbi-visuals-utils-*` packages are ESM with
extensionless imports that Node cannot resolve on its own, so
`build-tests.mjs` bundles each suite with esbuild first; this is the same
reason the visual itself is built by webpack.

`tests/bundle.cjs` is different: it unzips `dist/*.pbiviz`, evaluates the
packaged JavaScript in jsdom with a fake host, and asserts what every selection
mode renders. It is the check that the shipped artefact — not the sources — is
right, and `npm run package` runs it automatically.

## Dependencies

Runtime, all pinned:

| Package | Why |
| --- | --- |
| `powerbi-visuals-api` 5.3.0 | the API surface, pinned to the Report Server target |
| `powerbi-models` | `BasicFilter` for `applyJsonFilter` |
| `powerbi-visuals-utils-formattingutils` 6.0.1 | `valueFormatter`; the version that resolves to `powerbi-visuals-api` 5.3.0 exactly, so no second copy of the API is bundled |

The format pane is written by hand against `powerbi.visuals.FormattingModel`
instead of `powerbi-visuals-utils-formattingmodel`, because every published
version of that helper depends on a newer `powerbi-visuals-api` than the
Report Server target allows.

`powerbi.FilterAction` and `powerbi.visuals.FormattingComponent` are
`const enum`s; the filter actions are spelled out as numeric constants so the
code stays correct under any bundler, including the esbuild test build.

## Localization

Built-in UI text is resolved per key in this order:

1. `host.createLocalizationManager().getDisplayName(key)`, which serves
   `stringResources/<report locale>/resources.resjson` and falls back to
   `en-US` when the locale has no folder;
2. the language-family table in `src/strings.ts` (`es-*` → Spanish, anything
   else → English), used by hosts without a localization manager and by the
   test harnesses;
3. the format-pane overrides *Select All label* and *Multi selection label*,
   which win when non-empty.

To add a language, add both a `stringResources/<locale>/resources.resjson` and a
table in `src/strings.ts`; a test asserts that the key sets match. The locale
comes from `host.locale`, i.e. the Power BI UI language.

## Packaging notes

`pbiviz package` prints a lint error from `eslint-plugin-powerbi-visuals`'s
bundled configuration (`tsconfigRootDir: "."`, which ESLint 9 rejects). It is a
known issue in the plugin, not in this source; `npm run lint` runs the same rule
set with the path corrected and passes. Packaging succeeds either way.

Importing a `.pbiviz` with the same GUID over an existing one replaces the
visual in the Visualizations pane, but instances already on the canvas keep the
code they were created with until the report is saved and reopened. When a
freshly imported build seems not to have changed, reopen the `.pbix`.
