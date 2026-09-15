import "./../style/visual.less";

import powerbi from "powerbi-visuals-api";
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import DataView = powerbi.DataView;
import FormattingModel = powerbi.visuals.FormattingModel;
import IVisualEventService = powerbi.extensibility.IVisualEventService;
import ISelectionManager = powerbi.extensibility.ISelectionManager;

import { parseSettings, VisualSettings } from "./settings";
import { buildFormattingModel } from "./formatPane";
import { transform } from "./dataView";
import { SelectionState, SlicerData } from "./types";
import { AppliedFilter, FilterManager, readAppliedFilter } from "./filterManager";
import { clearedState, selectionFromKeys } from "./selectionResolver";
import { SessionController } from "./sessionState";
import { Dropdown, DropdownViewModel, HighContrast } from "./dropdown";
import { resolveStrings, StringLookup, UiStrings } from "./strings";

export class Visual implements IVisual {
    private host: IVisualHost;
    private root: HTMLElement;
    private dropdown: Dropdown;
    private filterManager: FilterManager;
    private events: IVisualEventService;
    private selectionManager: ISelectionManager;
    private locale: string;
    /** False when the host forbids interaction (e.g. a tooltip page). */
    private allowInteractions = true;

    private settings: VisualSettings = new VisualSettings();
    /** Host localization manager lookup, when the host provides one. */
    private stringLookup: StringLookup | undefined;
    private strings: UiStrings;
    private data: SlicerData = { items: [], target: null, valueDisplayName: "", hasValue: false };
    private state: SelectionState = { mode: "auto", keys: [] };

    /**
     * Owns the selection for this instance's lifetime. In memory only: nothing
     * about the selection is written back into the report, so the author
     * leaving "2025" selected when they saved does not become everyone's
     * starting point.
     */
    private session = new SessionController();

    /** What the host says is filtered on our column right now. */
    private applied: AppliedFilter = { present: false, keys: [] };

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.locale = options.host.locale || "en-US";
        this.filterManager = new FilterManager(options.host);
        this.events = options.host.eventService;
        this.selectionManager = options.host.createSelectionManager();
        this.allowInteractions = options.host.hostCapabilities.allowInteractions !== false;
        this.stringLookup = this.makeStringLookup(options.host);
        this.strings = resolveStrings(this.locale, this.stringLookup);

        this.root = document.createElement("div");
        this.root.className = "ads-container";
        options.element.appendChild(this.root);

        this.dropdown = new Dropdown(this.root, {
            onChange: (keys, selectedAll) => this.onChange(keys, selectedAll),
            onClear: () => this.onClear()
        });

        // Right-click opens the standard Power BI context menu, like any other visual.
        this.root.addEventListener("contextmenu", (e: MouseEvent) => {
            this.selectionManager.showContextMenu({}, { x: e.clientX, y: e.clientY });
            e.preventDefault();
        });
    }

    public update(options: VisualUpdateOptions): void {
        this.events.renderingStarted(options);
        try {
            const dataView: DataView = options && options.dataViews && options.dataViews[0];
            this.settings = parseSettings(dataView);
            this.strings = resolveStrings(this.locale, this.stringLookup, {
                selectAll: this.settings.selection.selectAllLabel,
                multiSelected: this.settings.selection.multiSelectionLabel
            });

            this.data = transform(dataView, {
                locale: this.locale,
                sortDirection: this.settings.selection.sortDirection
            });

            if (!this.data.hasValue) {
                // Rebinding the field counts as a fresh start.
                this.session.reset();
                this.state = { mode: "auto", keys: [] };
                this.render(this.strings.addFieldToValue);
                this.events.renderingFinished(options);
                return;
            }

            this.applied = readAppliedFilter(options, this.data.target, this.data.items);
            this.state = this.session.next(
                this.data.items,
                this.applied,
                this.settings,
                this.locale,
                this.filterManager.isInFlight()
            );

            this.syncHost();
            this.render(null);
            this.events.renderingFinished(options);
        } catch (e) {
            this.events.renderingFailed(options, e instanceof Error ? e.message : String(e));
        }
    }

    /** Pushes the resolved selection into the model. Nothing is persisted. */
    private syncHost(): void {
        const keys = this.state.mode === "all" ? [] : this.state.keys;
        this.session.noteRequested(keys);
        this.filterManager.apply(this.data.target, this.data.items, keys, this.applied.keys);
    }

    // -----------------------------------------------------------------------
    // User interaction
    // -----------------------------------------------------------------------

    private commit(next: SelectionState): void {
        if (!this.allowInteractions) {
            return;
        }
        this.state = next;
        this.session.commit(next);
        this.syncHost();
        // Repaint straight away so the closed dropdown shows the real selection
        // without waiting for the host round-trip.
        this.render(null);
    }

    private onChange(keys: string[], selectedAll: boolean): void {
        if (selectedAll) {
            this.commit({ mode: "all", keys: [] });
            return;
        }
        this.commit(selectionFromKeys(keys, this.settings));
    }

    private onClear(): void {
        this.commit(clearedState(this.data.items, this.settings, this.locale));
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    /**
     * ILocalizationManager serves stringResources/<locale>/resources.resjson
     * for the report locale. Older or minimal hosts may not provide it; the
     * language tables in strings.ts then take over.
     */
    private makeStringLookup(host: IVisualHost): StringLookup | undefined {
        if (typeof host.createLocalizationManager !== "function") {
            return undefined;
        }
        try {
            const manager = host.createLocalizationManager();
            if (!manager || typeof manager.getDisplayName !== "function") {
                return undefined;
            }
            return (key: string) => manager.getDisplayName(key);
        } catch (_e) {
            return undefined;
        }
    }

    private highContrast(): HighContrast {
        const palette = this.host && (this.host.colorPalette as unknown as {
            isHighContrast?: boolean;
            foreground?: { value: string };
            background?: { value: string };
            foregroundSelected?: { value: string };
            hyperlink?: { value: string };
        });
        const active = !!(palette && palette.isHighContrast);
        return {
            active,
            foreground: (active && palette.foreground && palette.foreground.value) || "#000000",
            background: (active && palette.background && palette.background.value) || "#FFFFFF",
            foregroundSelected: (active && palette.foregroundSelected && palette.foregroundSelected.value) || "#FFFFFF",
            hyperlink: (active && palette.hyperlink && palette.hyperlink.value) || "#0078D4"
        };
    }

    private render(placeholder: string | null): void {
        const headerText = this.settings.header.text || this.data.valueDisplayName;
        const vm: DropdownViewModel = {
            items: this.data.items,
            selectedKeys: this.state.mode === "all" ? [] : this.state.keys,
            isAll: this.state.mode === "all" || this.state.keys.length === 0,
            settings: this.settings,
            headerText,
            ariaLabel: headerText || "Slicer",
            highContrast: this.highContrast(),
            placeholder,
            strings: this.strings
        };
        this.dropdown.render(vm);
    }

    public getFormattingModel(): FormattingModel {
        return buildFormattingModel(this.settings, this.strings);
    }

    public destroy(): void {
        if (this.dropdown) {
            this.dropdown.destroy();
        }
    }
}
