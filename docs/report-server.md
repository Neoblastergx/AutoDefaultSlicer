# Power BI Report Server

Report Server compatibility is a primary design goal of AutoDefaultSlicer.

## Status

| Environment | Status |
| --- | --- |
| Power BI Desktop | tested |
| Power BI Desktop optimized for Power BI Report Server | expected to work (same runtime, API within range); not separately verified by the maintainers |
| Power BI Report Server | design goal; end-to-end validation on a specific server build is pending |
| Power BI Service | expected to work; not a target of this project |

Reports of success or failure on a specific Report Server build are welcome as
issues — please include the server version from the changelog table below.

## API version

The visual declares `apiVersion 5.3.0` in `pbiviz.json` and uses no API
introduced after it.

A visual runs on a host whose Custom Visual API is greater than or equal to the
visual's `apiVersion`. Microsoft's
[Power BI Report Server change log](https://learn.microsoft.com/power-bi/report-server/changelog)
lists the API each release ships with:

| Report Server release | Custom Visual API |
| --- | --- |
| September 2022 | 4.7.0 |
| January 2023 | 5.2.0 |
| May 2023 / September 2023 | 5.4.0 |
| January 2024 | 5.7.0 |
| May 2024 | 5.8.0 |
| September 2024 and later | 5.10.0 |

Targeting 5.3.0 therefore covers every Report Server from **September 2023**
onward, while still allowing the modern `getFormattingModel` format pane
(API 5.1+). Targeting a newer API would add nothing this visual needs and would
exclude 2023 servers.

## Decisions driven by Report Server

- The format pane is written directly against `powerbi.visuals.FormattingModel`
  rather than with `powerbi-visuals-utils-formattingmodel`, whose published
  versions all require a newer `powerbi-visuals-api`.
- Filtering uses `applyJsonFilter` with a `BasicFilter` — the documented route,
  available since API 1.7.
- Every option list is a native `<select>`; there is no custom popup, no modal
  dialog and no external resource.
- `HTMLSelectElement.showPicker()` (used only for the Multi + Dropdown
  auto-reopen) is feature-detected at runtime and never required.
- The host localization manager is feature-detected; hosts without one fall
  back to the language tables in `src/strings.ts`.

## Installing on Report Server

1. Custom visuals must be enabled on the server. The advanced setting
   `EnableCustomVisuals` is `True` by default (Report Server Configuration
   Manager, or `rsreportserver.config`).
2. Author the report in **Power BI Desktop optimized for Power BI Report
   Server** matching the server release, import the `.pbiviz` there
   (*Visualizations → … → Import a visual from a file*), save, and publish the
   `.pbix`.

The visual travels inside the `.pbix`; nothing is installed on the server.

If the server refuses to render it, check in this order:

- the server release is September 2023 or newer;
- `EnableCustomVisuals` is `True`;
- the `.pbix` was saved with the Report Server edition of Desktop.
