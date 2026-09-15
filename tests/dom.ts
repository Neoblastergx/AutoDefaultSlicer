/**
 * Smoke tests for the slicer control, driven through jsdom.
 *
 * These do not check pixels - they check that the native <select> is built
 * correctly, that the closed box always shows the real selection, and that
 * change events map onto the right callbacks.
 *
 *   npm run test:dom
 */

import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
g.navigator = dom.window.navigator;
g.HTMLElement = dom.window.HTMLElement;
g.SVGElement = dom.window.SVGElement;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.MouseEvent = dom.window.MouseEvent;

import { Dropdown, DropdownViewModel, ptToPx, ALL_OPTION_VALUE, TICKED, UNTICKED, tickPrefix } from "../src/dropdown";
import { VisualSettings } from "../src/settings";
import { resolveStrings, STRINGS_EN, STRINGS_ES, UiStrings } from "../src/strings";
import { transform } from "../src/dataView";
import powerbi from "powerbi-visuals-api";

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

function makeItems(values: (string | number)[]) {
    const dv = {
        metadata: { columns: [] },
        categorical: {
            categories: [
                {
                    source: {
                        displayName: "# Anio",
                        queryName: "# Calendario.# Anio",
                        roles: { value: true },
                        type: {}
                    },
                    values
                }
            ]
        }
    } as unknown as powerbi.DataView;
    return transform(dv, { locale: "es-ES", sortDirection: "desc" });
}

const changes: { keys: string[]; all: boolean }[] = [];
const clears: number[] = [];

const root = dom.window.document.createElement("div");
dom.window.document.body.appendChild(root);

const dropdown = new Dropdown(root, {
    onChange: (keys, all) => changes.push({ keys, all }),
    onClear: () => clears.push(1)
});

const data = makeItems([2024, 2025, 2026]);
const settings = new VisualSettings();
/** The tests run as a Spanish host, so the labels read "Todos" / "N seleccionados". */
const ES: UiStrings = resolveStrings("es-ES");

function vm(selectedKeys: string[], isAll: boolean, overrides: Partial<DropdownViewModel> = {}): DropdownViewModel {
    return {
        items: data.items,
        selectedKeys,
        isAll,
        settings,
        headerText: "Anio",
        ariaLabel: "Anio",
        highContrast: {
            active: false,
            foreground: "#000",
            background: "#fff",
            foregroundSelected: "#fff",
            hyperlink: "#0078D4"
        },
        placeholder: null,
        strings: ES,
        ...overrides
    };
}

const q = (selector: string) => root.querySelector(selector) as HTMLElement;
const sel = () => root.querySelector(".ads-select") as HTMLSelectElement;
const optionTexts = () => Array.from(sel().options).map((o) => o.textContent);
const optionValues = () => Array.from(sel().options).map((o) => o.value);

// --- Multi helpers ---
/** Options the user can actually see: the display option is hidden. */
const visibleOptions = () => Array.from(sel().options).filter((o) => !o.hidden);
const visibleTexts = () => visibleOptions().map((o) => o.textContent);
/** The text the closed box shows: whatever option is currently selected. */
const closedText = () => sel().options[sel().selectedIndex].textContent;
/** Picks an option by its value, the way a user would. */
const pickValue = (value: string) => pick(value);

// --- List helpers ---
const optionByValue = (value: string) => Array.from(sel().options).find((o) => o.value === value) as HTMLOptionElement;
const highlighted = () => Array.from(sel().options).filter((o) => o.selected).map((o) => o.textContent);
/** A plain left click on a row - no Ctrl, no Cmd - the way a user does it. */
function clickRow(value: string): boolean {
    const ev = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    optionByValue(value).dispatchEvent(ev);
    return ev.defaultPrevented;
}

/** jsdom does not fire change on programmatic edits; do what a user would. */
function pick(value: string): void {
    const s = sel();
    for (let i = 0; i < s.options.length; i++) {
        s.options[i].selected = s.options[i].value === value;
    }
    s.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
}

console.log("\nDOM - the control is a native <select>");
{
    dropdown.render(vm([data.items[0].key], false));
    check("the list element is a <select>", sel().tagName, "SELECT");
    check("there is no custom popup", root.querySelector(".ads-popup"), null);
    check("there is no custom option list", root.querySelector(".ads-list"), null);
    check("there are no custom option rows", root.querySelector(".ads-item"), null);
    check("the select is not multiple in Dropdown mode", sel().multiple, false);
    check("no size attribute in Dropdown mode, so it drops down", sel().hasAttribute("size"), false);
}

