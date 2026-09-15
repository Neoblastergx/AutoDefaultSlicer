import { SelectionState, SlicerItem } from "./types";
import { VisualSettings } from "./settings";
import { AppliedFilter, signature } from "./filterManager";
import { initialState, normalizeKeys, resolve } from "./selectionResolver";

/**
 * Owns the selection for the lifetime of ONE instance of the visual.
 *
 * Everything in here is in-memory. Nothing is written back to the report with
 * persistProperties, which is the point: a selection a user makes is valid for
 * their session and no longer. Open the report again and the Default Selection
 * rule decides again.
 *
 * The saved report still contains a filter - applyJsonFilter always persists
 * one, there is no supported way around that - but on load we deliberately do
 * not treat it as a selection, unless Default behavior is Only When Empty.
 */
export class SessionController {
    /** Whether this instance has already decided its starting selection. */
    private initialised = false;
    /** The selection as of the previous update. */
    private session: SelectionState | null = null;
    /** Signature of the filter this instance last asked the host for. */
    private requested: string | null = null;

    /** Called when the Value role is unbound: the next load starts over. */
    public reset(): void {
        this.initialised = false;
        this.session = null;
        this.requested = null;
    }

    public hasInitialised(): boolean {
        return this.initialised;
    }

    public current(): SelectionState | null {
        return this.session;
    }

    /**
     * Works out the selection for this update.
     *
     * @param applied        what the host says is filtered right now
     * @param filterInFlight true while a filter we pushed has not been echoed back
     */
    public next(
        items: SlicerItem[],
        applied: AppliedFilter,
        settings: VisualSettings,
        locale: string,
        filterInFlight: boolean
    ): SelectionState {
        let state: SelectionState;

        if (!this.initialised) {
            // First load of this instance: the Default Selection rule wins over
            // whatever filter the report was saved with.
            this.initialised = true;
            state = initialState(items, applied.present ? applied.keys : null, settings, locale);
        } else {
            state =
                this.externalState(applied, settings, filterInFlight) ||
                resolve({ items, previous: this.session, settings, locale });
        }

        this.session = state;
        return state;
    }

    /** Records a selection the user just made. */
    public commit(state: SelectionState): void {
        this.session = state;
    }

    /** Records what this instance last asked the host to filter by. */
    public noteRequested(keys: string[]): void {
        this.requested = signature(keys);
    }

    /**
     * Detects a change to our column's filter that this instance did not make -
     * a bookmark being applied, or the filter pane being edited. Adopted rather
     * than fought, so bookmarks keep working within a session.
     *
     * Returns null while one of our own filters is still in flight, so we never
     * mistake our own pending change for someone else's.
     */
    private externalState(
        applied: AppliedFilter,
        settings: VisualSettings,
        filterInFlight: boolean
    ): SelectionState | null {
        if (filterInFlight || this.requested === null) {
            return null;
        }
        if (signature(applied.keys) === this.requested) {
            return null;
        }
        if (applied.present && !applied.keys.length) {
            // A filter of ours is in effect but names a value the data no
            // longer contains. That is our own stale filter, not somebody
            // else's change - let the normal resolution handle the fallback.
            return null;
        }
        if (!applied.present) {
            return { mode: "all", keys: [] };
        }
        return { mode: "explicit", keys: normalizeKeys(applied.keys, settings) };
    }
}
