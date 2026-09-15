import { SlicerItem } from "./types";
import { VisualSettings } from "./settings";
import { UiStrings } from "./strings";

/** Power BI format-pane sizes are points; the DOM wants pixels. */
export function ptToPx(pt: number): number {
    return Math.round(pt * (4 / 3) * 100) / 100;
}

/**
 * Sentinel used as the <option> value for "Select All". Item keys are prefixed
 * ("s:", "n:", "d:", "b:") so this can never collide with a real one.
 */
export const ALL_OPTION_VALUE = "__ads_all__";

/**
 * Value of the hidden option that carries the closed-box text in Multi mode.
 * It is never a selectable command.
 */
export const DISPLAY_OPTION_VALUE = "";

/** Multi-mode tick marks. Purely decorative: they never reach a filter. */
export const TICKED = "☑ ";
export const UNTICKED = "☐ ";

/**
 * The ONE place that decides whether an option label carries a tick mark.
 *
 * Tick marks exist exclusively for Selection mode = Multi with Multi display =
 * Dropdown, where the single-line <select> has no other way to show which
 * values are on. Every other body - Single, Single or All, and Multi + List
 * (whose <select multiple> shows selection with the platform highlight) - gets
 * clean text.
 */
export function tickPrefix(settings: VisualSettings, isSelected: boolean): string {
    const s = settings.selection;
    if (s.selectionMode !== "multi" || s.multiDisplay !== "dropdown") {
        return "";
    }
    return isSelected ? TICKED : UNTICKED;
}

export interface HighContrast {
    active: boolean;
    foreground: string;
    background: string;
    foregroundSelected: string;
    hyperlink: string;
}

export interface DropdownViewModel {
    items: SlicerItem[];
    selectedKeys: string[];
    /** True when no filter is emitted, i.e. the "Select All" state. */
    isAll: boolean;
    settings: VisualSettings;
    headerText: string;
    /** aria-label for the control. */
    ariaLabel: string;
    highContrast: HighContrast;
    /** Shown instead of the list when the Value role is empty. */
    placeholder: string | null;
    /** Localized UI text, format-pane overrides already applied. */
    strings: UiStrings;
}

export interface DropdownCallbacks {
    /** Fired on every change. `selectedAll` means the user picked Select All. */
    onChange(keys: string[], selectedAll: boolean): void;
    onClear(): void;
}

/**
 * Rendering cap. Building tens of thousands of DOM nodes stalls the browser,
 * and nobody scrolls that far.
 */
const MAX_RENDERED_OPTIONS = 1000;

const SVG_NS = "http://www.w3.org/2000/svg";

function removeChildren(el: HTMLElement): void {
    while (el.firstChild) {
        el.removeChild(el.firstChild);
    }
}

/** A <select> that may know how to reopen its own picker (Chromium 121+). */
type PickerSelect = HTMLSelectElement & { showPicker?: () => void };

/**
 * The slicer control. One native <select> for every Selection mode.
 *
 * A custom popup (an absolutely positioned div) is clipped by the visual's
 * iframe, which makes it unusable on a slicer-sized visual. A native <select>
 * has its option list drawn by the browser outside the document, so it opens
 * over the report at any visual size. That is worth more than any styling.
 *
 * Multi has two faces, picked by the Multi display setting:
 *
 *  - Multi display = Dropdown: the single-line <select> acts as a toggle
 *    command. Each option is labelled ☑ / ☐, picking one flips that value, the
 *    labels are updated IN PLACE (no option is recreated), the closed box
 *    updates at once, and the picker is reopened with showPicker() where the
 *    host allows it - best effort, never required.
 *  - Multi display = List: a native <select multiple size=N> - a fixed list
 *    box, always visible, scrolling past Visible rows, clean labels. Clicking
 *    a row toggles it WITHOUT Ctrl: mousedown is intercepted so the browser's
 *    "click replaces the selection" rule never runs. Keyboard keeps the
 *    platform's own semantics.
 *
 * No custom popup, no modal dialog, no <select multiple> outside List. In
 * every face `selectedKeys` is the source of truth, never `selectedIndex`.
 */
export class Dropdown {
    private root: HTMLElement;
    private callbacks: DropdownCallbacks;

    private headerEl: HTMLElement;
    private titleEl: HTMLElement;
    private clearEl: HTMLButtonElement;
    private selectWrapEl: HTMLElement;
    private selectEl: HTMLSelectElement;
    private chevronEl: HTMLElement;

    private vm: DropdownViewModel | null = null;
    /** Signature of the options currently in the DOM, to avoid rebuilding them. */
    private renderedSignature = "";
    /**
     * Set while we rewrite the options ourselves, so a change event the browser
     * might raise during a rebuild can never be mistaken for a user pick.
     */
    private rendering = false;