console.log("\nDOM - rendering");
{
    dropdown.render(vm([data.items[0].key], false));
    check("header shows the column name", q(".ads-title").textContent, "Anio");
    check("closed box shows 2026, not Todos", sel().options[sel().selectedIndex].textContent, "2026");
    check("select carries the selection as its value", sel().value, data.items[0].key);
    check("title attribute is set for truncation tooltips", sel().title, "2026");
    check("aria-label names the column and the selection", sel().getAttribute("aria-label"), "Anio: 2026");
    check("font size is converted from points to pixels", sel().style.fontSize, ptToPx(10) + "px");
    check("a chevron is drawn since appearance:none removes the native one", !!q(".ads-chevron"), true);

    check("Select All plus one option per value", optionTexts(), ["Todos", "2026", "2025", "2024"]);
    check("Select All uses the sentinel value", optionValues()[0], ALL_OPTION_VALUE);
    check("values are in descending order", optionTexts().slice(1), ["2026", "2025", "2024"]);
    check("every option has a tooltip", Array.from(sel().options).every((o) => !!o.title), true);

    dropdown.render(vm([], true));
    check("Select All state selects the Todos option", sel().value, ALL_OPTION_VALUE);
    check("closed box reads Todos", sel().options[sel().selectedIndex].textContent, "Todos");
}

console.log("\nDOM - changing the selection");
{
    dropdown.render(vm([data.items[0].key], false));

    changes.length = 0;
    pick(data.items[1].key);
    check("picking 2025 reports that key", changes, [{ keys: [data.items[1].key], all: false }]);

    changes.length = 0;
    pick(ALL_OPTION_VALUE);
    check("picking Todos reports selectedAll", changes, [{ keys: [], all: true }]);

    // The host comes back with the new state; the box must follow it.
    dropdown.render(vm([], true));
    check("closed box follows the committed state", sel().value, ALL_OPTION_VALUE);
    dropdown.render(vm([data.items[2].key], false));
    check("closed box shows 2024 after that", sel().options[sel().selectedIndex].textContent, "2024");
}

console.log("\nDOM - Show Select All off");
{
    settings.selection.showSelectAll = false;
    dropdown.render(vm([data.items[0].key], false));
    check("no Todos option when the setting is off", optionTexts(), ["2026", "2025", "2024"]);

    dropdown.render(vm([], true));
    check("but the All state still gets a row so the box is never blank", optionTexts()[0], "Todos");
    settings.selection.showSelectAll = true;
}

console.log("\nDOM - custom Select All label (format-pane override)");
{
    const custom = resolveStrings("es-ES", undefined, { selectAll: "(Todos los anios)" });
    dropdown.render(vm([], true, { strings: custom }));
    check("the label is used in the list", optionTexts()[0], "(Todos los anios)");
    check("and in the closed box", sel().options[sel().selectedIndex].textContent, "(Todos los anios)");
}

console.log("\nDOM - localization: English host, Spanish host, host manager");
{
    const en = resolveStrings("en-US");
    dropdown.render(vm([], true, { strings: en }));
    check("en-US: Select All reads All", optionTexts()[0], "All");
    dropdown.render(vm([data.items[0].key, data.items[1].key], false, { strings: en }));
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "dropdown";
    dropdown.render(vm([data.items[0].key, data.items[1].key], false, { strings: en }));
    check("en-US: several values read N selected", closedText(), "2 selected");
    settings.selection.selectionMode = "singleOrAll";

    check("es-ES: Select All reads Todos", ES.selectAll, "Todos");
    check("es-MX falls back to the Spanish table", resolveStrings("es-MX").selectAll, "Todos");
    check("an unknown language falls back to English", resolveStrings("xx-XX").selectAll, "All");
    check("no locale at all is English", resolveStrings("").selectAll, "All");

    // A host localization manager wins over the tables.
    const manager = (key: string) => (key === "Visual_SelectAll" ? "Alle" : key);
    const de = resolveStrings("de-DE", manager);
    check("the host manager is used when it has the key", de.selectAll, "Alle");
    check("a key the manager lacks falls back to the table", de.noData, STRINGS_EN.Visual_NoData);
    check("a throwing manager is ignored", resolveStrings("es-ES", () => { throw new Error("x"); }).selectAll, STRINGS_ES.Visual_SelectAll);

    // Format-pane overrides beat everything.
    const over = resolveStrings("en-US", manager, { selectAll: "Everything", multiSelected: "{0} picked" });
    check("override: Select All", over.selectAll, "Everything");
    check("override: multi template", over.multiSelected(3), "3 picked");
    check("an empty override means the default", resolveStrings("en-US", undefined, { selectAll: "" }).selectAll, "All");

    check("resjson and tables share the same keys", Object.keys(STRINGS_EN).sort(), Object.keys(STRINGS_ES).sort());
}

