import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import DataViewObjects = powerbi.DataViewObjects;
import DataViewObject = powerbi.DataViewObject;
import Fill = powerbi.Fill;

import { SelectionMode, MultiDisplay, DefaultSelection, DefaultBehavior, ClearBehavior, SortDirection } from "./types";

/**
 * Defaults are chosen so that the visual looks like a native Power BI slicer
 * (Segoe UI 10pt, #252423 text, #C8C6C4 border) without touching the format pane.
 */
export class SelectionSettings {
    selectionMode: SelectionMode = "singleOrAll";
    /** Multi only. */
    multiDisplay: MultiDisplay = "dropdown";
    /** Multi + List only: rows the list box tries to show (select.size). */
    visibleRows = 5;
    defaultSelection: DefaultSelection = "max";
    defaultBehavior: DefaultBehavior = "onLoad";
    showSelectAll = true;
    /** Empty means "use the localized resource" (Visual_SelectAll). */
    selectAllLabel = "";
    /**
     * Shown in Multi mode when several values are ticked; {0} is the count.
     * Empty means "use the localized resource" (Visual_MultiSelected).
     */
    multiSelectionLabel = "";
    clearBehavior: ClearBehavior = "default";
    sortDirection: SortDirection = "desc";
}

export class HeaderSettings {
    show = true;
    text = "";
    fontFamily = '"Segoe UI", wf_segoe-ui_normal, helvetica, arial, sans-serif';
    fontSize = 10;
    bold = false;
    italic = false;
    fontColor = "#252423";
    showClear = true;
}

export class ControlSettings {
    fontFamily = '"Segoe UI", wf_segoe-ui_normal, helvetica, arial, sans-serif';
    fontSize = 10;
    fontColor = "#252423";
    background = "#FFFFFF";
    showBorder = true;
    borderColor = "#C8C6C4";
    borderRadius = 2;
}

export class DropdownSettings {
    background = "#FFFFFF";
    fontColor = "#252423";
}

export class VisualSettings {
    selection = new SelectionSettings();
    header = new HeaderSettings();
    control = new ControlSettings();
    dropdown = new DropdownSettings();
}

// ---------------------------------------------------------------------------
// Reading persisted object values out of the DataView
// ---------------------------------------------------------------------------

function objects(dataView: DataView): DataViewObjects {
    return (dataView && dataView.metadata && dataView.metadata.objects) || {};
}

function group(dataView: DataView, objectName: string): DataViewObject {
    const o = objects(dataView)[objectName];
    return (o as DataViewObject) || {};
}

function getBool(o: DataViewObject, prop: string, fallback: boolean): boolean {
    const v = o[prop];
    return typeof v === "boolean" ? v : fallback;
}

function getNumber(o: DataViewObject, prop: string, fallback: number, min: number, max: number): number {
    const v = o[prop];
    if (typeof v !== "number" || !isFinite(v)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, v));
}

function getText(o: DataViewObject, prop: string, fallback: string): string {
    const v = o[prop];
    return typeof v === "string" && v.length > 0 ? v : fallback;
}

/** Text that is allowed to be empty (e.g. a title the user deliberately blanked). */
function getTextAllowEmpty(o: DataViewObject, prop: string, fallback: string): string {
    const v = o[prop];
    return typeof v === "string" ? v : fallback;
}

function getEnum<T extends string>(o: DataViewObject, prop: string, allowed: T[], fallback: T): T {
    const v = o[prop];
    return typeof v === "string" && allowed.indexOf(v as T) >= 0 ? (v as T) : fallback;
}

function getFill(o: DataViewObject, prop: string, fallback: string): string {
    const v = o[prop] as Fill | string;
    if (typeof v === "string") {
        return v;
    }
    if (v && (v as Fill).solid && (v as Fill).solid.color) {
        return (v as Fill).solid.color as string;
    }
    return fallback;
}

export function parseSettings(dataView: DataView): VisualSettings {
    const s = new VisualSettings();

    const sel = group(dataView, "selection");
    s.selection.selectionMode = getEnum(sel, "selectionMode", ["single", "multi", "singleOrAll"], s.selection.selectionMode);
    s.selection.multiDisplay = getEnum(sel, "multiDisplay", ["dropdown", "list"], s.selection.multiDisplay);
    s.selection.visibleRows = Math.round(getNumber(sel, "visibleRows", s.selection.visibleRows, 2, 20));
    s.selection.defaultSelection = getEnum(sel, "defaultSelection", ["none", "max", "min"], s.selection.defaultSelection);
    s.selection.defaultBehavior = getEnum(sel, "defaultBehavior", ["onLoad", "onlyWhenEmpty"], s.selection.defaultBehavior);
    s.selection.showSelectAll = getBool(sel, "showSelectAll", s.selection.showSelectAll);
    s.selection.selectAllLabel = getTextAllowEmpty(sel, "selectAllLabel", s.selection.selectAllLabel);
    s.selection.multiSelectionLabel = getTextAllowEmpty(sel, "multiSelectionLabel", s.selection.multiSelectionLabel);
    s.selection.clearBehavior = getEnum(sel, "clearBehavior", ["default", "all", "none"], s.selection.clearBehavior);
    s.selection.sortDirection = getEnum(sel, "sortDirection", ["asc", "desc"], s.selection.sortDirection);

    const header = group(dataView, "header");
    s.header.show = getBool(header, "show", s.header.show);
    s.header.text = getTextAllowEmpty(header, "text", s.header.text);
    s.header.fontFamily = getText(header, "fontFamily", s.header.fontFamily);
    s.header.fontSize = getNumber(header, "fontSize", s.header.fontSize, 6, 40);
    s.header.bold = getBool(header, "bold", s.header.bold);
    s.header.italic = getBool(header, "italic", s.header.italic);
    s.header.fontColor = getFill(header, "fontColor", s.header.fontColor);
    s.header.showClear = getBool(header, "showClear", s.header.showClear);

    const control = group(dataView, "control");
    s.control.fontFamily = getText(control, "fontFamily", s.control.fontFamily);
    s.control.fontSize = getNumber(control, "fontSize", s.control.fontSize, 6, 40);
    s.control.fontColor = getFill(control, "fontColor", s.control.fontColor);
    s.control.background = getFill(control, "background", s.control.background);
    s.control.showBorder = getBool(control, "showBorder", s.control.showBorder);
    s.control.borderColor = getFill(control, "borderColor", s.control.borderColor);
    s.control.borderRadius = getNumber(control, "borderRadius", s.control.borderRadius, 0, 20);

    const dd = group(dataView, "dropdown");
    s.dropdown.background = getFill(dd, "background", s.dropdown.background);
    s.dropdown.fontColor = getFill(dd, "fontColor", s.dropdown.fontColor);

    return s;
}
