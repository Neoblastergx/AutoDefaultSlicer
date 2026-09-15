import powerbi from "powerbi-visuals-api";
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import PrimitiveValue = powerbi.PrimitiveValue;

import { BasicFilter, IFilter, IBasicFilter } from "powerbi-models";

import { FilterTarget, SlicerItem } from "./types";
import { itemKey } from "./dataView";

export const FILTER_OBJECT = "general";
export const FILTER_PROPERTY = "filter";

/**
 * powerbi.FilterAction is a const enum, which only tsc can inline. Spelling
 * the values out keeps this correct under any bundler and makes the numbers
 * visible at the call site.
 */
const FILTER_MERGE = 0 as powerbi.FilterAction;
const FILTER_REMOVE = 1 as powerbi.FilterAction;

/**
 * Power BI hands model datetimes over as local-time Date objects with no
 * timezone meaning. Date.toISOString() would shift them by the browser offset
 * and the filter would stop matching, so we serialise the local components
 * verbatim and stamp a Z on the end - which is what the filter API expects.
 */
function dateToFilterValue(d: Date): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return (
        `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}Z`
    );
}

/** Converts a raw category value into something the JSON filter API accepts. */
export function toFilterValue(raw: PrimitiveValue): string | number | boolean {
    if (raw instanceof Date) {
        return dateToFilterValue(raw);
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
        return raw;
    }
    return String(raw);
}

/**
 * Maps a value coming back from options.jsonFilters onto an item key, so that a
 * filter restored from a bookmark or saved in the report can be matched against
 * the items currently in the DataView.
 */
function filterValueToKeys(value: unknown, items: SlicerItem[]): string | null {
    for (const item of items) {
        const own = toFilterValue(item.raw);
        if (own === value) {
            return item.key;
        }
        // Numbers can come back as strings and vice versa.
        if (String(own) === String(value)) {
            return item.key;
        }
        // Dates may come back with or without milliseconds / trailing Z.
        if (item.raw instanceof Date && typeof value === "string") {
            const parsed = Date.parse(value);
            if (!isNaN(parsed) && itemKey(new Date(value)) === itemKey(item.raw)) {
                return item.key;
            }
            if (String(own).substring(0, 10) === value.substring(0, 10) && value.length >= 10) {
                return item.key;
            }
        }
    }
    return null;
}

function sameTarget(target: FilterTarget, other: unknown): boolean {
    const t = other as { table?: string; column?: string };
    if (!t || typeof t !== "object") {
        return false;
    }
    return t.table === target.table && t.column === target.column;
}

/** What the host reports is filtered on our column right now. */
export interface AppliedFilter {
    /**
     * True when a filter of ours is in effect at all.
     *
     * This is deliberately separate from `keys`: a filter can be present and
     * still resolve to no keys, because the value it names is no longer in the
     * data (an external filter removed it). That is a stale filter, not the
     * absence of one, and the two must not be confused.
     */
    present: boolean;
    /** The item keys that filter resolves to, in the data we have now. */
    keys: string[];
}

const NO_FILTER: AppliedFilter = { present: false, keys: [] };

/** Reads back the filter this visual currently has applied. */
export function readAppliedFilter(
    options: VisualUpdateOptions,
    target: FilterTarget | null,
    items: SlicerItem[]
): AppliedFilter {
    const filters = (options as unknown as { jsonFilters?: IFilter[] }).jsonFilters;
    if (!target || !filters || !filters.length) {
        return NO_FILTER;
    }
    for (const raw of filters) {
        const f = raw as unknown as IBasicFilter;
        if (!f || !f.target || !sameTarget(target, f.target)) {
            continue;
        }
        if (!Array.isArray(f.values)) {
            continue;
        }
        const keys: string[] = [];
        for (const v of f.values) {
            const key = filterValueToKeys(v, items);
            if (key) {
                keys.push(key);
            }
        }
        return { present: true, keys };
    }
    return NO_FILTER;
}

/** Stable signature used to decide whether a filter actually needs re-applying. */
export function signature(keys: string[] | null): string {
    if (keys === null || keys.length === 0) {
        return "ALL";
    }
    return keys.slice().sort().join("|");
}

export class FilterManager {
    private host: IVisualHost;
    /**
     * Signature of a filter we pushed that the host has not echoed back yet.
     * null means "what the host reports is what we asked for", which is also
     * how the visual knows a later change came from somewhere else.
     */
    private lastAppliedSignature: string | null = null;

    constructor(host: IVisualHost) {
        this.host = host;
    }

    /** True while a filter we pushed has not come back in jsonFilters yet. */
    public isInFlight(): boolean {
        return this.lastAppliedSignature !== null;
    }

    /**
     * Applies (or removes) the filter for the given keys.
     * Returns true when a call was actually made.
     */
    public apply(target: FilterTarget | null, items: SlicerItem[], keys: string[], currentKeys: string[] | null): boolean {
        if (!target) {
            return false;
        }
        const desired = signature(keys);
        const current = signature(currentKeys);

        if (desired === current) {
            // Already in the right state. Clearing the guard here is what lets
            // us re-apply later if something external drops our filter.
            this.lastAppliedSignature = null;
            return false;
        }
        if (desired === this.lastAppliedSignature) {
            // We already pushed this and the host has not echoed it back yet.
            return false;
        }

        this.lastAppliedSignature = desired;

        if (desired === "ALL") {
            // "Select All" means: drop the filter this visual created. Every
            // other filter in the report is untouched.
            this.host.applyJsonFilter(null, FILTER_OBJECT, FILTER_PROPERTY, FILTER_REMOVE);
            return true;
        }

        const byKey = new Map(items.map((i) => [i.key, i]));
        const values = keys
            .map((k) => byKey.get(k))
            .filter((i) => !!i)
            .map((i) => toFilterValue(i.raw));

        if (!values.length) {
            this.host.applyJsonFilter(null, FILTER_OBJECT, FILTER_PROPERTY, FILTER_REMOVE);
            return true;
        }

        const filter = new BasicFilter({ table: target.table, column: target.column }, "In", values);
        this.host.applyJsonFilter(filter, FILTER_OBJECT, FILTER_PROPERTY, FILTER_MERGE);
        return true;
    }

}
