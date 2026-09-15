# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows the visual's version in `pbiviz.json`.

Versions before 1.9.0 were development iterations that were never published;
they are listed for completeness because the visual's version number is
monotonic and `1.9.0` is what the first public release ships as.

## [1.9.0] - 2026-09-15

First public release.

### Added
- Dynamic default selection: Max, Min, or None, resolved on the *Sort By* field
  when bound, otherwise on the value.
- Default behavior: On Load (recompute on every open) or Only When Empty.
- Selection modes: Single, Single or All, Multi.
- Multi display: Dropdown (compact, ☑ / ☐ labels, best-effort auto-reopen) or
  List (native multi-select list box, click-to-toggle without Ctrl,
  configurable visible rows).
- Sort By role, Select All with a configurable label, Clear behavior.
- Model formatting for text, numbers and dates using the column format string
  and the report locale.
- Filtering through the official Filter API; *All* removes only the visual's
  own filter.
- Session-scoped selection; nothing persisted with `persistProperties`.
- Localized UI text (en-US, es-ES) through the host localization manager with
  an in-code fallback.
- `apiVersion 5.3.0` for Power BI Report Server (September 2023 and later);
  tested end-to-end with Power BI Desktop, Power BI Desktop for Report Server
  and Power BI Report Server.
- Test suites over the sources and over the packaged `.pbiviz`.

## [1.8.0] - 2026-09-15 (unpublished)
### Changed
- Multi + Dropdown: labels updated in place and best-effort auto-reopen.
### Removed
- The Dialog API surface.

## [1.7.0] - 2026-09-15 (unpublished)
### Added
- Multi display setting (Dropdown / List) and Visible rows.

## [1.6.0] - 2026-09-15 (unpublished)
### Added
- Multi through the Dialog API. Superseded in 1.8.0.

## [1.5.0] - 2026-09-15 (unpublished)
### Changed
- Multi dropdown without auto-reopen. Superseded in 1.8.0.

## [1.4.0] - 2026-09-10 (unpublished)
### Changed
- Every selection mode on the native `<select>`; Multi as a toggle command.

## [1.3.0] - 2026-09-10 (unpublished)
### Added
- Multi as a custom checkbox panel. Superseded (clipped by the iframe).

## [1.2.0] - 2026-09-10 (unpublished)
### Changed
- Selection is session-only; the default rule wins on every open.
### Added
- Default behavior setting.

## [1.1.0] - 2026-09-10 (unpublished)
### Changed
- Option list switched to a native `<select>`.

## [1.0.0] - 2026-09-10 (unpublished)
### Added
- Initial implementation.

[1.9.0]: https://github.com/Neoblastergx/AutoDefaultSlicer/releases/tag/v1.9.0
[1.8.0]: https://github.com/Neoblastergx/AutoDefaultSlicer/blob/main/CHANGELOG.md
[1.7.0]: https://github.com/Neoblastergx/AutoDefaultSlicer/blob/main/CHANGELOG.md
[1.6.0]: https://github.com/Neoblastergx/AutoDefaultSlicer/blob/main/CHANGELOG.md
[1.5.0]: https://github.com/Neoblastergx/AutoDefaultSlicer/blob/main/CHANGELOG.md
[1.4.0]: https://github.com/Neoblastergx/AutoDefaultSlicer/blob/main/CHANGELOG.md
[1.3.0]: https://github.com/Neoblastergx/AutoDefaultSlicer/blob/main/CHANGELOG.md
[1.2.0]: https://github.com/Neoblastergx/AutoDefaultSlicer/blob/main/CHANGELOG.md
[1.1.0]: https://github.com/Neoblastergx/AutoDefaultSlicer/blob/main/CHANGELOG.md
[1.0.0]: https://github.com/Neoblastergx/AutoDefaultSlicer/blob/main/CHANGELOG.md