    constructor(root: HTMLElement, callbacks: DropdownCallbacks) {
        this.root = root;
        this.callbacks = callbacks;
        this.build();
    }

    // -----------------------------------------------------------------------
    // DOM construction (done once, then updated in place)
    // -----------------------------------------------------------------------

    private build(): void {
        this.root.classList.add("ads-root");
        removeChildren(this.root);

        this.headerEl = document.createElement("div");
        this.headerEl.className = "ads-header";

        this.titleEl = document.createElement("div");
        this.titleEl.className = "ads-title";
        this.headerEl.appendChild(this.titleEl);

        this.clearEl = document.createElement("button");
        this.clearEl.className = "ads-clear";
        this.clearEl.type = "button";
        this.clearEl.setAttribute("aria-label", "Clear selection");
        this.clearEl.appendChild(eraserIcon());
        this.clearEl.addEventListener("click", (e) => {
            e.stopPropagation();
            this.callbacks.onClear();
        });
        this.headerEl.appendChild(this.clearEl);

        this.root.appendChild(this.headerEl);

        this.selectWrapEl = document.createElement("div");
        this.selectWrapEl.className = "ads-select-wrap";

        this.selectEl = document.createElement("select");
        this.selectEl.className = "ads-select";
        this.selectEl.addEventListener("change", () => this.onSelectChange());
        // List mode: toggle a row on plain click, no Ctrl. See onListMouseDown.
        this.selectEl.addEventListener("mousedown", (e: MouseEvent) => this.onListMouseDown(e));
        this.selectWrapEl.appendChild(this.selectEl);

        // Drawn by us because `appearance: none` removes the platform arrow.
        // pointer-events are off in CSS so clicks still reach the <select>.
        this.chevronEl = document.createElement("span");
        this.chevronEl.className = "ads-chevron";
        this.chevronEl.appendChild(chevronIcon());
        this.selectWrapEl.appendChild(this.chevronEl);

        this.root.appendChild(this.selectWrapEl);

    }

    public destroy(): void {
        // Nothing to unhook: no document-level listeners, no popup.
    }

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    private onSelectChange(): void {
        const vm = this.vm;
        if (!vm || this.rendering) {
            return;
        }
        if (this.isListMode(vm)) {
            // Keyboard path of the list box (mouse never reaches here: mousedown
            // is intercepted). Whatever the platform selected becomes the state.
            this.onListChange(vm);
            return;
        }

        const value = this.selectEl.value;

        if (vm.settings.selection.selectionMode !== "multi") {
            if (value === ALL_OPTION_VALUE) {
                this.callbacks.onChange([], true);
            } else if (value !== DISPLAY_OPTION_VALUE) {
                this.callbacks.onChange([value], false);
            }
            return;
        }

        // Multi dropdown: the picked option is a command, not the new state.
        // The callback re-renders synchronously and in place, so by the time
        // we get back here the labels and the closed box are already current.
        if (value === DISPLAY_OPTION_VALUE) {
            return;
        }
        this.toggleMulti(vm, value);
        this.reopenPicker();
    }

    /**
     * Best-effort auto-reopen for Multi + Dropdown.
     *
     * showPicker() needs transient user activation, so the first attempt is
     * made synchronously, still inside the change event. If that throws -
     * typically because the picker is still closing - one retry is queued on
     * the next animation frame, which is inside the activation window and
     * does not loop. Missing, SecurityError, NotAllowedError or a host that
     * blocks it: every failure is swallowed. The selection has already been
     * applied; the dropdown just stays closed.
     */
    private reopenPicker(): void {
        const el = this.selectEl as PickerSelect;
        if (typeof el.showPicker !== "function") {
            return;
        }
        // Focus first so the picker attaches to a focused control and keyboard
        // navigation continues from it. No layout changes happen in between.
        try {
            el.focus();
        } catch (_e) {
            // ignore
        }
        try {
            el.showPicker();
            return;
        } catch (_e) {
            // fall through to one retry
        }
        if (typeof requestAnimationFrame !== "function") {
            return;
        }
        requestAnimationFrame(() => {
            try {
                el.showPicker();
            } catch (_e) {
                // Best effort only.
            }
        });
    }

    private isListMode(vm: DropdownViewModel): boolean {
        return vm.settings.selection.selectionMode === "multi" && vm.settings.selection.multiDisplay === "list";
    }