console.log("\nDOM - Multi uses the same single-line native <select>");
{
    settings.selection.selectionMode = "multi";
    dropdown.render(vm([data.items[0].key], false));

    check("Multi still renders a <select>", sel().tagName, "SELECT");
    check("it is never <select multiple>", sel().multiple, false);
    check("no size attribute, so it stays a one-line dropdown", sel().hasAttribute("size"), false);
    check("there is no custom popup", root.querySelector(".ads-multi-popup"), null);
    check("there is no custom option list", root.querySelector(".ads-multi-list"), null);
    check("there are no HTML checkboxes outside the select", root.querySelector(".ads-checkbox"), null);
    check("there is no custom closed box", root.querySelector(".ads-multi-box"), null);
}

console.log("\nTEST 1 - Multi + Default Max ticks only the maximum");
{
    settings.selection.selectionMode = "multi";
    dropdown.render(vm([data.items[0].key], false));

    check("only the maximum is ticked", visibleTexts(), [
        UNTICKED + "Todos",
        TICKED + "2026",
        UNTICKED + "2025",
        UNTICKED + "2024"
    ]);
    check("the option values are the raw keys, never the glyphs", visibleOptions().map((o) => o.value), [
        ALL_OPTION_VALUE, data.items[0].key, data.items[1].key, data.items[2].key
    ]);
    check("tooltips carry the value without a glyph", visibleOptions()[1].title, "2026");
    check("the closed box shows no glyph", closedText(), "2026");

    // Pick 2025: it was not ticked, so it is added.
    changes.length = 0;
    pickValue(data.items[1].key);
    check("picking 2025 adds it to the selection", changes, [
        { keys: [data.items[0].key, data.items[1].key], all: false }
    ]);

    // The host commits and re-renders.
    dropdown.render(vm([data.items[0].key, data.items[1].key], false));
    check("both are now ticked", visibleTexts(), [
        UNTICKED + "Todos",
        TICKED + "2026",
        TICKED + "2025",
        UNTICKED + "2024"
    ]);
    check("the closed box counts them", closedText(), "2 seleccionados");
}

console.log("\nTEST 2 - picking a ticked value unticks it");
{
    settings.selection.selectionMode = "multi";
    dropdown.render(vm([data.items[0].key, data.items[1].key], false));

    changes.length = 0;
    pickValue(data.items[0].key);
    check("picking 2026 again removes it", changes, [{ keys: [data.items[1].key], all: false }]);

    dropdown.render(vm([data.items[1].key], false));
    check("2026 is unticked, 2025 stays ticked", visibleTexts(), [
        UNTICKED + "Todos",
        UNTICKED + "2026",
        TICKED + "2025",
        UNTICKED + "2024"
    ]);
    check("one value left, so the box shows it", closedText(), "2025");

    // Unticking the last one must not emit an empty IN list.
    changes.length = 0;
    pickValue(data.items[1].key);
    check("unticking the last value falls back to Select All", changes, [{ keys: [], all: true }]);
}

console.log("\nTEST 3 - Todos");
{
    settings.selection.selectionMode = "multi";
    dropdown.render(vm([data.items[0].key, data.items[1].key], false));

    changes.length = 0;
    pickValue(ALL_OPTION_VALUE);
    check("picking Todos clears the selection and drops the filter", changes, [{ keys: [], all: true }]);

    dropdown.render(vm([], true));
    check("Todos is the ticked row", visibleTexts(), [
        TICKED + "Todos",
        UNTICKED + "2026",
        UNTICKED + "2025",
        UNTICKED + "2024"
    ]);
    check("the closed box reads Todos, with no glyph", closedText(), "Todos");

    // From Todos, picking a value leaves the All state.
    changes.length = 0;
    pickValue(data.items[0].key);
    check("picking a value from Todos becomes an explicit selection", changes, [
        { keys: [data.items[0].key], all: false }
    ]);
}

