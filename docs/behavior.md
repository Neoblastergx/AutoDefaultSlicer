# Behaviour in detail

This document describes what the visual does in each situation and why. It
complements the overview in the [README](../README.md).

## Data roles

| Role | Required | Max columns | Purpose |
| --- | --- | --- | --- |
| **Value** | yes | 1 | The value shown in the list and the column that gets filtered. Text, number, date and boolean are accepted. |
| **Sort By** | no | 1 | Used only to order the items and to resolve Max / Min. Never displayed. |

When *Sort By* is empty, *Value* is used for both ordering and Max / Min.

Binding a numeric *Sort By* is what makes text columns work: a month name's
alphabetical maximum is not the latest month, but its month number's is.

### De-duplication and blanks

- Duplicate *Value* rows collapse into one option.
- If the same *Value* appears against several *Sort By* values, the visual keeps
  **MAX(Sort By)**. Deterministic, and usually a sign of a modelling issue worth
  knowing about.
- `BLANK`, `NULL` and empty strings are never shown and never become the Max or
  Min. There is no *Show blanks* option.

### Volume

The categorical DataView is aggregated by Power BI, so a fact table with millions
of rows arrives as the distinct list of values. The data reduction cap is 30 000
categories. The `<select>` is built with at most 1 000 options; beyond that a
disabled `+N more` row says how many were left out. The browser's type-ahead
(open the list and start typing) is the way to reach a specific value in a long
list.

### Filter target

The filter targets the column by its query name, parsed as `Table.Column` on the
first dot. Table names containing spaces or symbols work; a *table* name that
itself contains a dot would not resolve correctly.

## Selection state

The selection lives in memory for the lifetime of one visual instance. It is
never persisted with `persistProperties`.

| Mode | Meaning |
| --- | --- |
| `auto` | Nobody has picked anything this session. The *Default selection* rule re-applies on every refresh, so a newly arrived maximum wins. |
| `explicit` | The user picked one or more values. Kept as long as they still exist in the current filter context. |
| `all` | The user picked *All*. No filter is emitted, and that stays for the session. |

Rules that follow:

1. A valid user selection is never overwritten during the session.
2. If the selected value still exists after a context change, it is kept.
3. If it disappears (an external filter removed it), the visual falls back to
   the new Max / Min and returns to `auto`.
4. *All* survives other filters changing.
5. With no prior state, the *Default selection* rule applies.
6. Update → applyFilter → update loops are prevented: the filter currently in
   effect is read back from `options.jsonFilters` and compared before anything
   is applied, and a pushed filter is not pushed again until the host echoes it
   back. The session tests assert the exact call count.

### Opening the report

With **Default behavior = On Load** (the default), any filter the report was
saved with is ignored on the first update of a new instance and the default rule
runs from scratch. Saving a report with "2025" selected does not make "2025"
everyone's starting point.

| Step | Result (Default selection = Max) |
| --- | --- |
| Author opens the report | latest value |
| Author picks another value, saves, publishes | — |
| Anyone opens the report | **latest value**, not the author's pick |
| That user picks a value | kept for the rest of their session |
| They open the report again | latest value |

`applyJsonFilter` always writes a filter into the report — there is no supported
way to filter without that — so the saved `.pbix` does contain the last
selection. The visual simply refuses to read it as a selection on load.

With **Default behavior = Only When Empty**, a filter already in effect at load
time is honoured instead, and the default applies only when there is none.

### Select All

*All* removes only the filter this visual created
(`applyJsonFilter(null, "general", "filter", FilterAction.remove)`). Page
filters, other slicers and report filters are untouched. It does not select
every value one by one.

### Clear button

The eraser in the header follows **Clear behavior**:

| Setting | Result |
| --- | --- |
| Default | back to the *Default selection* rule |
| All | back to *All* |
| None | no filter emitted — for a slicer the same outcome as *All*; the option exists to match the native wording |

### Bookmarks

The filter lives in the standard `general.filter` property, so a bookmark
captures it. When one is applied within a session, the visual notices that the
filter on its column changed to something it did not ask for, adopts it and
shows it in the closed box.

A bookmark cannot survive a reload into a selection: on load the default rule
wins. To pin a value across sessions, use *Default behavior = Only When Empty*.
A bookmark applied in the same instant as one of the visual's own filter changes
is ignored, because while a pushed filter has not been echoed back the visual
cannot tell someone else's change from its own; in practice the host renders in
between.

## The closed control

The closed box always shows the real state — the value, the *All* label, or
`N selected` in Multi. It is rendered from the visual's own resolved selection
and repaints synchronously inside the user's change event, before the browser
has finished closing the picker.

In Single and Single or All the visual sets `select.value` to the matching
option. If the state is *All* it points the box at the *All* row — even when
*Show Select All* is off — so the control can never render blank.

In Multi + Dropdown the box is pointed at a hidden option whose text is the
summary. That is how the list can carry ☑ / ☐ while the closed box does not, and
it also means the same option can be picked twice in a row: after every render
`selectedIndex` returns to the hidden option, so `change` fires again.

## Why a native `<select>`