    /**
     * List mode, mouse: a plain click toggles one row and leaves the others
     * alone - no Ctrl, no Cmd.
     *
     * A native <select multiple> replaces the whole selection on an unmodified
     * click. Cancelling mousedown on the <option> is the one cross-browser way
     * to stop that (Chromium, Firefox and WebKit all decide the selection on
     * mousedown, not on click). It also cancels focus, so focus is restored by
     * hand. Clicks that land on the scrollbar or the padding target the
     * <select> itself, not an <option>, and are left to the browser.
     */
    private onListMouseDown(e: MouseEvent): void {
        const vm = this.vm;
        if (!vm || vm.placeholder || !this.isListMode(vm) || e.button !== 0) {
            return;
        }
        const target = e.target as HTMLElement | null;
        if (!target || target.tagName !== "OPTION") {
            return;
        }
        const option = target as HTMLOptionElement;
        if (option.disabled || option.value === DISPLAY_OPTION_VALUE) {
            return;
        }
        e.preventDefault();
        this.toggleMulti(vm, option.value);
        // The callback has already re-rendered; keep the list focused so the
        // keyboard keeps working from where the user clicked.
        this.selectEl.focus();
    }

    /** List mode, keyboard: read the platform's selection back into state. */
    private onListChange(vm: DropdownViewModel): void {
        const options = this.selectEl.options;
        const keys: string[] = [];
        let allPicked = false;
        for (let i = 0; i < options.length; i++) {
            const o = options[i];
            if (!o.selected || o.disabled) {
                continue;
            }
            if (o.value === ALL_OPTION_VALUE) {
                allPicked = true;
            } else if (o.value !== DISPLAY_OPTION_VALUE) {
                keys.push(o.value);
            }
        }
        // Select All newly picked wins; otherwise the individual rows are the state,
        // and no rows at all is the All state (never an empty IN list).
        if (allPicked && !vm.isAll) {
            this.callbacks.onChange([], true);
            return;
        }
        if (!keys.length) {
            this.callbacks.onChange([], true);
            return;
        }
        this.callbacks.onChange(keys, false);
    }

    /**
     * Ticking a value leaves the All state and becomes an explicit selection;
     * unticking the last one falls back to All, which drops the filter rather
     * than emitting an invalid empty IN list. Ticking Select All clears the
     * individual selection outright.
     */
    private toggleMulti(vm: DropdownViewModel, key: string): void {
        if (key === ALL_OPTION_VALUE) {
            this.callbacks.onChange([], true);
            return;
        }
        const base = vm.isAll ? [] : vm.selectedKeys.slice();
        const at = base.indexOf(key);
        if (at >= 0) {
            base.splice(at, 1);
        } else {
            base.push(key);
        }
        if (!base.length) {
            this.callbacks.onChange([], true);
            return;
        }
        this.callbacks.onChange(base, false);
    }

    // -----------------------------------------------------------------------
    // Rendering
    // -----------------------------------------------------------------------

    public render(vm: DropdownViewModel): void {
        this.vm = vm;
        const s = vm.settings;
        const hc = vm.highContrast;

        const controlColor = hc.active ? hc.foreground : s.control.fontColor;
        const controlBg = hc.active ? hc.background : s.control.background;
        const borderColor = hc.active ? hc.foreground : s.control.borderColor;
        const headerColor = hc.active ? hc.foreground : s.header.fontColor;

        this.root.classList.toggle("ads-hc", hc.active);

        // Header ------------------------------------------------------------
        this.headerEl.style.display = s.header.show ? "flex" : "none";
        const title = vm.headerText || "";
        this.titleEl.textContent = title;
        this.titleEl.title = title;
        this.titleEl.style.color = headerColor;
        this.titleEl.style.fontFamily = s.header.fontFamily;
        this.titleEl.style.fontSize = ptToPx(s.header.fontSize) + "px";
        this.titleEl.style.fontWeight = s.header.bold ? "600" : "400";
        this.titleEl.style.fontStyle = s.header.italic ? "italic" : "normal";

        const hasSelection = !vm.isAll && vm.selectedKeys.length > 0;
        this.clearEl.title = vm.strings.clearSelection;
        this.clearEl.setAttribute("aria-label", vm.strings.clearSelection);
        this.clearEl.style.display = s.header.show && s.header.showClear ? "inline-flex" : "none";
        this.clearEl.classList.toggle("ads-clear-active", hasSelection);
        this.clearEl.style.color = headerColor;

        const border = s.control.showBorder || hc.active ? `1px solid ${borderColor}` : "1px solid transparent";

        // Select -------------------------------------------------------------
        this.selectEl.style.color = controlColor;
        this.selectEl.style.backgroundColor = controlBg;
        this.selectEl.style.fontFamily = s.control.fontFamily;
        this.selectEl.style.fontSize = ptToPx(s.control.fontSize) + "px";
        this.selectEl.style.borderRadius = s.control.borderRadius + "px";
        this.selectEl.style.border = border;
        this.selectEl.disabled = !!vm.placeholder;

        const listMode = this.isListMode(vm) && !vm.placeholder;
        this.selectEl.classList.toggle("ads-select-list", listMode);
        this.selectWrapEl.classList.toggle("ads-select-wrap-list", listMode);
        this.chevronEl.style.display = listMode ? "none" : "inline-flex";
        if (listMode) {
            // A fixed list box: Visible rows becomes select.size, and CSS lets
            // it shrink and scroll when the visual is shorter than that.
            this.selectEl.multiple = true;
            this.selectEl.size = s.selection.visibleRows;
        } else {
            // Dropdown bodies are never <select multiple>: that renders as an
            // inline list, not a dropdown.
            this.selectEl.multiple = false;
            this.selectEl.removeAttribute("size");
        }

        this.rendering = true;
        try {
            this.renderOptions(vm);
            this.applySelection(vm);
        } finally {
            this.rendering = false;
        }

        // Closed text, tooltip and accessible name all reflect the selection
        // immediately - render() runs synchronously inside commit().
        const text = this.currentText();
        this.selectEl.title = text;
        this.selectEl.setAttribute("aria-label", vm.placeholder ? vm.ariaLabel : `${vm.ariaLabel}: ${text}`);
    }

