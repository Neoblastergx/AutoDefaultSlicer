/**
 * Session lifecycle tests.
 *
 * These drive the real SessionController and the real FilterManager against a
 * fake Power BI host that behaves the way the real one does: applyJsonFilter
 * stores a filter, and that filter comes back on the next update in
 * options.jsonFilters.
 *
 * This is where the "the default must win when the report is opened" rule is
 * proven end to end, including the update -> applyFilter -> update loop guard.
 *
 *   npm run test:session
 */

import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import PrimitiveValue = powerbi.PrimitiveValue;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;

import { transform } from "../src/dataView";
import { parseSettings, VisualSettings } from "../src/settings";
import { AppliedFilter, FilterManager, readAppliedFilter, signature } from "../src/filterManager";
import { SessionController } from "../src/sessionState";
import { clearedState, selectionFromKeys } from "../src/selectionResolver";
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
// A fake report: it owns the filter, exactly like Power BI does.
// ---------------------------------------------------------------------------

class FakeReport {
    /** The filter currently stored against this visual, or null for none. */
    public filter: unknown = null;
    public applyCalls = 0;
    public persistCalls = 0;

    public host(): IVisualHost {
        return {
            applyJsonFilter: (filter: unknown, _o: string, _p: string, action: number) => {
                this.applyCalls++;
                // powerbi.FilterAction.remove === 1
                this.filter = action === 1 ? null : filter;
            },
            persistProperties: () => {
                this.persistCalls++;
            }
        } as unknown as IVisualHost;
    }

    /** What options.jsonFilters would carry on the next update. */
    public jsonFilters(): unknown[] {
        return this.filter ? [this.filter] : [];
    }
}

/** One instance of the visual, running the same code path update() does. */
class Instance {
    public state: SelectionState = { mode: "auto", keys: [] };
    public items: SlicerItem[] = [];
    private session = new SessionController();
    private filterManager: FilterManager;
    private target: { table: string; column: string } | null = null;

    constructor(private report: FakeReport, public settings: VisualSettings) {
        this.filterManager = new FilterManager(report.host());
    }

    /** Mirrors Visual.update(). */
    public update(dataView: DataView): void {
        const data = transform(dataView, {
            locale: LOCALE,
            sortDirection: this.settings.selection.sortDirection
        });
        this.items = data.items;
        this.target = data.target;

        const applied = this.readApplied();

        this.state = this.session.next(
            this.items,
            applied,
            this.settings,
            LOCALE,
            this.filterManager.isInFlight()
        );
        this.sync(applied);
    }

    /** Mirrors Visual.commit(): a user interaction. */
    public select(keys: string[]): void {
        this.apply(selectionFromKeys(keys, this.settings));
    }

    public selectAll(): void {
        this.apply({ mode: "all", keys: [] });
    }

    public clear(): void {
        this.apply(clearedState(this.items, this.settings, LOCALE));
    }

    private apply(next: SelectionState): void {
        this.state = next;
        this.session.commit(next);
        this.sync(this.readApplied());
    }

    private readApplied(): AppliedFilter {
        const options = {
            jsonFilters: this.report.jsonFilters()
        } as unknown as powerbi.extensibility.visual.VisualUpdateOptions;
        return readAppliedFilter(options, this.target, this.items);
    }

    private sync(applied: AppliedFilter): void {
        const keys = this.state.mode === "all" ? [] : this.state.keys;
        this.session.noteRequested(keys);
        this.filterManager.apply(this.target, this.items, keys, applied.keys);
    }

    /** What the closed dropdown shows. */
    public text(): string {
        const allLabel = resolveStrings(LOCALE, undefined, { selectAll: this.settings.selection.selectAllLabel }).selectAll;
        if (this.state.mode === "all" || !this.state.keys.length) {
            return allLabel;
        }
        const set = new Set(this.state.keys);
        const picked = this.items.filter((i) => set.has(i.key)).map((i) => i.text);
        return picked.length ? picked.join(", ") : allLabel;
    }

    public key(text: string): string {
        const item = this.items.filter((i) => i.text === text)[0];
        if (!item) {
            throw new Error("no item with text " + text);
        }
        return item.key;
    }
}

interface Row {
    value: PrimitiveValue;
    sortBy?: PrimitiveValue;
}

function makeDataView(rows: Row[], objects?: powerbi.DataViewObjects): DataView {
    return {
        metadata: { columns: [], objects },
        categorical: {
            categories: [
                {
                    source: {
                        displayName: "# Anio",
                        queryName: "# Calendario.# Anio",
                        roles: { value: true },
                        type: {} as powerbi.ValueTypeDescriptor
                    },
                    values: rows.map((r) => r.value)
                } as powerbi.DataViewCategoryColumn
            ]
        }
    } as DataView;
}