console.log("\nDOM - Multi closed text");
{
    settings.selection.selectionMode = "multi";

    dropdown.render(vm([], true));
    check("Todos when nothing is picked", closedText(), "Todos");

    dropdown.render(vm([data.items[0].key], false));
    check("the value itself when one is picked", closedText(), "2026");

    dropdown.render(vm([data.items[0].key, data.items[1].key], false));
    check("a count when several are picked", closedText(), "2 seleccionados");

    dropdown.render(vm([data.items[0].key, data.items[1].key, data.items[2].key], false));
    check("the count follows the selection", closedText(), "3 seleccionados");
    check("the closed box never lists them all", closedText().indexOf("2026") < 0, true);
    check("no tick marks leak into the closed box", closedText().indexOf("\u2611") < 0, true);
    check("the tooltip matches", sel().title, "3 seleccionados");

    check("the display option is hidden from the list", sel().options[0].hidden, true);
    check("and it is the one selected", sel().selectedIndex, 0);
    check("its value is never a real key", sel().options[0].value, "");

    dropdown.render(vm([data.items[0].key, data.items[1].key], false, { strings: resolveStrings("es-ES", undefined, { multiSelected: "{0} elegidos" }) }));
    check("the label is configurable", closedText(), "2 elegidos");
}

console.log("\nDOM - Multi state comes from selectedKeys, not selectedIndex");
{
    settings.selection.selectionMode = "multi";
    dropdown.render(vm([data.items[0].key], false));
    check("the box points at the display option, not at 2026", sel().selectedIndex, 0);

    // Picking the same option twice in a row must be possible: the box resets
    // to the display option after every render, so `change` fires again.
    changes.length = 0;
    pickValue(data.items[1].key);
    dropdown.render(vm([data.items[0].key, data.items[1].key], false));
    check("the box reset to the display option", sel().selectedIndex, 0);
    pickValue(data.items[1].key);
    check("the same option can be picked again", changes.length, 2);
    check("and the second pick unticks it", changes[1], { keys: [data.items[0].key], all: false });
}

console.log("\nTEST 1 - Multi + Dropdown: toggle, closed text, and auto-reopen attempt");
{
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "dropdown";
    const el = sel() as HTMLSelectElement & { showPicker?: () => void };

    let calls = 0;
    el.showPicker = () => { calls++; };

    dropdown.render(vm([data.items[0].key], false));
    check("start: 2026", closedText(), "2026");
    check("open list: only the maximum ticked", visibleTexts(), [UNTICKED + "Todos", TICKED + "2026", UNTICKED + "2025", UNTICKED + "2024"]);

    // The host commits synchronously inside the change event, like Visual.commit().
    const listener = () => dropdown.render(vm([data.items[0].key, data.items[1].key], false));
    el.addEventListener("change", listener);
    changes.length = 0;
    pickValue(data.items[1].key);
    el.removeEventListener("change", listener);

    check("state: [2026, 2025]", changes, [{ keys: [data.items[0].key, data.items[1].key], all: false }]);
    check("closed text: 2 seleccionados", closedText(), "2 seleccionados");
    check("labels updated: both ticked", visibleTexts(), [UNTICKED + "Todos", TICKED + "2026", TICKED + "2025", UNTICKED + "2024"]);
    check("auto-reopen was attempted once", calls, 1);
    delete el.showPicker;
}