    /** The text the closed control shows. Never carries tick marks. */
    private currentText(): string {
        const vm = this.vm;
        if (!vm) {
            return "";
        }
        if (vm.placeholder) {
            return vm.placeholder;
        }
        if (vm.isAll || !vm.selectedKeys.length) {
            return vm.strings.selectAll;
        }
        const selected = new Set(vm.selectedKeys);
        const texts = vm.items.filter((i) => selected.has(i.key)).map((i) => i.text);
        if (!texts.length) {
            return vm.strings.selectAll;
        }
        if (texts.length === 1) {
            return texts[0];
        }
        return vm.strings.multiSelected(texts.length);
    }

    /**
     * Rebuilds the <option> list only when its STRUCTURE changed - the items,
     * the Select All row, colours or the body kind. A selection change never
     * rebuilds anything: in Multi + Dropdown the ☑ / ☐ labels and the hidden
     * display option are updated in place by refreshMultiLabels(), so the
     * <option> elements survive and the picker can reopen on the same nodes
     * without a visible rebuild.
     */
    private renderOptions(vm: DropdownViewModel): void {
        const s = vm.settings;
        const list = this.isListMode(vm);
        // Only the dropdown-multi body needs the hidden display option and the
        // tick marks; see tickPrefix().
        const multi = s.selection.selectionMode === "multi" && !list;

        if (vm.placeholder) {
            const sig = "placeholder:" + vm.placeholder;
            if (sig !== this.renderedSignature) {
                removeChildren(this.selectEl);
                this.selectEl.appendChild(this.makeOption(DISPLAY_OPTION_VALUE, vm.placeholder, vm));
                this.renderedSignature = sig;
            }
            return;
        }

        const shown = vm.items.slice(0, MAX_RENDERED_OPTIONS);
        // Select All is also offered when the visual is currently in the All
        // state, so the closed box never renders blank.
        const withAll = s.selection.showSelectAll || vm.isAll;
        const selected = new Set(vm.isAll ? [] : vm.selectedKeys);

        const sig = [
            list ? "list" : multi ? "multi" : "single",
            withAll ? "all:" + vm.strings.selectAll : "noall",
            vm.highContrast.active ? "hc" : "n",
            s.dropdown.background,
            s.dropdown.fontColor,
            shown.length,
            shown.map((i) => i.key + "\u001f" + i.text).join("\u001e")
        ].join("");

        if (sig === this.renderedSignature) {
            if (multi) {
                this.refreshMultiLabels(vm);
            }
            return;
        }
        this.renderedSignature = sig;

        removeChildren(this.selectEl);

        if (multi) {
            // A hidden option carries the closed-box text, so the box can read
            // "2 selected" while every real option carries a tick mark.
            const display = this.makeOption(DISPLAY_OPTION_VALUE, this.currentText(), vm);
            display.hidden = true;
            display.className = "ads-display-option";
            this.selectEl.appendChild(display);
        }

        if (withAll) {
            const label = tickPrefix(s, vm.isAll) + vm.strings.selectAll;
            this.selectEl.appendChild(this.makeOption(ALL_OPTION_VALUE, label, vm, vm.strings.selectAll));
        }

        for (const item of shown) {
            const label = tickPrefix(s, selected.has(item.key)) + item.text;
            this.selectEl.appendChild(this.makeOption(item.key, label, vm, item.text));
        }

        if (vm.items.length > shown.length) {
            const rest = this.makeOption(DISPLAY_OPTION_VALUE, vm.strings.moreItems(vm.items.length - shown.length), vm);
            rest.disabled = true;
            this.selectEl.appendChild(rest);
        }
    }