function settingsWith(overrides: Record<string, unknown> = {}): VisualSettings {
    return parseSettings(makeDataView([{ value: 1 }], { selection: overrides as powerbi.DataViewObject }));
}

const YEARS = makeDataView([{ value: 2025 }, { value: 2026 }]);

// ---------------------------------------------------------------------------
// THE CRITICAL CASE
// ---------------------------------------------------------------------------

section("CRITICAL - the default wins when the report is opened");
{
    const settings = settingsWith({ selectionMode: "single", defaultSelection: "max", defaultBehavior: "onLoad" });

    // --- Session 1: the author designs the report --------------------------
    const report = new FakeReport();
    const s1 = new Instance(report, settings);

    s1.update(YEARS);
    check("1. opening the report shows 2026", s1.text(), "2026");
    check("   a filter for 2026 was applied", !!report.filter, true);

    s1.select([s1.key("2025")]);
    check("2. the author picks 2025", s1.text(), "2025");

    // Power BI re-renders after the filter lands.
    s1.update(YEARS);
    check("   2025 survives the re-render", s1.text(), "2025");

    // 3. The PBIX is saved with 2025 filtered. That is what `report` now holds.
    const savedFilter = report.filter;
    check("3. the saved report carries a filter for 2025", !!savedFilter, true);
    check("   nothing about the selection was persisted as a property", report.persistCalls, 0);

    // --- 4 & 5: Power BI is closed and the PBIX reopened -------------------
    // A new session: a brand new visual instance, but the SAME saved filter.
    const reopened = new FakeReport();
    reopened.filter = savedFilter;
    const s2 = new Instance(reopened, settings);

    s2.update(YEARS);
    check("5. reopening the PBIX shows 2026, not 2025", s2.text(), "2026");
    check("   and the model filter was rewritten to 2026", signature([s2.key("2026")]), signature(s2.state.keys));

    // --- 6 & 7: published to Report Server, opened in a new session --------
    const rs = new FakeReport();
    rs.filter = savedFilter;
    const s3 = new Instance(rs, settings);
    s3.update(YEARS);
    check("7. a fresh Report Server session shows 2026", s3.text(), "2026");

    // --- 8: the user picks 2025 during that session ------------------------
    s3.select([s3.key("2025")]);
    check("8. the user picks 2025", s3.text(), "2025");
    s3.update(YEARS);
    s3.update(YEARS);
    check("   and it survives repeated updates", s3.text(), "2025");

    // --- 9: opening the report from scratch again --------------------------
    const again = new FakeReport();
    again.filter = rs.filter;
    const s4 = new Instance(again, settings);
    s4.update(YEARS);
    check("9. opening from scratch shows 2026 again", s4.text(), "2026");
}

// ---------------------------------------------------------------------------

section("Default behavior = Only When Empty");
{
    const settings = settingsWith({ defaultSelection: "max", defaultBehavior: "onlyWhenEmpty" });

    const first = new FakeReport();
    const a = new Instance(first, settings);
    a.update(YEARS);
    check("with no saved filter it still applies the Max", a.text(), "2026");

    a.select([a.key("2025")]);
    const saved = first.filter;

    const reopened = new FakeReport();
    reopened.filter = saved;
    const b = new Instance(reopened, settings);
    b.update(YEARS);
    check("with a saved filter it honours 2025", b.text(), "2025");

    // Same saved report, but the author switches the setting to On Load.
    const onLoad = settingsWith({ defaultSelection: "max", defaultBehavior: "onLoad" });
    const third = new FakeReport();
    third.filter = saved;
    const c = new Instance(third, onLoad);
    c.update(YEARS);
    check("switching to On Load ignores the same saved filter", c.text(), "2026");
}

section("Default Selection = None on load");
{
    const settings = settingsWith({ defaultSelection: "none", defaultBehavior: "onLoad" });
    const primed = new FakeReport();

    // Prime the report with a saved 2025 filter.
    const seed = new Instance(primed, settingsWith({ defaultSelection: "max" }));
    seed.update(YEARS);
    seed.select([seed.key("2025")]);

    const reopened = new FakeReport();
    reopened.filter = primed.filter;
    const a = new Instance(reopened, settings);
    a.update(YEARS);
    check("None clears the saved filter on load", a.text(), "Todos");
    check("no filter is left in the report", reopened.filter, null);
}

section("Nothing is persisted");
{
    const report = new FakeReport();
    const a = new Instance(report, settingsWith());
    a.update(YEARS);
    a.select([a.key("2025")]);
    a.selectAll();
    a.select([a.key("2026")]);
    a.update(YEARS);
    check("persistProperties is never called", report.persistCalls, 0);
}

