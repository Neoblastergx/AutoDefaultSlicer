/**
 * User-facing strings.
 *
 * Source of truth for the default UI text, in English, with the same keys as
 * stringResources/<locale>/resources.resjson. At runtime the host's
 * localization manager is asked first (it serves the resjson for the report
 * locale, falling back to en-US); the tables below are the fallback for hosts
 * and test harnesses that have no localization manager, resolved by language
 * family from host.locale.
 *
 * Adding a language: add a resources.resjson folder AND a table here.
 */

export type StringKey =
    | "Visual_SelectAll"
    | "Visual_MultiSelected"
    | "Visual_AddFieldToValue"
    | "Visual_ClearSelection"
    | "Visual_MoreItems"
    | "Visual_NoData";

export const STRINGS_EN: Record<StringKey, string> = {
    Visual_SelectAll: "All",
    Visual_MultiSelected: "{0} selected",
    Visual_AddFieldToValue: "Add a field to Value",
    Visual_ClearSelection: "Clear selection",
    Visual_MoreItems: "+{0} more",
    Visual_NoData: "No data"
};

export const STRINGS_ES: Record<StringKey, string> = {
    Visual_SelectAll: "Todos",
    Visual_MultiSelected: "{0} seleccionados",
    Visual_AddFieldToValue: "Agregue un campo a Value",
    Visual_ClearSelection: "Borrar selección",
    Visual_MoreItems: "+{0} más",
    Visual_NoData: "Sin datos"
};

const BY_LANGUAGE: Record<string, Record<StringKey, string>> = {
    en: STRINGS_EN,
    es: STRINGS_ES
};

/** Everything the control needs, already resolved for the current locale. */
export interface UiStrings {
    selectAll: string;
    multiSelected: (count: number) => string;
    addFieldToValue: string;
    clearSelection: string;
    moreItems: (count: number) => string;
    noData: string;
}

/** A lookup such as ILocalizationManager.getDisplayName. */
export type StringLookup = (key: string) => string | undefined;

function languageOf(locale: string): string {
    const l = (locale || "").toLowerCase();
    const dash = l.indexOf("-");
    return dash > 0 ? l.substring(0, dash) : l;
}

/**
 * Resolves one key: host localization manager first, then the language-family
 * table, then English. A manager that has no entry returns the key itself (or
 * nothing), which is treated as a miss.
 */
export function resolveString(key: StringKey, locale: string, lookup?: StringLookup): string {
    if (lookup) {
        let hit: string | undefined;
        try {
            hit = lookup(key);
        } catch (_e) {
            hit = undefined;
        }
        if (typeof hit === "string" && hit.length > 0 && hit !== key) {
            return hit;
        }
    }
    const table = BY_LANGUAGE[languageOf(locale)];
    return (table && table[key]) || STRINGS_EN[key];
}

export interface StringOverrides {
    /** Format-pane "Select All label"; empty means "use the localized default". */
    selectAll?: string;
    /** Format-pane "Multi selection label" template with {0}; empty means default. */
    multiSelected?: string;
}

function fill(template: string, count: number): string {
    return template.split("{0}").join(String(count));
}

/** Builds the resolved string set, honouring format-pane overrides. */
export function resolveStrings(locale: string, lookup?: StringLookup, overrides: StringOverrides = {}): UiStrings {
    const selectAll = overrides.selectAll && overrides.selectAll.length
        ? overrides.selectAll
        : resolveString("Visual_SelectAll", locale, lookup);
    const multiTemplate = overrides.multiSelected && overrides.multiSelected.length
        ? overrides.multiSelected
        : resolveString("Visual_MultiSelected", locale, lookup);
    const moreTemplate = resolveString("Visual_MoreItems", locale, lookup);
    return {
        selectAll,
        multiSelected: (count) => fill(multiTemplate, count),
        addFieldToValue: resolveString("Visual_AddFieldToValue", locale, lookup),
        clearSelection: resolveString("Visual_ClearSelection", locale, lookup),
        moreItems: (count) => fill(moreTemplate, count),
        noData: resolveString("Visual_NoData", locale, lookup)
    };
}
