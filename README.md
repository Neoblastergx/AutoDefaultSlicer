# AutoDefaultSlicer

A native-like Power BI slicer with dynamic default selection.

AutoDefaultSlicer is a Power BI custom visual designed to behave similarly to the
native slicer while adding configurable dynamic default selection such as
**Max**, **Min**, or **None**.

Power BI's native slicer does not provide a general-purpose dynamic default
selection that recalculates automatically when a report is opened.
AutoDefaultSlicer solves this without requiring helper measures, "dirty status"
tables, or special preselection models: bind a field, choose *Default selection
= Max*, and the slicer opens on the latest year, month, or date every time.

```
Year                      Month                     Date
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│ 2026           ▼ │      │ September      ▼ │      │ 10/09/2026     ▼ │
└──────────────────┘      └──────────────────┘      └──────────────────┘
```

## Features

- **Dynamic default selection** — Max, Min, or None, resolved on the *Sort By*
  field when one is bound, otherwise on the value itself.
- **Default behavior** — *On Load* recomputes the default every time the report
  opens, ignoring whatever was selected when it was saved; *Only When Empty*
  honours an existing filter and applies the default only when there is none.
- **Selection modes** — Single, Single or All, Multi.
- **Multi display** — a compact Dropdown, or a List with click-to-toggle that
  does not require Ctrl/Cmd and a configurable number of visible rows.
- **Sort By field** — orders the options and decides Max/Min independently of
  the displayed text (so "September" beats "August" by month number).
- **Select All** with a configurable label, and a **Clear behavior** setting
  (back to the default, to All, or to nothing).
- **Native-like UX** — every mode renders a native HTML `<select>`, so the
  option list opens over the report instead of being clipped inside the visual.
- **Model formatting** — text, numbers and dates use the column's format string
  and the report locale (a *Short Date* column reads `10/09/2026`).
- **Real filtering** — the visual applies a filter on the bound column through
  the official Filter API; *All* removes only the filter this visual created.
- **Session-scoped selection** — nothing is persisted with `persistProperties`;
  a user's choice lasts for their session and the default rule decides again on
  the next open.
- **Localized UI text** — English and Spanish resources, with format-pane
  overrides.
- **Power BI Report Server support** — tested end-to-end; `apiVersion 5.3.0`,
  no APIs newer than the September 2023 Report Server release.
- **No helper DAX** — no measures, no auxiliary tables, no per-instance flags.

## Quick start

1. Download the latest `AutoDefaultSlicer.pbiviz` from
   [GitHub Releases](https://github.com/Neoblastergx/AutoDefaultSlicer/releases).
2. Import it into Power BI Desktop:
   *Visualizations → … → Import a visual from a file*.
3. Add a field to **Value**.
4. Optionally add a numeric or date field to **Sort By**.
5. In the format pane, set **Selection → Default selection → Max**.
6. Use the visual like a normal slicer.

Three independent instances on one page is the typical setup:

| Slicer | Value | Sort By | Default selection | Opens on |
| --- | --- | --- | --- | --- |
| Year | `Calendar[Year]` | — | Max | latest year |
| Month | `Calendar[Month]` | `Calendar[Month Number]` | Max | latest month by number |
| Date | `Calendar[Date]` | `Calendar[Date ID]` | Max | latest date |

Each instance keeps its own state and filters its own column; they do not
interfere with each other.

## Settings

All settings live in the format pane.

| Card | Setting | Options | Default |
| --- | --- | --- | --- |
| Selection | Selection mode | Single / Multi / Single or All | Single or All |
| Selection | Multi display | Dropdown / List | Dropdown |
| Selection | Visible rows | 2 – 20 (Multi + List) | 5 |
| Selection | Default selection | None / Max / Min | Max |
| Selection | Default behavior | On Load / Only When Empty | On Load |
| Selection | Sort direction | Descending / Ascending | Descending |
| Selection | Show Select All | On / Off | On |
| Selection | Select All label | text (empty = localized *All*) | empty |
| Selection | Multi selection label | text with `{0}` (empty = localized *{0} selected*) | empty |
| Selection | Clear behavior | Default / All / None | Default |
| Slicer header | Show, title text, font, colour, clear button | | on |
| Slicer box | Font, colour, background, border, radius | | native-like |
| Dropdown list | Background, font colour | | white / dark grey |

*Single or All* means exactly one value or no filter at all — two individual
values can never be selected together. The closed control always shows the real
state: the value, the Select All label, or `2 selected` in Multi.

## Multi-select

Multi has two presentations, chosen with **Multi display**.

**Dropdown** — the compact closed box. The option list marks selected values
with ☑ / ☐; each pick toggles one value and applies the filter immediately. The
visual then tries to reopen the native dropdown so further values can be ticked
without clicking again. That reopen depends on the host and browser exposing
`HTMLSelectElement.showPicker()` (Chromium 121+); where it is unavailable or
blocked, the dropdown closes after each choice and is reopened manually.
Selection is never affected.

**List** — a native multi-select list box, always visible, **Visible rows**
tall, scrolling past that. A plain click toggles a row; Ctrl/Cmd is not
required. Keyboard navigation keeps the platform's own behaviour.

In both, *All* clears the individual selection and removes the visual's filter;
selecting a value while *All* is active leaves the All state; removing the last
selected value falls back to *All*.

## Power BI Report Server

AutoDefaultSlicer has been tested end-to-end with Power BI Report Server.

- **Tested with:** Power BI Desktop, Power BI Desktop for Power BI Report
  Server, and Power BI Report Server (rendering, filtering, default selection,
  Multi modes, and publishing).
- **apiVersion:** `5.3.0`. Every Power BI Report Server release since
  September 2023 ships a Custom Visual API of 5.4.0 or newer (5.10.0 from
  September 2024 onward), so the API surface this visual uses is available on
  those servers. No API introduced after 5.3.0 is used.
- **Requirements:** custom visuals enabled on the server (`EnableCustomVisuals`,
  on by default), and the report authored in *Power BI Desktop optimized for
  Power BI Report Server*. The visual travels inside the `.pbix`; nothing is
  installed on the server itself.
- **Design constraints kept for Report Server:** no modal dialogs, no external
  resources, no APIs newer than 5.3.0; the packaged bundle is exercised by tests
  on every build.

See [docs/report-server.md](docs/report-server.md) for the version table and the
reasoning behind the API choice.

## Limitations

- **A custom visual cannot draw outside its own area.** That is why the option
  list is a native `<select>`: its popup is drawn by the browser and is not
  clipped. The trade-off is that the popup cannot be styled beyond the closed
  box, and there is no search box inside it (type-ahead works instead).
- **Multi + Dropdown auto-reopen is best effort**, as described above.
- **List mode: Shift-click ranges are not implemented** for the mouse; keyboard
  Shift+arrow ranges work because they are native.
- **Selection is not saved with the report.** This is deliberate: the default
  rule wins on every open. Use *Default behavior = Only When Empty* to honour a
  saved filter instead.
- **Bookmarks work within a session**, not across a reload.
- **Two UI languages ship** (English, Spanish); others fall back to English.

More detail on behaviour, edge cases and design decisions is in
[docs/behavior.md](docs/behavior.md).

## Development

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run package     # builds dist/*.pbiviz and runs the packaged-bundle tests
```

Node.js 18 or newer. The `.pbiviz` is written to `dist/`. See
[docs/development.md](docs/development.md) for the project layout, the test
suites and how localization resources are organized, and
[CONTRIBUTING.md](CONTRIBUTING.md) for the pull request workflow.

## License

[MIT](LICENSE) © Neoblastergx