section("Loop guard - the same filter is not applied twice");
{
    const report = new FakeReport();
    const a = new Instance(report, settingsWith());

    a.update(YEARS);
    const afterFirst = report.applyCalls;
    check("the initial default costs one applyJsonFilter", afterFirst, 1);

    // Power BI re-renders several times with the filter now in place.
    a.update(YEARS);
    a.update(YEARS);
    a.update(YEARS);
    check("re-rendering applies nothing further", report.applyCalls, afterFirst);
    check("and the selection is unchanged", a.text(), "2026");

    a.select([a.key("2025")]);
    check("a user pick costs exactly one more call", report.applyCalls, afterFirst + 1);
    a.update(YEARS);
    a.update(YEARS);
    check("and settles again", report.applyCalls, afterFirst + 1);
}

section("In-session behaviour");
{
    const settings = settingsWith();
    const report = new FakeReport();
    const a = new Instance(report, settings);

    a.update(YEARS);
    a.select([a.key("2025")]);

    // Another slicer changes the context; 2025 still exists.
    a.update(YEARS);
    check("an explicit pick is kept while it exists", a.text(), "2025");

    // Now an external filter removes 2025 from the data.
    a.update(makeDataView([{ value: 2026 }]));
    check("when the picked value disappears it falls back to the Max", a.text(), "2026");

    // Select All is sticky within the session.
    const report2 = new FakeReport();
    const b = new Instance(report2, settings);
    b.update(YEARS);
    b.selectAll();
    check("Select All shows Todos", b.text(), "Todos");
    check("Select All removes the filter", report2.filter, null);
    b.update(YEARS);
    b.update(YEARS);
    check("Select All is not overwritten by the Max default", b.text(), "Todos");

    // ...but a new session starts from the default again.
    const report3 = new FakeReport();
    report3.filter = report2.filter;
    const c = new Instance(report3, settings);
    c.update(YEARS);
    check("a new session goes back to the Max", c.text(), "2026");
}

section("A new maximum arrives mid-session");
{
    const report = new FakeReport();
    const a = new Instance(report, settingsWith());
    a.update(YEARS);
    check("starts at 2026", a.text(), "2026");

    a.update(makeDataView([{ value: 2025 }, { value: 2026 }, { value: 2027 }]));
    check("auto state follows the new maximum", a.text(), "2027");

    // But an explicit pick is not dragged along.
    a.select([a.key("2025")]);
    a.update(makeDataView([{ value: 2025 }, { value: 2026 }, { value: 2027 }, { value: 2028 }]));
    check("an explicit pick is not overwritten by a newer maximum", a.text(), "2025");
}

section("Bookmarks within a session");
{
    const settings = settingsWith();
    const report = new FakeReport();
    const a = new Instance(report, settings);

    a.update(YEARS);
    // Power BI re-renders with the filter we just applied; that echo is what
    // tells the visual its own change has landed.
    a.update(YEARS);
    check("starts at the Max", a.text(), "2026");

    // A bookmark is applied: the host changes the filter behind our back.
    // Build the filter a 2025 selection would produce, then drop it in.
    const other = new FakeReport();
    const seed = new Instance(other, settings);
    seed.update(YEARS);
    seed.select([seed.key("2025")]);
    report.filter = other.filter;

    a.update(YEARS);
    check("a filter restored from outside is adopted, not fought", a.text(), "2025");
    a.update(YEARS);
    check("and it sticks", a.text(), "2025");

    // Clearing the filter from outside reads as Select All.
    report.filter = null;
    a.update(YEARS);
    check("an externally cleared filter reads as Todos", a.text(), "Todos");
}

section("Clear behaviour in session");
{
    const report = new FakeReport();
    const a = new Instance(report, settingsWith({ clearBehavior: "default" }));
    a.update(YEARS);
    a.select([a.key("2025")]);
    a.clear();
    check("Clear = Default goes back to the Max", a.text(), "2026");

    const report2 = new FakeReport();
    const b = new Instance(report2, settingsWith({ clearBehavior: "all" }));
    b.update(YEARS);
    b.clear();
    check("Clear = All goes to Todos", b.text(), "Todos");
    check("Clear = All removes the filter", report2.filter, null);
}

section("Rebinding the Value field restarts the instance");
{
    const report = new FakeReport();
    const a = new Instance(report, settingsWith());
    a.update(YEARS);
    a.select([a.key("2025")]);
    check("user is on 2025", a.text(), "2025");

    // The SessionController is reset by Visual.update() when Value is unbound;
    // a fresh instance is the same thing from the controller's point of view.
    const b = new Instance(report, settingsWith());
    b.update(YEARS);
    check("after rebinding, the default applies again", b.text(), "2026");
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
    process.exit(1);
}
