/**
 * Packaged-bundle test.
 *
 * Every other suite runs the TypeScript sources. This one runs the JavaScript
 * that is actually inside dist/*.pbiviz - the file you import into Power BI -
 * in jsdom, with a fake host, and checks what each Selection mode renders.
 * If this passes, the artefact is right; if Power BI shows something else, it
 * is running a different build.
 *
 *   npm run test:bundle        (needs a fresh `npm run package` first)
 */

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { JSDOM } = require("jsdom");

let failures = 0;
let passes = 0;
function check(name, actual, expected) {
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

// --- locate and unzip the package ------------------------------------------

const distDir = path.join(process.cwd(), "dist");
const pbiviz = fs.existsSync(distDir) ? fs.readdirSync(distDir).find((f) => f.endsWith(".pbiviz")) : null;
if (!pbiviz) {
    console.log("No dist/*.pbiviz found - run `npm run package` first.");
    process.exit(1);
}
const buf = fs.readFileSync(path.join(distDir, pbiviz));
let eocd = buf.length - 22;
while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
let off = buf.readUInt32LE(eocd + 16);
let pkg = null;
for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const nl = buf.readUInt16LE(off + 28), el = buf.readUInt16LE(off + 30), cl = buf.readUInt16LE(off + 32);
    const cs = buf.readUInt32LE(off + 20), lho = buf.readUInt32LE(off + 42), m = buf.readUInt16LE(off + 10);
    const name = buf.slice(off + 46, off + 46 + nl).toString();
    if (name.endsWith("pbiviz.json")) {
        const a = buf.readUInt16LE(lho + 26), b = buf.readUInt16LE(lho + 28);
        const d = buf.slice(lho + 30 + a + b, lho + 30 + a + b + cs);
        pkg = JSON.parse((m === 8 ? zlib.inflateRawSync(d) : d).toString());
    }
    off += 46 + nl + el + cl;
}
console.log(`\nBUNDLE - ${pbiviz} (v${pkg.visual.version}, api ${pkg.apiVersion})`);

// --- run one instance of the packaged visual --------------------------------

function run(selection, hostCaps, hostExtras) {
    const dom = new JSDOM("<!doctype html><html><head></head><body><div id='v'></div></body></html>", {
        runScripts: "outside-only",
        pretendToBeVisual: true
    });
    const w = dom.window;
    w.powerbi = { extensibility: { visual: {} }, visuals: {} };
    w.eval(pkg.content.js);
    const plugin = w.powerbi.visuals.plugins[pkg.visual.guid];

    const applied = [];
    const host = Object.assign({
        locale: "es-ES",
        hostCapabilities: Object.assign({ allowInteractions: true }, hostCaps || {}),
        colorPalette: { isHighContrast: false },
        eventService: { renderingStarted() {}, renderingFinished() {}, renderingFailed() {} },
        createSelectionManager: () => ({ showContextMenu() {} }),
        applyJsonFilter: (f, o, p, action) => applied.push({ filter: f, action })
    }, hostExtras || {});
    const visual = plugin.create({ element: w.document.getElementById("v"), host });

    const dv = {
        metadata: { columns: [], objects: { selection } },
        categorical: {
            categories: [{
                source: { displayName: "# Anio", queryName: "# Calendario.# Anio", roles: { value: true }, type: {} },
                values: [2024, 2025, 2026]
            }]
        }
    };
    const update = (jsonFilters) => visual.update({ dataViews: [dv], viewport: { width: 200, height: 120 }, jsonFilters });
    update([]);
    const last = applied[applied.length - 1];
    update(last && last.filter ? [last.filter] : []);

    const sel = w.document.querySelector("select");
    return {
        w,
        sel,
        applied,
        texts: () => Array.from(sel.options).map((o) => o.textContent),
        visibleTexts: () => Array.from(sel.options).filter((o) => !o.hidden).map((o) => o.textContent),
        highlighted: () => Array.from(sel.options).filter((o) => o.selected).map((o) => o.textContent),
        hasGlyph: () => Array.from(sel.options).some((o) => /[☐☑]/.test(o.textContent)),
        root: () => w.document.getElementById("v")
    };
}

// --- Multi + List: the reported bug ------------------------------------------

{
    const r = run({ selectionMode: "multi", multiDisplay: "list", visibleRows: 3 });
    check("Multi + List: <select multiple>", r.sel.multiple, true);
    check("Multi + List: size = Visible rows", r.sel.getAttribute("size"), "3");
    check("Multi + List: clean labels", r.texts(), ["Todos", "2026", "2025", "2024"]);
    check("Multi + List: option.textContent === \"2026\"", r.texts()[1], "2026");
    check("Multi + List: no ☑ / ☐ anywhere", r.hasGlyph(), false);
    check("Multi + List + Max: only the maximum highlighted", r.highlighted(), ["2026"]);
    check("Multi + List: a filter for the default was applied", r.applied.length >= 1 && r.applied[0].action === 0, true);
}

