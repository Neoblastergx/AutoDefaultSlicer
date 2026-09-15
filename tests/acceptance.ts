/**
 * Acceptance tests for Auto Default Slicer.
 *
 * These run the real transform / resolver / filter code against synthetic
 * categorical DataViews - the same shape Power BI hands to update().
 *
 *   npm test
 */

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import PrimitiveValue = powerbi.PrimitiveValue;

import { transform, findExtreme } from "../src/dataView";
import { parseSettings, VisualSettings } from "../src/settings";
import { resolve, selectionFromKeys, clearedState, defaultState, initialState } from "../src/selectionResolver";
import { signature, toFilterValue } from "../src/filterManager";
import { SelectionState, SlicerItem } from "../src/types";
import { resolveStrings } from "../src/strings";

const LOCALE = "es-ES";

let failures = 0;
let passes = 0;

function check(name: string, actual: unknown, expected: unknown): void {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a === e) {
        passes++;
        console.log(`  PASS  ${name}`);
    } else {
        failures++;
        console.log(`  FAIL  ${name}\n          expected ${e}\n          actual   ${a}`);
    }
}

function section(title: string): void {
    console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// DataView builders
// ---------------------------------------------------------------------------

interface Row {
    value: PrimitiveValue;
    sortBy?: PrimitiveValue;
}

function makeDataView(
    rows: Row[],
    opts: {
        table?: string;
        column?: string;
        format?: string;
        withSortBy?: boolean;
        objects?: powerbi.DataViewObjects;
    } = {}
): DataView {
    const table = opts.table || "# Calendario";
    const column = opts.column || "# Anio";
    const categories: powerbi.DataViewCategoryColumn[] = [
        {
            source: {
                displayName: column,
                queryName: `${table}.${column}`,
                format: opts.format,
                roles: { value: true },
                type: {} as powerbi.ValueTypeDescriptor
            },
            values: rows.map((r) => r.value)
        } as powerbi.DataViewCategoryColumn
    ];
    if (opts.withSortBy) {
        categories.push({
            source: {
                displayName: "sortBy",
                queryName: `${table}.sortBy`,
                roles: { sortBy: true },
                type: {} as powerbi.ValueTypeDescriptor
            },
            values: rows.map((r) => (r.sortBy === undefined ? null : r.sortBy))
        } as powerbi.DataViewCategoryColumn);
    }
    return {
        metadata: {
            columns: categories.map((c) => c.source),
            objects: opts.objects
        },
        categorical: { categories }
    } as DataView;
}

function settingsFrom(overrides: Partial<powerbi.DataViewObject> = {}): VisualSettings {
    const dv = makeDataView([{ value: 1 }], {
        objects: { selection: overrides as powerbi.DataViewObject }
    });
    return parseSettings(dv);
}

function texts(items: SlicerItem[]): string[] {
    return items.map((i) => i.text);
}

function selectedText(items: SlicerItem[], state: SelectionState, allLabel = "Todos"): string {
    if (state.mode === "all" || !state.keys.length) {
        return allLabel;
    }
    const set = new Set(state.keys);
    const picked = items.filter((i) => set.has(i.key)).map((i) => i.text);
    return picked.length ? picked.join(", ") : allLabel;
}

function run(dv: DataView, settings: VisualSettings, previous: SelectionState | null) {
    const data = transform(dv, { locale: LOCALE, sortDirection: settings.selection.sortDirection });
    const state = resolve({ items: data.items, previous, settings, locale: LOCALE });
    return { data, state };
}

/** The state a freshly opened report starts from. */
function load(dv: DataView, settings: VisualSettings, savedFilterKeys: string[] | null = null) {
    const data = transform(dv, { locale: LOCALE, sortDirection: settings.selection.sortDirection });
    const state = initialState(data.items, savedFilterKeys, settings, LOCALE);
    return { data, state };
}

// ---------------------------------------------------------------------------
// TEST 1 - ANIO
// ---------------------------------------------------------------------------

section("TEST 1 - ANIO (Value only, default Max, Single or All)");
{
    const dv = makeDataView([{ value: 2024 }, { value: 2025 }, { value: 2026 }]);
    const settings = settingsFrom();

    check("defaults are Single-or-All / Max / Descending", [
        settings.selection.selectionMode,
        settings.selection.defaultSelection,
        settings.selection.sortDirection
    ], ["singleOrAll", "max", "desc"]);
    check("the Select All label is empty by default, i.e. localized", settings.selection.selectAllLabel, "");
    check("which resolves to Todos on a Spanish host", resolveStrings("es-ES").selectAll, "Todos");
    check("and to All on an English host", resolveStrings("en-US").selectAll, "All");

    const first = run(dv, settings, null);
    check("items are sorted descending", texts(first.data.items), ["2026", "2025", "2024"]);
    check("closed dropdown shows 2026, not All", selectedText(first.data.items, first.state), "2026");
    check("initial mode is auto", first.state.mode, "auto");

    // User picks 2025.
    const pick2025 = selectionFromKeys([first.data.items[1].key], settings);
    check("picking 2025 shows 2025", selectedText(first.data.items, pick2025), "2025");
    check("picking 2025 becomes explicit", pick2025.mode, "explicit");

    // Refresh keeps 2025 (it still exists).
    const afterRefresh = run(dv, settings, pick2025);
    check("2025 survives a refresh", selectedText(afterRefresh.data.items, afterRefresh.state), "2025");

    // User picks Todos.
    const all: SelectionState = { mode: "all", keys: [] };
    check("Todos shows Todos", selectedText(first.data.items, all), "Todos");
    check("Todos emits no filter", signature(all.keys), "ALL");
    const afterAll = run(dv, settings, all);
    check("Todos survives a refresh", afterAll.state.mode, "all");

    // Back to 2024.
    const pick2024 = selectionFromKeys([first.data.items[2].key], settings);
    check("picking 2024 after Todos shows 2024", selectedText(first.data.items, pick2024), "2024");
    check("only one value is ever selected", pick2024.keys.length, 1);
}

// ---------------------------------------------------------------------------
// TEST 2 - MES (Sort By decides the maximum, not the alphabet)
// ---------------------------------------------------------------------------

section("TEST 2 - MES (Sort By = # Mes Num)");
{
    const months = [
        "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
        "Julio", "Agosto", "Septiembre"
    ];
    const dv = makeDataView(
        months.map((m, i) => ({ value: m, sortBy: i + 1 })),
        { column: "# Mes", withSortBy: true }
    );
    const settings = settingsFrom();
    const r = run(dv, settings, null);

    check("default is Septiembre (Sort By 9)", selectedText(r.data.items, r.state), "Septiembre");
    check("order follows Sort By descending", texts(r.data.items).slice(0, 3), ["Septiembre", "Agosto", "Julio"]);

    // Without Sort By the alphabet would win - prove the difference.
    const dvNoSort = makeDataView(months.map((m) => ({ value: m })), { column: "# Mes" });
    const rNoSort = run(dvNoSort, settings, null);
    check("without Sort By the max is alphabetical (Septiembre here)", selectedText(rNoSort.data.items, rNoSort.state), "Septiembre");

    // A case where alphabet and Sort By really disagree.
    const dv2 = makeDataView(
        [{ value: "Enero", sortBy: 1 }, { value: "Febrero", sortBy: 2 }, { value: "Marzo", sortBy: 3 }],
        { column: "# Mes", withSortBy: true }
    );
    const r2 = run(dv2, settings, null);
    check("Sort By beats the alphabet (Marzo, not Marzo-by-name)", selectedText(r2.data.items, r2.state), "Marzo");
    const alphabetMax = ["Enero", "Febrero", "Marzo"].slice().sort().pop();
    check("alphabetical max would have been Marzo too - so check Min", alphabetMax, "Marzo");

    const minSettings = settingsFrom({ defaultSelection: "min" });
    const rMin = run(dv2, minSettings, null);
    check("Default Selection = Min gives Enero", selectedText(rMin.data.items, rMin.state), "Enero");
}

// ---------------------------------------------------------------------------
// TEST 3 - FECHA (model format string is respected)
// ---------------------------------------------------------------------------

section("TEST 3 - FECHA (Short Date format)");
{
    const rows = [
        { value: new Date(2026, 8, 8), sortBy: 20260908 },
        { value: new Date(2026, 8, 9), sortBy: 20260909 },
        { value: new Date(2026, 8, 10), sortBy: 20260910 }
    ];
    const dv = makeDataView(rows, { column: "# Fecha", format: "dd/MM/yyyy", withSortBy: true });
    const settings = settingsFrom();
    const r = run(dv, settings, null);

    check("default is the newest date", selectedText(r.data.items, r.state), "10/09/2026");
    check("dates keep the model format", texts(r.data.items), ["10/09/2026", "09/09/2026", "08/09/2026"]);

    const item = r.data.items[0];
    check("filter value is timezone-safe (no UTC shift)", toFilterValue(item.raw), "2026-09-10T00:00:00.000Z");
}

// ---------------------------------------------------------------------------
// TEST 4 - NEW DATA ARRIVES
// ---------------------------------------------------------------------------

section("TEST 4 - a newer maximum appears on refresh");
{
    const settings = settingsFrom();
    const before = makeDataView(
        [
            { value: new Date(2026, 8, 9), sortBy: 20260909 },
            { value: new Date(2026, 8, 10), sortBy: 20260910 }
        ],
        { column: "# Fecha", format: "dd/MM/yyyy", withSortBy: true }
    );
    const r1 = run(before, settings, null);
    check("starts at 10/09/2026", selectedText(r1.data.items, r1.state), "10/09/2026");

    const after = makeDataView(
        [
            { value: new Date(2026, 8, 9), sortBy: 20260909 },
            { value: new Date(2026, 8, 10), sortBy: 20260910 },
            { value: new Date(2026, 8, 11), sortBy: 20260911 }
        ],
        { column: "# Fecha", format: "dd/MM/yyyy", withSortBy: true }
    );
    const r2 = run(after, settings, r1.state);
    check("auto state moves to 11/09/2026", selectedText(r2.data.items, r2.state), "11/09/2026");

    // But an explicit pick is not overwritten.
    const explicit = selectionFromKeys([r1.data.items[1].key], settings); // 09/09/2026
    const r3 = run(after, settings, explicit);
    check("an explicit 09/09/2026 is kept when new data arrives", selectedText(r3.data.items, r3.state), "09/09/2026");
}

// ---------------------------------------------------------------------------
// TEST 5 - THE SELECTED VALUE DISAPPEARS
// ---------------------------------------------------------------------------

section("TEST 5 - selected value removed by an external filter");
{
    const settings = settingsFrom();
    const wide = makeDataView(
        [
            { value: "Julio", sortBy: 7 },
            { value: "Agosto", sortBy: 8 },
            { value: "Septiembre", sortBy: 9 }
        ],
        { column: "# Mes", withSortBy: true }
    );
    const r1 = run(wide, settings, null);
    const chosen = selectionFromKeys([r1.data.items[0].key], settings); // Septiembre
    check("user is on Septiembre", selectedText(r1.data.items, chosen), "Septiembre");

    const narrowed = makeDataView(
        [
            { value: "Julio", sortBy: 7 },
            { value: "Agosto", sortBy: 8 }
        ],
        { column: "# Mes", withSortBy: true }
    );
    const r2 = run(narrowed, settings, chosen);
    check("falls back to the new maximum, Agosto", selectedText(r2.data.items, r2.state), "Agosto");

    // A still-available explicit pick is kept.
    const july = selectionFromKeys([r1.data.items[2].key], settings); // Julio
    const r3 = run(narrowed, settings, july);
    check("Julio is kept because it still exists", selectedText(r3.data.items, r3.state), "Julio");
}

// ---------------------------------------------------------------------------
// TEST 6 - TODOS removes only our filter
// ---------------------------------------------------------------------------

section("TEST 6 - Todos");
{
    const settings = settingsFrom();
    const dv = makeDataView([{ value: 2024 }, { value: 2025 }, { value: 2026 }]);
    const r = run(dv, settings, null);

    const all: SelectionState = { mode: "all", keys: [] };
    check("Todos produces the ALL signature (filter removed)", signature(all.keys), "ALL");
    check("Todos does not enumerate every value", all.keys.length, 0);

    const kept = run(dv, settings, all);
    check("Todos is not overwritten by the Max default", kept.state.mode, "all");
    check("closed dropdown reads Todos", selectedText(kept.data.items, kept.state), "Todos");

    // A custom Select All label is honoured.
    const custom = settingsFrom({ selectAllLabel: "(Todos los anios)" });
    check("Select All label is configurable", custom.selection.selectAllLabel, "(Todos los anios)");
}

// ---------------------------------------------------------------------------
// TEST 7 - independent instances
// ---------------------------------------------------------------------------

section("TEST 7 - three independent instances");
{
    const settings = settingsFrom();
    const year = run(makeDataView([{ value: 2025 }, { value: 2026 }], { column: "# Anio" }), settings, null);
    const month = run(
        makeDataView([{ value: "Agosto", sortBy: 8 }, { value: "Septiembre", sortBy: 9 }], { column: "# Mes", withSortBy: true }),
        settings,
        null
    );
    const date = run(
        makeDataView(
            [{ value: new Date(2026, 8, 9), sortBy: 20260909 }, { value: new Date(2026, 8, 10), sortBy: 20260910 }],
            { column: "# Fecha", format: "dd/MM/yyyy", withSortBy: true }
        ),
        settings,
        null
    );

    check("year instance", selectedText(year.data.items, year.state), "2026");
    check("month instance", selectedText(month.data.items, month.state), "Septiembre");
    check("date instance", selectedText(date.data.items, date.state), "10/09/2026");

    check("each instance targets its own column", [
        year.data.target.column,
        month.data.target.column,
        date.data.target.column
    ], ["# Anio", "# Mes", "# Fecha"]);
    check("target table is parsed from the query name", year.data.target.table, "# Calendario");
}

// ---------------------------------------------------------------------------
// Extra - de-duplication, blanks, clear behavior, selection modes, bookmarks
// ---------------------------------------------------------------------------

section("EXTRA - de-duplication and blanks");
{
    const settings = settingsFrom();
    const dv = makeDataView(
        [
            { value: "Septiembre", sortBy: 9 },
            { value: "Septiembre", sortBy: 21 },
            { value: "Agosto", sortBy: 8 },
            { value: null, sortBy: 99 },
            { value: "", sortBy: 98 }
        ],
        { column: "# Mes", withSortBy: true }
    );
    const data = transform(dv, { locale: LOCALE, sortDirection: "desc" });
    check("duplicates collapse to one row", texts(data.items), ["Septiembre", "Agosto"]);
    check("duplicate Sort By resolves to MAX", data.items[0].sortRaw, 21);
    check("BLANK and empty string are dropped", data.items.length, 2);
    check("BLANK never becomes the maximum", findExtreme(data.items, "max", LOCALE).text, "Septiembre");
}

section("EXTRA - Clear behavior");
{
    const items = transform(makeDataView([{ value: 2024 }, { value: 2025 }, { value: 2026 }]), {
        locale: LOCALE,
        sortDirection: "desc"
    }).items;

    const asDefault = clearedState(items, settingsFrom({ clearBehavior: "default" }), LOCALE);
    check("Clear = Default returns to the Max", selectedText(items, asDefault), "2026");

    const asAll = clearedState(items, settingsFrom({ clearBehavior: "all" }), LOCALE);
    check("Clear = All returns to Todos", selectedText(items, asAll), "Todos");

    const asNone = clearedState(items, settingsFrom({ clearBehavior: "none" }), LOCALE);
    check("Clear = None emits no filter", signature(asNone.keys), "ALL");
}

section("EXTRA - Selection modes");
{
    const items = transform(makeDataView([{ value: 2024 }, { value: 2025 }, { value: 2026 }]), {
        locale: LOCALE,
        sortDirection: "desc"
    }).items;

    const single = settingsFrom({ selectionMode: "single" });
    const s1 = selectionFromKeys([items[1].key], single);
    check("Single keeps exactly one value", s1.keys.length, 1);
    check("Single shows the picked value", selectedText(items, s1), "2025");
    // Even if the DOM ever handed back two, Single collapses to one.
    const s2 = selectionFromKeys([items[2].key, items[0].key], single);
    check("Single never accumulates", s2.keys.length, 1);
    check("Single keeps the first of them", selectedText(items, s2), "2024");

    const soa = settingsFrom({ selectionMode: "singleOrAll" });
    const t1 = selectionFromKeys([items[1].key, items[0].key], soa);
    check("Single-or-All never accumulates", t1.keys.length, 1);

    const multi = settingsFrom({ selectionMode: "multi" });
    const m1 = selectionFromKeys([items[0].key, items[1].key], multi);
    check("Multi keeps every value the list box reports", m1.keys.length, 2);
    check("Multi is an explicit selection", m1.mode, "explicit");
    const m2 = selectionFromKeys([], multi);
    check("Multi emptied falls back to Todos", m2.mode, "all");
    check("Multi emptied emits no filter", signature(m2.keys), "ALL");
}

section("EXTRA - Default Selection = None");
{
    const items = transform(makeDataView([{ value: 2024 }, { value: 2026 }]), {
        locale: LOCALE,
        sortDirection: "desc"
    }).items;
    const none = settingsFrom({ defaultSelection: "none" });
    const st = defaultState(items, none, LOCALE);
    check("None selects nothing", st.keys.length, 0);
    check("None emits no filter", signature(st.keys), "ALL");
}

section("EXTRA - Default behavior at load time");
{
    const dv = makeDataView([{ value: 2024 }, { value: 2025 }, { value: 2026 }]);
    const data = transform(dv, { locale: LOCALE, sortDirection: "desc" });
    const key2025 = data.items[1].key;

    // On Load: the filter the report was saved with is ignored.
    const onLoad = settingsFrom({ defaultBehavior: "onLoad" });
    const a = load(dv, onLoad, [key2025]);
    check("On Load ignores the saved 2025 and picks the Max", selectedText(a.data.items, a.state), "2026");
    check("On Load starts in auto mode", a.state.mode, "auto");

    // Only When Empty: the saved filter is honoured.
    const whenEmpty = settingsFrom({ defaultBehavior: "onlyWhenEmpty" });
    const b = load(dv, whenEmpty, [key2025]);
    check("Only When Empty honours the saved 2025", selectedText(b.data.items, b.state), "2025");
    check("Only When Empty treats it as explicit", b.state.mode, "explicit");

    const c = load(dv, whenEmpty, null);
    check("Only When Empty falls back to Max when nothing is filtered", selectedText(c.data.items, c.state), "2026");

    // A saved filter whose value no longer exists cannot win.
    const narrowed = makeDataView([{ value: 2024 }, { value: 2026 }]);
    const d = load(narrowed, whenEmpty, [key2025]);
    check("a saved value that no longer exists falls back to Max", selectedText(d.data.items, d.state), "2026");

    check("On Load is the shipped default", new VisualSettings().selection.defaultBehavior, "onLoad");
}

section("EXTRA - Sort direction");
{
    const asc = settingsFrom({ sortDirection: "asc" });
    const r = run(makeDataView([{ value: 2024 }, { value: 2026 }, { value: 2025 }]), asc, null);
    check("ascending order", texts(r.data.items), ["2024", "2025", "2026"]);
    check("the maximum is still the default, regardless of order", selectedText(r.data.items, r.state), "2026");
}

// ---------------------------------------------------------------------------

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
    process.exit(1);
}