console.log("\nDOM - reopen is smooth: options are updated in place, never recreated");
{
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "dropdown";
    dropdown.render(vm([data.items[0].key], false));
    const before = Array.from(sel().options);

    dropdown.render(vm([data.items[0].key, data.items[1].key], false));
    const after = Array.from(sel().options);
    check("same number of option nodes", after.length, before.length);
    check("the very same <option> elements survive a selection change", after.every((o, i) => o === before[i]), true);
    check("but their labels changed", after.map((o) => o.textContent).slice(1), [UNTICKED + "Todos", TICKED + "2026", TICKED + "2025", UNTICKED + "2024"]);
    check("and the display option text changed in place", after[0].textContent, "2 seleccionados");

    dropdown.render(vm([], true));
    check("Todos state also updates in place", Array.from(sel().options).every((o, i) => o === before[i]), true);
    check("with Todos ticked", visibleTexts()[0], TICKED + "Todos");

    // Only a structural change (the items) rebuilds the nodes.
    const more = makeItems([2023, 2024, 2025, 2026]);
    dropdown.render(vm([], true, { items: more.items }));
    check("a data change does rebuild", Array.from(sel().options).length, before.length + 1);
}

console.log("\nTEST 2 - showPicker fails or is missing: selection still works, dropdown stays closed");
{
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "dropdown";
    const el = sel() as HTMLSelectElement & { showPicker?: () => void };

    // Missing entirely (jsdom has none).
    delete el.showPicker;
    check("jsdom has no showPicker", typeof el.showPicker, "undefined");
    dropdown.render(vm([data.items[0].key], false));
    changes.length = 0;
    pickValue(data.items[1].key);
    check("no showPicker: the pick still toggles", changes, [{ keys: [data.items[0].key, data.items[1].key], all: false }]);

    // Throws SecurityError / NotAllowedError.
    for (const name of ["SecurityError", "NotAllowedError", "InvalidStateError"]) {
        el.showPicker = () => { const e = new Error("blocked"); e.name = name; throw e; };
        dropdown.render(vm([data.items[0].key], false));
        changes.length = 0;
        let threw = false;
        try {
            pickValue(data.items[1].key);
        } catch (_e) {
            threw = true;
        }
        check(`${name}: no error escapes`, threw, false);
        check(`${name}: the selection went through`, changes.length, 1);
        dropdown.render(vm([data.items[0].key, data.items[1].key], false));
        check(`${name}: closed text is correct`, closedText(), "2 seleccionados");
    }
    delete el.showPicker;

    // Single modes and List never call it.
    let calls = 0;
    el.showPicker = () => { calls++; };
    settings.selection.selectionMode = "singleOrAll";
    dropdown.render(vm([data.items[0].key], false));
    pickValue(data.items[1].key);
    check("Single or All never reopens", calls, 0);
    settings.selection.selectionMode = "single";
    dropdown.render(vm([data.items[0].key], false));
    pickValue(data.items[1].key);
    check("Single never reopens", calls, 0);
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "list";
    dropdown.render(vm([data.items[0].key], false));
    optionByValue(data.items[1].key).dispatchEvent(new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    check("List never reopens", calls, 0);
    delete el.showPicker;
    settings.selection.multiDisplay = "dropdown";
    settings.selection.selectionMode = "singleOrAll";

    // No popup of ours exists in any body.
    check("no custom popup element exists", root.querySelector(".ads-multi-popup, .ads-popup, .ads-dialog-button"), null);
    check("no absolutely positioned panel exists", Array.from(root.querySelectorAll("div")).some((d) => (d as HTMLElement).style.position === "absolute"), false);
}

console.log("\nDOM - immediate feedback after a Multi pick");
{
    settings.selection.selectionMode = "multi";
    dropdown.render(vm([data.items[0].key], false));
    check("before: the box reads 2026", closedText(), "2026");
    check("before: aria-label reads 2026", sel().getAttribute("aria-label"), "Anio: 2026");

    // Simulate exactly what Visual.commit() does: callback, then a synchronous
    // re-render with the new state, all inside the change event.
    let synchronous = "";
    const originalCallbacks = changes.length;
    const listener = () => {
        dropdown.render(vm([data.items[0].key, data.items[1].key], false));
        synchronous = closedText();
    };
    sel().addEventListener("change", listener);
    pickValue(data.items[1].key);
    sel().removeEventListener("change", listener);

    check("the pick raised the callback", changes.length, originalCallbacks + 1);
    check("the closed text updated inside the same event", synchronous, "2 seleccionados");
    check("the tooltip updated too", sel().title, "2 seleccionados");
    check("aria-label reflects the count", sel().getAttribute("aria-label"), "Anio: 2 seleccionados");
    check("the list already shows both ticked for the next open", visibleTexts(), [
        UNTICKED + "Todos",
        TICKED + "2026",
        TICKED + "2025",
        UNTICKED + "2024"
    ]);
    settings.selection.selectionMode = "singleOrAll";
}

console.log("\nTEST 1 - Multi + List: click toggles without Ctrl");
{
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "list";
    settings.selection.visibleRows = 5;
    dropdown.render(vm([data.items[0].key], false));

    check("the control is a <select multiple>", sel().multiple, true);
    check("rendered as a fixed list: size = Visible rows", sel().size, 5);
    check("no chevron on a list box", q(".ads-chevron").style.display, "none");
    check("no hidden display option", sel().options[0].hidden, false);
    check("plain labels, no tick marks", optionTexts(), ["Todos", "2026", "2025", "2024"]);
    check("Default Max highlights only the maximum", highlighted(), ["2026"]);
    check("no custom popup: the select wrap is the only body", q(".ads-select-wrap").style.display !== "none", true);

    // Click 2025 without Ctrl.
    changes.length = 0;
    const prevented = clickRow(data.items[1].key);
    check("the browser's replace-on-click is cancelled", prevented, true);
    check("2025 is added, 2026 is kept", changes, [{ keys: [data.items[0].key, data.items[1].key], all: false }]);

    dropdown.render(vm([data.items[0].key, data.items[1].key], false));
    check("both rows are highlighted", highlighted(), ["2026", "2025"]);
    check("the list stays a list after a commit", [sel().multiple, sel().size], [true, 5]);

    // Click 2026 without Ctrl.
    changes.length = 0;
    clickRow(data.items[0].key);
    check("2026 is removed, 2025 is kept", changes, [{ keys: [data.items[1].key], all: false }]);
    dropdown.render(vm([data.items[1].key], false));
    check("only 2025 is highlighted", highlighted(), ["2025"]);

    // Unticking the last one falls back to Todos.
    changes.length = 0;
    clickRow(data.items[1].key);
    check("unticking the last value falls back to Select All", changes, [{ keys: [], all: true }]);
}

console.log("\nBUG CHECK - Multi + List renders clean text, never ☑ / ☐");
{
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "list";
    const k2026 = data.items[0].key;

    dropdown.render(vm([k2026], false));
    const opt2026 = Array.from(sel().options).find((o) => o.value === k2026) as HTMLOptionElement;
    check("option.textContent === \"2026\"", opt2026.textContent, "2026");
    check("not \"☑ 2026\"", opt2026.textContent !== TICKED + "2026", true);
    check("not \"☐ 2026\"", opt2026.textContent !== UNTICKED + "2026", true);
    check("selected state is option.selected, not a glyph", opt2026.selected, true);
    check("no option in the list carries a glyph", Array.from(sel().options).some((o) => /[\u2610\u2611]/.test(o.textContent)), false);
    check("Todos is clean too", sel().options[0].textContent, "Todos");

    // The same holds for every selection state the list can be in.
    dropdown.render(vm([], true));
    check("All state: clean labels", optionTexts(), ["Todos", "2026", "2025", "2024"]);
    dropdown.render(vm([data.items[0].key, data.items[1].key, data.items[2].key], false));
    check("everything selected: clean labels", optionTexts(), ["Todos", "2026", "2025", "2024"]);
    check("and all three highlighted", highlighted(), ["2026", "2025", "2024"]);

    // Coming FROM the dropdown-multi body (which does use glyphs) the list is rebuilt clean.
    settings.selection.multiDisplay = "dropdown";
    dropdown.render(vm([k2026], false));
    check("Multi + Dropdown does carry glyphs", visibleTexts()[1], TICKED + "2026");
    settings.selection.multiDisplay = "list";
    dropdown.render(vm([k2026], false));
    check("switching to List drops them", optionTexts(), ["Todos", "2026", "2025", "2024"]);
    settings.selection.multiDisplay = "dropdown";
}

console.log("\nBUG CHECK - tickPrefix is exclusive to Multi + Dropdown");
{
    const combos: [string, string, string][] = [
        ["single", "dropdown", ""],
        ["single", "list", ""],
        ["singleOrAll", "dropdown", ""],
        ["singleOrAll", "list", ""],
        ["multi", "list", ""],
        ["multi", "dropdown", TICKED]
    ];
    for (const [mode, display, expectedOn] of combos) {
        settings.selection.selectionMode = mode as typeof settings.selection.selectionMode;
        settings.selection.multiDisplay = display as typeof settings.selection.multiDisplay;
        const expectedOff = expectedOn ? UNTICKED : "";
        check(`${mode} + ${display}: selected -> ${JSON.stringify(expectedOn)}`, tickPrefix(settings, true), expectedOn);
        check(`${mode} + ${display}: unselected -> ${JSON.stringify(expectedOff)}`, tickPrefix(settings, false), expectedOff);
    }
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "list";
}

console.log("\nTEST 2 - List: Todos");
{
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "list";
    dropdown.render(vm([data.items[0].key, data.items[1].key], false));
    changes.length = 0;
    clickRow(ALL_OPTION_VALUE);
    check("clicking Todos clears the selection and drops the filter", changes, [{ keys: [], all: true }]);
    dropdown.render(vm([], true));
    check("Todos is the only highlighted row", highlighted(), ["Todos"]);
}

console.log("\nTEST 3 - List: a value after Todos");
{
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "list";
    dropdown.render(vm([], true));
    changes.length = 0;
    clickRow(data.items[1].key);
    check("2025 becomes an explicit selection", changes, [{ keys: [data.items[1].key], all: false }]);
    dropdown.render(vm([data.items[1].key], false));
    check("Todos is unhighlighted, 2025 highlighted", highlighted(), ["2025"]);
}

console.log("\nTEST 4 - List: Visible rows");
{
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "list";
    settings.selection.visibleRows = 3;
    dropdown.render(vm([data.items[0].key], false));
    check("Visible rows = 3 gives size 3, the rest scrolls", sel().size, 3);
    check("all rows still exist for scrolling", sel().options.length, 4);
    settings.selection.visibleRows = 5;
}

console.log("\nDOM - List: keyboard and edge cases");
{
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "list";
    dropdown.render(vm([data.items[0].key], false));

    // Keyboard path: the platform changes the selection and fires change.
    changes.length = 0;
    for (const o of Array.from(sel().options)) {
        o.selected = o.value === data.items[2].key || o.value === data.items[0].key;
    }
    sel().dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    check("a keyboard selection is read back as state", changes, [{ keys: [data.items[0].key, data.items[2].key], all: false }]);

    changes.length = 0;
    for (const o of Array.from(sel().options)) {
        o.selected = o.value === ALL_OPTION_VALUE;
    }
    sel().dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    check("selecting Todos by keyboard is Select All", changes, [{ keys: [], all: true }]);

    changes.length = 0;
    for (const o of Array.from(sel().options)) {
        o.selected = false;
    }
    sel().dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    check("an emptied list is Select All, never IN []", changes, [{ keys: [], all: true }]);

    // Clicks that do not land on a row are left to the browser (scrollbar, padding).
    changes.length = 0;
    const onSelect = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
    sel().dispatchEvent(onSelect);
    check("a mousedown on the select itself is not intercepted", onSelect.defaultPrevented, false);
    check("and changes nothing", changes.length, 0);

    // Right-click is not a toggle.
    const right = new dom.window.MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 });
    optionByValue(data.items[1].key).dispatchEvent(right);
    check("a right-click is not a toggle", changes.length, 0);

    // Show Select All off: no Todos row, and the last untick still works.
    settings.selection.showSelectAll = false;
    dropdown.render(vm([data.items[0].key], false));
    check("no Todos row when Show Select All is off", optionTexts(), ["2026", "2025", "2024"]);
    changes.length = 0;
    clickRow(data.items[0].key);
    check("unticking the only value still falls back to All", changes, [{ keys: [], all: true }]);
    settings.selection.showSelectAll = true;

    dropdown.render(vm([data.items[0].key], false, { items: [], placeholder: "Add a field to Value" }));
    check("placeholder renders as a plain disabled select", [sel().multiple, sel().disabled], [false, true]);
}

