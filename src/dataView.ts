import powerbi from "powerbi-visuals-api";
import DataView = powerbi.DataView;
import DataViewCategoryColumn = powerbi.DataViewCategoryColumn;
import DataViewMetadataColumn = powerbi.DataViewMetadataColumn;
import PrimitiveValue = powerbi.PrimitiveValue;

import { valueFormatter as vf } from "powerbi-visuals-utils-formattingutils";

import { SlicerItem, SlicerData, FilterTarget, SortDirection } from "./types";

/**
 * Builds a stable identity for a value. This key is what we persist so that a
 * selection survives a refresh, a bookmark or a report reopen.
 */
export function itemKey(value: PrimitiveValue): string {
    if (value === null || value === undefined) {
        return "__blank__";
    }
    if (value instanceof Date) {
        return "d:" + value.getTime();
    }
    switch (typeof value) {
        case "number":
            return "n:" + value;
        case "boolean":
            return "b:" + (value ? "1" : "0");
        default:
            return "s:" + String(value);
    }
}

function isBlank(value: PrimitiveValue): boolean {
    if (value === null || value === undefined) {
        return true;
    }
    if (typeof value === "string" && value.length === 0) {
        return true;
    }
    if (value instanceof Date && isNaN(value.getTime())) {
        return true;
    }
    return false;
}

/**
 * Deterministic comparison used both for ordering and for resolving Max / Min.
 * Numbers compare numerically, dates by timestamp, everything else with the
 * host locale collation (so "Ñ" lands where the user expects it).
 */
export function compareValues(a: PrimitiveValue, b: PrimitiveValue, locale: string): number {
    if (a === b) {
        return 0;
    }
    if (isBlank(a)) {
        return isBlank(b) ? 0 : -1;
    }
    if (isBlank(b)) {
        return 1;
    }
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() - b.getTime();
    }
    if (typeof a === "number" && typeof b === "number") {
        return a - b;
    }
    if (typeof a === "boolean" && typeof b === "boolean") {
        return (a ? 1 : 0) - (b ? 1 : 0);
    }
    const sa = a instanceof Date ? a.toISOString() : String(a);
    const sb = b instanceof Date ? b.toISOString() : String(b);
    try {
        return sa.localeCompare(sb, locale || undefined, { numeric: true, sensitivity: "base" });
    } catch (_e) {
        return sa < sb ? -1 : sa > sb ? 1 : 0;
    }
}

/**
 * Resolves the filter target from the column metadata.
 *
 * queryName for a plain model column is "Table.Column"; we split on the first
 * dot so that table names containing spaces or "#" (e.g. "# Calendario") keep
 * working. If the query name does not look like that (measure, hierarchy level,
 * renamed field) we fall back to the display name.
 */
export function buildTarget(source: DataViewMetadataColumn): FilterTarget | null {
    if (!source) {
        return null;
    }
    const queryName = source.queryName || "";
    const dot = queryName.indexOf(".");
    if (dot > 0 && dot < queryName.length - 1) {
        return {
            table: queryName.substring(0, dot),
            column: queryName.substring(dot + 1)
        };
    }
    if (source.displayName) {
        return { table: queryName || source.displayName, column: source.displayName };
    }
    return null;
}

function findCategory(categories: DataViewCategoryColumn[], role: string): DataViewCategoryColumn | null {
    for (const c of categories) {
        if (c && c.source && c.source.roles && c.source.roles[role]) {
            return c;
        }
    }
    return null;
}

export interface TransformOptions {
    locale: string;
    sortDirection: SortDirection;
}

/**
 * Turns the categorical DataView into a de-duplicated, ordered list of items.
 *
 * Power BI already aggregates the categories for us, so a fact table with
 * millions of rows still arrives here as the distinct list of values.
 *
 * If the same Value shows up against several different Sort By values we keep
 * MAX(Sort By) - a deterministic choice, documented in the README.
 */
export function transform(dataView: DataView, options: TransformOptions): SlicerData {
    const empty: SlicerData = { items: [], target: null, valueDisplayName: "", hasValue: false };

    const categorical = dataView && dataView.categorical;
    const categories = categorical && categorical.categories;
    if (!categories || !categories.length) {
        return empty;
    }

    const valueCat = findCategory(categories, "value");
    if (!valueCat || !valueCat.values) {
        return empty;
    }
    const sortCat = findCategory(categories, "sortBy");

    const source = valueCat.source;
    const formatter = vf.create({
        format: source.format,
        cultureSelector: options.locale
    });

    const byKey = new Map<string, SlicerItem>();
    const values = valueCat.values;
    const sortValues = sortCat && sortCat.values;

    for (let i = 0; i < values.length; i++) {
        const raw = values[i];
        // BLANK / NULL never becomes an option and never becomes the Max / Min.
        if (isBlank(raw)) {
            continue;
        }
        const key = itemKey(raw);
        const sortRaw: PrimitiveValue = sortValues && sortValues.length > i ? sortValues[i] : raw;

        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, {
                key,
                raw,
                text: formatter.format(raw),
                sortRaw: isBlank(sortRaw) ? raw : sortRaw
            });
        } else if (!isBlank(sortRaw) && compareValues(sortRaw, existing.sortRaw, options.locale) > 0) {
            // Same Value bound to several Sort By values -> keep MAX(Sort By).
            existing.sortRaw = sortRaw;
        }
    }

    const items = Array.from(byKey.values());
    const dir = options.sortDirection === "asc" ? 1 : -1;
    items.sort((a, b) => dir * compareValues(a.sortRaw, b.sortRaw, options.locale));

    return {
        items,
        target: buildTarget(source),
        valueDisplayName: source.displayName || "",
        hasValue: true
    };
}

/**
 * Max / Min are always resolved on Sort By (falling back to Value), never on
 * the displayed text - that is why "Septiembre" wins over "Enero" when
 * # Mes Num is bound.
 */
export function findExtreme(items: SlicerItem[], which: "max" | "min", locale: string): SlicerItem | null {
    if (!items.length) {
        return null;
    }
    let best = items[0];
    for (let i = 1; i < items.length; i++) {
        const cmp = compareValues(items[i].sortRaw, best.sortRaw, locale);
        if ((which === "max" && cmp > 0) || (which === "min" && cmp < 0)) {
            best = items[i];
        }
    }
    return best;
}
