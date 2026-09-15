import { SelectionState, SlicerItem } from "./types";
import { VisualSettings } from "./settings";
import { findExtreme } from "./dataView";

/** The selection the Default Selection rule asks for. */
export function defaultState(items: SlicerItem[], settings: VisualSettings, locale: string): SelectionState {
    const which = settings.selection.defaultSelection;
    if (which === "none" || !items.length) {
        return { mode: "auto", keys: [] };
    }
    const item = findExtreme(items, which, locale);
    return { mode: "auto", keys: item ? [item.key] : [] };
}

/** In single-ish modes only one item may ever be selected. */
export function normalizeKeys(keys: string[], settings: VisualSettings): string[] {
    if (settings.selection.selectionMode === "multi") {
        return keys;
    }
    return keys.length > 1 ? [keys[0]] : keys;
}

export interface ResolveInput {
    items: SlicerItem[];
    /**
     * The selection this instance held on the previous update. In-memory only -
     * nothing here ever came out of the saved report.
     */
    previous: SelectionState | null;
    settings: VisualSettings;
    locale: string;
}

/**
 * Decides what the selection must be for this update, given what it was on the
 * previous one.
 *
 *   1. "Select All" picked by the user keeps winning across refreshes.
 *   2. An explicit pick wins as long as it still exists in the data.
 *   3. If the picked value disappeared, fall back to the Default Selection rule
 *      and go back to following it.
 *   4. In "auto" the Default Selection rule re-applies every update, which is
 *      how a newly arrived maximum gets picked up.
 *
 * The initial state - what happens when a report is opened - is decided in
 * visual.ts, not here.
 */
export function resolve(input: ResolveInput): SelectionState {
    const { items, previous, settings, locale } = input;

    if (!items.length) {
        return { mode: previous ? previous.mode : "auto", keys: [] };
    }
    if (!previous) {
        return defaultState(items, settings, locale);
    }
    if (previous.mode === "all") {
        return { mode: "all", keys: [] };
    }
    if (previous.mode === "explicit") {
        const available = new Set(items.map((i) => i.key));
        const kept = previous.keys.filter((k) => available.has(k));
        if (kept.length) {
            return { mode: "explicit", keys: normalizeKeys(kept, settings) };
        }
        // The chosen value no longer exists under the current filter context.
        return defaultState(items, settings, locale);
    }
    return defaultState(items, settings, locale);
}

/**
 * The state a freshly loaded instance starts from.
 *
 * With Default behavior = On Load (the default) any filter the report was saved
 * with is deliberately ignored: the author leaving "2025" selected when they hit
 * save must not become everyone's starting point. With Only When Empty a filter
 * that is already in effect is honoured instead.
 */
export function initialState(
    items: SlicerItem[],
    appliedKeys: string[] | null,
    settings: VisualSettings,
    locale: string
): SelectionState {
    if (settings.selection.defaultBehavior === "onlyWhenEmpty" && appliedKeys && appliedKeys.length) {
        const available = new Set(items.map((i) => i.key));
        const kept = appliedKeys.filter((k) => available.has(k));
        if (kept.length) {
            return { mode: "explicit", keys: normalizeKeys(kept, settings) };
        }
    }
    return defaultState(items, settings, locale);
}

/** Applies the Clear behavior setting. */
export function clearedState(items: SlicerItem[], settings: VisualSettings, locale: string): SelectionState {
    switch (settings.selection.clearBehavior) {
        case "all":
        case "none":
            // "All" is implemented as "emit no filter", which is also what
            // "None" produces for a slicer - both leave the model unfiltered.
            return { mode: "all", keys: [] };
        default:
            return defaultState(items, settings, locale);
    }
}

/**
 * Turns whatever the <select> now reports as selected into a state.
 *
 * The native control already enforces the arithmetic - one option in Dropdown
 * mode, several in a Multi list box - so this only has to normalise and decide
 * when an empty selection means "Select All".
 */
export function selectionFromKeys(keys: string[], settings: VisualSettings): SelectionState {
    const normalized = normalizeKeys(keys, settings);
    if (!normalized.length) {
        // No individual value selected is the same thing as Select All:
        // this visual emits no filter at all.
        return { mode: "all", keys: [] };
    }
    return { mode: "explicit", keys: normalized };
}