A custom visual runs in a sandboxed iframe and cannot paint outside its own
rectangle. A custom popup drawn in the DOM is clipped by that rectangle, which on
a slicer-sized visual (about 150 × 60 px) makes the option list unusable.

A native `<select>`'s option list is not a DOM node: the browser draws it in its
own UI layer, above everything, the way it does for a `<select>` on any web
page. It escapes the iframe, so the list opens over the report like the built-in
slicer's does.

The closed control is styled with `appearance: none` so it looks like a Power BI
slicer (Segoe UI, light grey border, compact height, white background, a drawn
chevron). That affects only the closed box, never the popup.

### What cannot be styled

| Wanted | Possible? |
| --- | --- |
| border, radius, background, font, colour, height of the closed box | yes |
| a custom chevron | yes |
| a search box inside the list | no — type-ahead replaces it |
| background / text colour of the options | partly — Chromium and Edge honour `background-color` and `color` on `<option>`; Firefox and Safari largely ignore them |
| hover and selected colours inside the popup | no — the browser owns them |
| row height, padding or fonts inside the popup | no |
| real checkbox widgets next to options | no — Multi + Dropdown uses the ☑ / ☐ characters instead |

These are browser behaviours, the same in Power BI Desktop (which embeds
Chromium) and in a browser against Report Server.

## Multi display = Dropdown

The single-line `<select>` acts as a **toggle command** instead of a state:

1. Every option is labelled ☑ or ☐ according to the current selection.
2. Picking one flips that value in `selectedKeys`.
3. The filter is applied — `Value IN [...]`, or removed for *All*.
4. The labels and the closed-box text are updated **in place** on the existing
   `<option>` nodes. Nothing is recreated, no layout changes, focus stays on
   the `<select>`.
5. The picker is reopened, best effort.

**Auto-reopen.** After each pick the visual calls `HTMLSelectElement.showPicker()`
synchronously, still inside the `change` event where transient user activation
is guaranteed; if that throws, once more on the next `requestAnimationFrame`.
No timers. If `showPicker()` is missing, throws (`SecurityError`,
`NotAllowedError`, `InvalidStateError`) or is blocked by the host, every failure
is swallowed: the selection is applied, the closed text is updated, the dropdown
stays closed. Single, Single or All and List never call it.

The tick marks never reach a filter. They live only in the option's text;
`option.value` is the raw item key, and tooltips show the value without a glyph.
The ☑ / ☐ decision lives in one function, `tickPrefix()`, which returns a mark
only for Selection mode = Multi with Multi display = Dropdown.

Unticking the last value falls back to *All* rather than emitting an empty
`IN []`. Ticking *All* clears the individual selection; ticking a value while
*All* is on leaves the All state.

## Multi display = List

A native `<select multiple>` list box, always visible, `size = Visible rows`,
scrolling past that. Labels are clean text; selection is the platform's own
highlight.

**A plain click toggles a row.** A native `<select multiple>` replaces the
selection on an unmodified click and needs Ctrl (Cmd) to add or remove one row.
The visual cancels the `mousedown` on the `<option>` — the point where Chromium,
Firefox and WebKit all decide the selection — toggles the row in `selectedKeys`,
re-renders, applies the filter and returns focus to the list. Clicks on the
scrollbar or the padding target the `<select>` itself and are left to the
browser, so mouse scrolling keeps working.

Keyboard keeps the platform's semantics (arrows move and select, Ctrl+Space
toggles, Shift+arrows extend), and the resulting selection is read back into
`selectedKeys` on `change`. Shift-click ranges are not implemented for the
mouse.

The visual is never auto-resized. If it is shorter than *Visible rows* the list
shrinks and scrolls; if it is taller, the list keeps *Visible rows*.

## Multi and the default

*Default selection = Max* opens the report with exactly one value selected —
the maximum — in both Multi displays, not with everything selected.

## Accessibility

- `Tab` reaches the control; the visual declares `supportsKeyboardFocus`.
- Single modes: Enter / Space / Alt+↓ open, arrows move, type-ahead jumps, Esc
  cancels — all native.
- Multi + Dropdown: the same, plus the best-effort reopen with focus kept on the
  `<select>`. The tick state is part of the option label, which screen readers
  read out with the value.
- Multi + List: a native list box; the focus ring is the platform's.
- The control's `aria-label` carries the selection (`Year: 2026`,
  `Year: 2 selected`), so the outcome of a pick is announced without opening
  the list again.
- `title` attributes on the control and on every option give truncated text a
  tooltip.
- High-contrast mode uses the host colour palette, plus a `forced-colors`
  media query for the OS-level setting.

## Sync slicers

`supportsSynchronizingFilterState` is declared and works, but two synced
instances each run their own default logic; syncing a dynamic-default slicer
across pages is lightly tested.

## Language policy

The codebase is English: identifiers, comments, tests, configuration and
documentation. Spanish appears only as localization resources
(`stringResources/es-ES`, `STRINGS_ES` in `src/strings.ts`) and, in the tests, as
sample data and a Spanish test host that mirror a real deployment.