// --- Multi + Dropdown: the only body with glyphs -------------------------------

{
    const r = run({ selectionMode: "multi", multiDisplay: "dropdown" });
    check("Multi + Dropdown: single-line select", [r.sel.multiple, r.sel.hasAttribute("size")], [false, false]);
    check("Multi + Dropdown: tick marks present", r.visibleTexts(), ["☐ Todos", "☑ 2026", "☐ 2025", "☐ 2024"]);
    check("Multi + Dropdown: closed text is clean", r.sel.options[r.sel.selectedIndex].textContent, "2026");
}

// --- TEST 5: no Dialog API anywhere in the shipped bundle ------------------------

{
    const js = pkg.content.js;
    check("bundle never calls openModalDialog", js.includes("openModalDialog"), false);
    check("bundle never checks allowModalDialog", js.includes("allowModalDialog"), false);
    // pbiviz's own plugin wrapper READS globalThis.dialogRegistry for every
    // visual; what must be absent is any WRITE to it, which only a dialog
    // implementation would do.
    check("bundle registers no dialog", /dialogRegistrys*=|dialogRegistry[[^]]+]s*=/.test(js), false);
    check("no dialog id in the bundle", js.includes("AutoDefaultSlicerMultiDialog"), false);
    check("no dialog css in the bundle", js.includes(".adsd-"), false);
    check("no dialog button css in the stylesheet", pkg.content.css.includes(".ads-dialog-button"), false);
    check("bundle does use showPicker for the Multi dropdown", js.includes("showPicker"), true);
    check("no custom popup css", ["ads-popup", "ads-multi-popup", "ads-multi-list", "ads-checkbox"].some((c) => pkg.content.css.includes(c)), false);
}

{
    const r = run({ selectionMode: "multi", multiDisplay: "dropdown" });
    check("Multi + Dropdown renders no button and no panel", r.root().querySelector("button.ads-select, .ads-multi-popup, .ads-popup"), null);
    check("Multi + Dropdown: the clear button is the only <button>", r.root().querySelectorAll("button").length, 1);
}

// --- Localization -----------------------------------------------------------------

{
    const es = run({ selectionMode: "singleOrAll" });
    check("es-ES host without a localization manager: Todos", es.texts()[0], "Todos");
    const en = run({ selectionMode: "singleOrAll" }, {}, { locale: "en-US" });
    check("en-US host: All", en.texts()[0], "All");
    const mx = run({ selectionMode: "singleOrAll" }, {}, { locale: "es-MX" });
    check("es-MX host falls back to the Spanish table: Todos", mx.texts()[0], "Todos");
    const managed = run({ selectionMode: "singleOrAll" }, {}, {
        locale: "fr-FR",
        createLocalizationManager: () => ({ getDisplayName: (k) => (k === "Visual_SelectAll" ? "Tous" : k) })
    });
    check("a host localization manager is used", managed.texts()[0], "Tous");
    const over = run({ selectionMode: "singleOrAll", selectAllLabel: "(all years)" }, {}, { locale: "es-ES" });
    check("the format-pane label overrides the resource", over.texts()[0], "(all years)");
    const multi = run({ selectionMode: "multi", multiDisplay: "dropdown" }, {}, { locale: "en-US" });
    check("en-US Multi + Dropdown closed text is clean English", multi.sel.options[multi.sel.selectedIndex].textContent, "2026");
    check("string resources are packaged for en-US and es-ES", Object.keys(pkg.stringResources || {}).sort(), ["en-US", "es-ES"]);
    check("bundle uses createLocalizationManager", pkg.content.js.includes("createLocalizationManager"), true);
}

// --- Single bodies: untouched -----------------------------------------------------

{
    const r = run({ selectionMode: "singleOrAll" });
    check("Single or All: clean labels", r.texts(), ["Todos", "2026", "2025", "2024"]);
    check("Single or All: 2026 selected", r.highlighted(), ["2026"]);
    check("Single or All: not multiple", r.sel.multiple, false);
}
{
    const r = run({ selectionMode: "single" });
    check("Single: clean labels", r.texts(), ["Todos", "2026", "2025", "2024"]);
    check("Single: not multiple", r.sel.multiple, false);
}
{
    const r = run({ selectionMode: "singleOrAll", multiDisplay: "list", visibleRows: 8 });
    check("Multi display is ignored outside Multi", [r.sel.multiple, r.sel.hasAttribute("size")], [false, false]);
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) {
    process.exit(1);
}
