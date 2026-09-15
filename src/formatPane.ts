import powerbi from "powerbi-visuals-api";
import FormattingModel = powerbi.visuals.FormattingModel;
import FormattingCard = powerbi.visuals.FormattingCard;
import FormattingSlice = powerbi.visuals.FormattingSlice;
import FormattingComponent = powerbi.visuals.FormattingComponent;
import ValidatorType = powerbi.visuals.ValidatorType;

import { VisualSettings } from "./settings";
import { UiStrings } from "./strings";

/**
 * The format pane is built by hand against powerbi.visuals.FormattingModel
 * (getFormattingModel, API 5.1+).
 *
 * We deliberately do not use powerbi-visuals-utils-formattingmodel: every
 * published version of that helper pins powerbi-visuals-api 5.7+ / 5.11+, which
 * would force the visual off the 5.3.0 API we target for Report Server.
 */

function dropdownSlice(objectName: string, propertyName: string, displayName: string, value: string): FormattingSlice {
    return {
        uid: `${objectName}_${propertyName}`,
        displayName,
        control: {
            type: FormattingComponent.Dropdown,
            properties: {
                descriptor: { objectName, propertyName },
                value
            }
        }
    };
}

function toggleSlice(objectName: string, propertyName: string, displayName: string, value: boolean): FormattingSlice {
    return {
        uid: `${objectName}_${propertyName}`,
        displayName,
        control: {
            type: FormattingComponent.ToggleSwitch,
            properties: {
                descriptor: { objectName, propertyName },
                value
            }
        }
    };
}

function textSlice(objectName: string, propertyName: string, displayName: string, value: string, placeholder: string): FormattingSlice {
    return {
        uid: `${objectName}_${propertyName}`,
        displayName,
        control: {
            type: FormattingComponent.TextInput,
            properties: {
                descriptor: { objectName, propertyName },
                value: value || "",
                placeholder
            }
        }
    };
}

function colorSlice(objectName: string, propertyName: string, displayName: string, value: string): FormattingSlice {
    return {
        uid: `${objectName}_${propertyName}`,
        displayName,
        control: {
            type: FormattingComponent.ColorPicker,
            properties: {
                descriptor: { objectName, propertyName },
                value: { value }
            }
        }
    };
}

function numberSlice(
    objectName: string,
    propertyName: string,
    displayName: string,
    value: number,
    min: number,
    max: number
): FormattingSlice {
    return {
        uid: `${objectName}_${propertyName}`,
        displayName,
        control: {
            type: FormattingComponent.NumUpDown,
            properties: {
                descriptor: { objectName, propertyName },
                value,
                options: {
                    minValue: { type: ValidatorType.Min, value: min },
                    maxValue: { type: ValidatorType.Max, value: max }
                }
            }
        }
    };
}

function fontSlice(
    objectName: string,
    displayName: string,
    fontFamily: string,
    fontSize: number,
    bold?: boolean,
    italic?: boolean
): FormattingSlice {
    const properties: any = {
        fontFamily: {
            descriptor: { objectName, propertyName: "fontFamily" },
            value: fontFamily
        },
        fontSize: {
            descriptor: { objectName, propertyName: "fontSize" },
            value: fontSize,
            options: {
                minValue: { type: ValidatorType.Min, value: 6 },
                maxValue: { type: ValidatorType.Max, value: 40 }
            }
        }
    };
    if (bold !== undefined) {
        properties.bold = { descriptor: { objectName, propertyName: "bold" }, value: bold };
    }
    if (italic !== undefined) {
        properties.italic = { descriptor: { objectName, propertyName: "italic" }, value: italic };
    }
    return {
        uid: `${objectName}_font`,
        displayName,
        control: {
            type: FormattingComponent.FontControl,
            properties
        }
    };
}