console.log("\nDOM - List never breaks the other bodies");
{
    settings.selection.selectionMode = "multi";
    settings.selection.multiDisplay = "dropdown";
    dropdown.render(vm([data.items[0].key], false));
    check("Multi + Dropdown is still the single-line select with tick marks", [sel().multiple, sel().hasAttribute("size")], [false, false]);
    check("with tick marks", visibleTexts()[1], TICKED + "2026");

    settings.selection.multiDisplay = "list";
    dropdown.render(vm([data.items[0].key], false));
    check("List shows the list box", q(".ads-select-wrap").style.display !== "none", true);
    check("and it is a list box", sel().multiple, true);

    settings.selection.selectionMode = "singleOrAll";
    dropdown.render(vm([data.items[0].key], false));
    check("Single or All ignores Multi display", [sel().multiple, sel().hasAttribute("size")], [false, false]);
    check("and shows plain labels", optionTexts(), ["Todos", "2026", "2025", "2024"]);
    settings.selection.selectionMode = "single";
    dropdown.render(vm([data.items[0].key], false));
    check("so does Single", [sel().multiple, sel().hasAttribute("size")], [false, false]);

    settings.selection.selectionMode = "singleOrAll";
    settings.selection.multiDisplay = "dropdown";
}

console.log("\nDOM - switching modes rebuilds the list");
{
    settings.selection.selectionMode = "singleOrAll";
    dropdown.render(vm([data.items[0].key], false));
    check("Single or All has no glyphs", visibleTexts(), ["Todos", "2026", "2025", "2024"]);
    check("and no hidden display option", sel().options[0].hidden, false);
    check("the select carries the selection", sel().value, data.items[0].key);

    settings.selection.selectionMode = "single";
    dropdown.render(vm([data.items[1].key], false));
    check("Single has no glyphs either", visibleTexts(), ["Todos", "2026", "2025", "2024"]);
    check("Single is never multiple", sel().multiple, false);

    settings.selection.selectionMode = "multi";
    dropdown.render(vm([data.items[1].key], false));
    check("Multi rebuilds with glyphs", visibleTexts(), [
        UNTICKED + "Todos",
        UNTICKED + "2026",
        TICKED + "2025",
        UNTICKED + "2024"
    ]);

    settings.selection.selectionMode = "singleOrAll";
    dropdown.render(vm([data.items[1].key], false));
    check("switching back drops the glyphs again", visibleTexts(), ["Todos", "2026", "2025", "2024"]);
    check("and restores the selection", sel().value, data.items[1].key);
}

