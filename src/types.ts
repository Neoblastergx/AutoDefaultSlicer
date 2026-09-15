import powerbi from "powerbi-visuals-api";
import PrimitiveValue = powerbi.PrimitiveValue;

/** Selection strategies exposed in the format pane. */
export type SelectionMode = "single" | "multi" | "singleOrAll";
/** Multi only: a compact dropdown, or a fixed native list box (<select multiple>). */
export type MultiDisplay = "dropdown" | "list";
export type DefaultSelection = "none" | "max" | "min";
/**
 * "onLoad"        - recompute the default every time a new instance of the
 *                   visual loads, ignoring whatever filter the report was saved
 *                   with. This is the default.
 * "onlyWhenEmpty" - honour a filter that is already in effect at load time, and
 *                   only apply the default when there is none.
 */
export type DefaultBehavior = "onLoad" | "onlyWhenEmpty";
export type ClearBehavior = "default" | "all" | "none";
export type SortDirection = "asc" | "desc";

/**
 * How the current selection came to be. This lives in memory only, for the
 * lifetime of this visual instance - it is never persisted into the report.
 *
 *  - "auto"     : nobody picked anything yet, the visual keeps following the
 *                 Default Selection rule (so a new Max wins on every refresh).
 *  - "explicit" : the user picked one (or several) items. We keep them as long
 *                 as they still exist in the current filter context.
 *  - "all"      : the user picked "Select All". No filter is emitted at all.
 */
export type StateMode = "auto" | "explicit" | "all";

export interface SelectionState {
    mode: StateMode;
    /** Item keys. Empty when mode is "all", or when Default Selection is None. */
    keys: string[];
}

/** One de-duplicated row of the slicer. */
export interface SlicerItem {
    /** Stable identity, derived from the raw value. Used for state persistence. */
    key: string;
    /** Raw value, sent to the filter API. */
    raw: PrimitiveValue;
    /** Value formatted with the column's model format string + host locale. */
    text: string;
    /** Value used for ordering and for resolving Max / Min. */
    sortRaw: PrimitiveValue;
}

/** Target of the filter we emit, resolved from the Value column metadata. */
export interface FilterTarget {
    table: string;
    column: string;
}

export interface SlicerData {
    items: SlicerItem[];
    target: FilterTarget | null;
    /** Display name of the Value column, used as the default header text. */
    valueDisplayName: string;
    /** True when the Value role is bound. */
    hasValue: boolean;
}

export const NO_SELECTION = "__none__";