export function buildFormattingModel(settings: VisualSettings, strings: UiStrings): FormattingModel {
    const selectionCard: FormattingCard = {
        displayName: "Selection",
        uid: "selectionCard",
        groups: [
            {
                displayName: "",
                uid: "selectionGroup",
                slices: [
                    dropdownSlice("selection", "selectionMode", "Selection mode", settings.selection.selectionMode),
                    dropdownSlice("selection", "multiDisplay", "Multi display", settings.selection.multiDisplay),
                    numberSlice("selection", "visibleRows", "Visible rows", settings.selection.visibleRows, 2, 20),
                    dropdownSlice("selection", "defaultSelection", "Default selection", settings.selection.defaultSelection),
                    dropdownSlice("selection", "defaultBehavior", "Default behavior", settings.selection.defaultBehavior),
                    dropdownSlice("selection", "sortDirection", "Sort direction", settings.selection.sortDirection),
                    toggleSlice("selection", "showSelectAll", "Show Select All", settings.selection.showSelectAll),
                    textSlice("selection", "selectAllLabel", "Select All label", settings.selection.selectAllLabel, strings.selectAll),
                    textSlice("selection", "multiSelectionLabel", "Multi selection label", settings.selection.multiSelectionLabel, strings.multiSelected(2)),
                    dropdownSlice("selection", "clearBehavior", "Clear behavior", settings.selection.clearBehavior)
                ]
            }
        ],
        revertToDefaultDescriptors: [
            { objectName: "selection", propertyName: "selectionMode" },
            { objectName: "selection", propertyName: "multiDisplay" },
            { objectName: "selection", propertyName: "visibleRows" },
            { objectName: "selection", propertyName: "defaultSelection" },
            { objectName: "selection", propertyName: "defaultBehavior" },
            { objectName: "selection", propertyName: "sortDirection" },
            { objectName: "selection", propertyName: "showSelectAll" },
            { objectName: "selection", propertyName: "selectAllLabel" },
            { objectName: "selection", propertyName: "multiSelectionLabel" },
            { objectName: "selection", propertyName: "clearBehavior" }
        ]
    };

    const headerCard: FormattingCard = {
        displayName: "Slicer header",
        uid: "headerCard",
        topLevelToggle: {
            uid: "header_show",
            suppressDisplayName: true,
            control: {
                type: FormattingComponent.ToggleSwitch,
                properties: {
                    descriptor: { objectName: "header", propertyName: "show" },
                    value: settings.header.show
                }
            }
        },
        groups: [
            {
                displayName: "",
                uid: "headerGroup",
                slices: [
                    textSlice("header", "text", "Title text", settings.header.text, "(column name)"),
                    fontSlice("header", "Font", settings.header.fontFamily, settings.header.fontSize, settings.header.bold, settings.header.italic),
                    colorSlice("header", "fontColor", "Font color", settings.header.fontColor),
                    toggleSlice("header", "showClear", "Show clear button", settings.header.showClear)
                ]
            }
        ],
        revertToDefaultDescriptors: [
            { objectName: "header", propertyName: "show" },
            { objectName: "header", propertyName: "text" },
            { objectName: "header", propertyName: "fontFamily" },
            { objectName: "header", propertyName: "fontSize" },
            { objectName: "header", propertyName: "bold" },
            { objectName: "header", propertyName: "italic" },
            { objectName: "header", propertyName: "fontColor" },
            { objectName: "header", propertyName: "showClear" }
        ]
    };

    const controlCard: FormattingCard = {
        displayName: "Slicer box",
        uid: "controlCard",
        groups: [
            {
                displayName: "",
                uid: "controlGroup",
                slices: [
                    fontSlice("control", "Font", settings.control.fontFamily, settings.control.fontSize),
                    colorSlice("control", "fontColor", "Font color", settings.control.fontColor),
                    colorSlice("control", "background", "Background", settings.control.background),
                    toggleSlice("control", "showBorder", "Show border", settings.control.showBorder),
                    colorSlice("control", "borderColor", "Border color", settings.control.borderColor),
                    numberSlice("control", "borderRadius", "Border radius", settings.control.borderRadius, 0, 20)
                ]
            }
        ],
        revertToDefaultDescriptors: [
            { objectName: "control", propertyName: "fontFamily" },
            { objectName: "control", propertyName: "fontSize" },
            { objectName: "control", propertyName: "fontColor" },
            { objectName: "control", propertyName: "background" },
            { objectName: "control", propertyName: "showBorder" },
            { objectName: "control", propertyName: "borderColor" },
            { objectName: "control", propertyName: "borderRadius" }
        ]
    };

    const dropdownCard: FormattingCard = {
        displayName: "Dropdown list",
        uid: "dropdownCard",
        groups: [
            {
                displayName: "",
                uid: "dropdownGroup",
                slices: [
                    colorSlice("dropdown", "background", "Background", settings.dropdown.background),
                    colorSlice("dropdown", "fontColor", "Font color", settings.dropdown.fontColor)
                ]
            }
        ],
        revertToDefaultDescriptors: [
            { objectName: "dropdown", propertyName: "background" },
            { objectName: "dropdown", propertyName: "fontColor" }
        ]
    };

    return {
        cards: [selectionCard, headerCard, controlCard, dropdownCard]
    };
}