    /**
     * Multi + Dropdown: rewrites the tick marks and the closed-box text on the
     * existing <option> nodes. The clean value lives in option.title, so the
     * label is always rebuilt from it rather than from the previous label.
     */
    private refreshMultiLabels(vm: DropdownViewModel): void {
        const s = vm.settings;
        const selected = new Set(vm.isAll ? [] : vm.selectedKeys);
        const options = this.selectEl.options;
        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            if (opt.value === DISPLAY_OPTION_VALUE) {
                if (opt.hidden) {
                    const text = this.currentText();
                    if (opt.textContent !== text) {
                        opt.textContent = text;
                    }
                }
                continue;
            }
            const on = opt.value === ALL_OPTION_VALUE ? vm.isAll : selected.has(opt.value);
            const label = tickPrefix(s, on) + opt.title;
            if (opt.textContent !== label) {
                opt.textContent = label;
            }
        }
    }

    private makeOption(value: string, text: string, vm: DropdownViewModel, tooltip?: string): HTMLOptionElement {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = text;
        // Tooltip for values too long for the closed box - without tick marks.
        opt.title = tooltip === undefined ? text : tooltip;
        // Chromium honours these on <option>; Firefox and Safari mostly ignore
        // them. Documented in the README.
        opt.style.backgroundColor = vm.highContrast.active ? vm.highContrast.background : vm.settings.dropdown.background;
        opt.style.color = vm.highContrast.active ? vm.highContrast.foreground : vm.settings.dropdown.fontColor;
        return opt;
    }

    /**
     * Points the closed box at the right option.
     *
     * In Multi that is always the hidden display option, so the browser never
     * leaves a value looking permanently picked - which would contradict
     * selectedKeys - and picking the same option twice still raises `change`.
     */
    private applySelection(vm: DropdownViewModel): void {
        const options = this.selectEl.options;
        if (!options.length) {
            return;
        }
        if (vm.placeholder) {
            this.selectEl.selectedIndex = 0;
            return;
        }

        if (this.isListMode(vm)) {
            // Highlight exactly the selected rows; Select All is highlighted only in
            // the All state, and never together with individual values.
            const on = new Set(vm.isAll ? [] : vm.selectedKeys);
            for (let i = 0; i < options.length; i++) {
                const opt = options[i];
                opt.selected = opt.value === ALL_OPTION_VALUE ? vm.isAll : on.has(opt.value);
            }
            return;
        }

        if (vm.settings.selection.selectionMode === "multi") {
            this.selectEl.selectedIndex = 0;
            return;
        }

        const wanted = new Set(vm.isAll ? [] : vm.selectedKeys);
        let any = false;

        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const on = opt.value !== ALL_OPTION_VALUE && opt.value !== DISPLAY_OPTION_VALUE && wanted.has(opt.value);
            opt.selected = on;
            any = any || on;
        }

        if (!any) {
            // Nothing selected means the All state; point the box at that row so
            // the closed control reads the Select All label instead of going blank.
            for (let i = 0; i < options.length; i++) {
                if (options[i].value === ALL_OPTION_VALUE) {
                    options[i].selected = true;
                    any = true;
                    break;
                }
            }
            if (!any) {
                this.selectEl.selectedIndex = 0;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Inline icons - built with the DOM, no innerHTML, no external assets,
// no third-party marks.
// ---------------------------------------------------------------------------

function makeIcon(viewBox: string, width: number, height: number, d: string, strokeWidth: number): SVGElement {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", viewBox);
    svg.setAttribute("width", String(width));
    svg.setAttribute("height", String(height));
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", String(strokeWidth));
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");

    svg.appendChild(path);
    return svg;
}

function chevronIcon(): SVGElement {
    return makeIcon("0 0 10 6", 10, 6, "M0.5 0.5 L5 5 L9.5 0.5", 1.2);
}

function eraserIcon(): SVGElement {
    return makeIcon("0 0 16 16", 12, 12, "M2 11.5 L7 6.5 L11.5 11 L9 13.5 H4.5 Z M7 6.5 L10.5 3 L14 6.5 L11.5 9", 1.2);
}