console.log("\nDOM - clear button");
{
    dropdown.render(vm([data.items[0].key], false));
    clears.length = 0;
    q(".ads-clear").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    check("the clear button raises onClear", clears.length, 1);

    settings.header.showClear = false;
    dropdown.render(vm([data.items[0].key], false));
    check("the clear button can be hidden", q(".ads-clear").style.display, "none");
    settings.header.showClear = true;

    settings.header.show = false;
    dropdown.render(vm([data.items[0].key], false));
    check("the header can be hidden", q(".ads-header").style.display, "none");
    settings.header.show = true;
}

console.log("\nDOM - no data and high contrast");
{
    dropdown.render(vm([], true, { items: [], placeholder: "Add a field to Value" }));
    check("placeholder is shown when Value is empty", sel().options[0].textContent, "Add a field to Value");
    check("the select is disabled", sel().disabled, true);

    dropdown.render(vm([data.items[0].key], false));
    check("the select is re-enabled once data arrives", sel().disabled, false);
    check("options are rebuilt after the placeholder", optionTexts(), ["Todos", "2026", "2025", "2024"]);

    dropdown.render(vm([data.items[0].key], false, {
        highContrast: {
            active: true,
            foreground: "#FFFF00",
            background: "#000000",
            foregroundSelected: "#000000",
            hyperlink: "#00FFFF"
        }
    }));
    check("high contrast class is applied", root.className.indexOf("ads-hc") >= 0, true);
    check("high contrast colours are used", sel().style.color, "rgb(255, 255, 0)");
    check("high contrast keeps showing the real selection", sel().options[sel().selectedIndex].textContent, "2026");
}

console.log("\nDOM - large lists are capped");
{
    settings.selection.selectionMode = "singleOrAll";
    const many = makeItems(Array.from({ length: 1500 }, (_, i) => i + 1));
    dropdown.render(vm([], true, { items: many.items }));
    // 1 Select All + 1000 values + 1 disabled "+500 more" row.
    check("option count is capped", sel().options.length, 1002);
    check("the overflow row explains itself (localized)", sel().options[1001].textContent, "+500 más");
    check("the overflow row is not selectable", sel().options[1001].disabled, true);
}

dropdown.destroy();

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
    process.exit(1);
}
