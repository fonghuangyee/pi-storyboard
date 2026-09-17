import { getSettingsListTheme, type Theme } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Input,
  SettingsList,
  Spacer,
  Text,
  truncateToWidth,
  type Component,
  type SettingItem,
  type TUI,
} from "@earendil-works/pi-tui";
import {
  clonePresentationSettings,
  normalizePresentationSettings,
  presentationColorNames,
  presentationGroupKinds,
  PRESENTATION_SETTINGS_KEY,
  type PresentationSettings,
  type PresentationSettingsDraft,
} from "./presentation-settings.ts";
import type { PresentationSettingsScope } from "./presentation-settings-store.ts";

const SYMBOL_FIELDS = [
  ["toolDot", "Default tool dot", "Fallback dot used for tool kinds without an override."],
  ["thinkingRoot", "Thinking root", "Marker for the first thinking block in a storyboard."],
  ["thinkingStep", "Thinking step", "Marker for later thinking paragraphs and chapters."],
  ["thinkingPlaceholder", "Thinking placeholder", "Presentation-only label for tool-only turns."],
  ["hiddenThinking", "Hidden-thinking summary", "Prefix for collapsed long-thinking summaries."],
  ["rail", "Vertical rail", "Continuation rail between assistant and tool rows."],
  ["branch", "Branch marker", "Marker for a non-final storyboard child."],
  ["lastBranch", "Last branch marker", "Marker for the final storyboard child."],
] as const;

type SymbolField = (typeof SYMBOL_FIELDS)[number][0];
type ToolDotField = (typeof presentationGroupKinds)[number];
type ColorField =
  | "running"
  | "complete"
  | "failed"
  | "note"
  | "active"
  | "settled"
  | "structure";

function valueForSymbol(draft: PresentationSettingsDraft, field: SymbolField): string {
  return draft.symbols[field];
}

function setSymbol(draft: PresentationSettingsDraft, field: SymbolField, value: string): void {
  draft.symbols[field] = value;
}

function colorFor(draft: PresentationSettingsDraft, field: ColorField): string {
  if (field === "structure") return draft.colors.structure;
  if (field === "active" || field === "settled") return draft.colors.thinking[field];
  return draft.colors.status[field];
}

function setColor(draft: PresentationSettingsDraft, field: ColorField, value: string): void {
  if (field === "structure") {
    draft.colors.structure = value as PresentationSettingsDraft["colors"]["structure"];
  } else if (field === "active" || field === "settled") {
    draft.colors.thinking[field] = value as PresentationSettingsDraft["colors"]["thinking"][typeof field];
  } else {
    draft.colors.status[field] = value as PresentationSettingsDraft["colors"]["status"][typeof field];
  }
}

function draftAsSettings(draft: PresentationSettingsDraft): PresentationSettings {
  return normalizePresentationSettings({
    [PRESENTATION_SETTINGS_KEY]: draft,
  });
}

function displayScope(scope: PresentationSettingsScope): string {
  return scope === "project" ? "project settings" : "global settings";
}

class TextSetting implements Component {
  private readonly input: Input;

  constructor(
    private readonly title: string,
    private readonly description: string,
    value: string,
    private readonly theme: Theme,
    onSubmit: (value: string) => void,
    onCancel: () => void,
  ) {
    this.input = new Input({ prompt: "> " });
    this.input.setValue(value);
    this.input.onSubmit = onSubmit;
    this.input.onEscape = onCancel;
  }

  handleInput(data: string): void {
    this.input.handleInput(data);
  }

  handleMouse(...args: Parameters<NonNullable<Component["handleMouse"]>>): ReturnType<NonNullable<Component["handleMouse"]>> {
    return this.input.handleMouse?.(...args);
  }

  invalidate(): void {
    this.input.invalidate();
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    const lines = [
      this.theme.fg("accent", this.theme.bold(this.title)),
      this.theme.fg("muted", this.description),
      "",
      ...this.input.render(safeWidth),
      "",
      this.theme.fg("dim", "Enter save • Esc cancel"),
    ];
    return lines.map((line) => truncateToWidth(line, safeWidth, ""));
  }
}

/** Interactive settings page for the presentation namespace. */
export async function openPresentationSettings(
  ctx: { ui: { custom<T>(factory: (tui: TUI, theme: Theme, keybindings: unknown, done: (result: T) => void) => Component): Promise<T> } },
  initial: PresentationSettings,
  scope: PresentationSettingsScope,
): Promise<PresentationSettings | null> {
  return ctx.ui.custom<PresentationSettings | null>((tui, theme, _keybindings, done) => {
    let draft = clonePresentationSettings(initial);
    let settingsList: SettingsList;

    const setAndNormalize = (update: (next: PresentationSettingsDraft) => void): void => {
      update(draft);
      draft = clonePresentationSettings(draftAsSettings(draft));
      syncValues();
      tui.requestRender();
    };

    const symbolItem = (
      id: string,
      label: string,
      description: string,
      field: SymbolField,
    ): SettingItem => ({
      id,
      label,
      description,
      currentValue: valueForSymbol(draft, field),
      submenu: (currentValue, close) => new TextSetting(
        label,
        description,
        currentValue,
        theme,
        (value) => close(value),
        () => close(),
      ),
    });

    const toolDotItem = (kind: ToolDotField): SettingItem => ({
      id: `tool-dot-${kind}`,
      label: `${kind} dot`,
      description: `Dot used for ${kind} tool rows; falls back to the default tool dot when invalid.`,
      currentValue: draft.symbols.toolDots[kind],
      submenu: (currentValue, close) => new TextSetting(
        `${kind} dot`,
        `Enter a short, control-free marker for ${kind} rows.`,
        currentValue,
        theme,
        (value) => close(value),
        () => close(),
      ),
    });

    const colorItem = (id: string, label: string, description: string, field: ColorField): SettingItem => ({
      id,
      label,
      description,
      currentValue: colorFor(draft, field),
      values: [...presentationColorNames],
    });

    const items: SettingItem[] = [
      {
        id: "trim-file-names",
        label: "Trim file/path values",
        description: "Middle-trim paths and file-name summaries when they exceed the row width.",
        currentValue: draft.trimming.fileNames ? "on" : "off",
        values: ["on", "off"],
      },
      {
        id: "trim-commands",
        label: "Trim command values",
        description: "Middle-trim Bash/PowerShell command summaries independently from paths.",
        currentValue: draft.trimming.commands ? "on" : "off",
        values: ["on", "off"],
      },
      ...SYMBOL_FIELDS.map(([field, label, description]) => symbolItem(`symbol-${field}`, label, description, field)),
      ...presentationGroupKinds.map(toolDotItem),
      colorItem("color-status-running", "Running status color", "Tool rows still executing.", "running"),
      colorItem("color-status-complete", "Complete status color", "Successful completed tool rows.", "complete"),
      colorItem("color-status-failed", "Failed status color", "Failed tool rows and diagnostics.", "failed"),
      colorItem("color-status-note", "Note status color", "Neutral storyboard note markers.", "note"),
      colorItem("color-thinking-active", "Active thinking color", "Thinking markers for running scenes.", "active"),
      colorItem("color-thinking-settled", "Settled thinking color", "Thinking markers for settled scenes.", "settled"),
      colorItem("color-structure", "Structure color", "Vertical rails and branch markers.", "structure"),
      {
        id: "reset-defaults",
        label: "Reset defaults",
        description: "Restore the current built-in presentation settings in this page.",
        currentValue: "reset",
        values: ["reset"],
      },
      {
        id: "save-reload",
        label: "Save and reload",
        description: `Write the validated namespace to ${displayScope(scope)} and reload the extension.`,
        currentValue: "save",
        values: ["save"],
      },
    ];

    const updateDraftValue = (id: string, value: string): void => {
      switch (id) {
        case "trim-file-names":
          setAndNormalize((next) => { next.trimming.fileNames = value === "on"; });
          return;
        case "trim-commands":
          setAndNormalize((next) => { next.trimming.commands = value === "on"; });
          return;
        case "reset-defaults":
          draft = clonePresentationSettings(normalizePresentationSettings(undefined));
          syncValues();
          tui.requestRender();
          return;
        case "save-reload":
          done(draftAsSettings(draft));
          return;
      }

      if (id.startsWith("symbol-")) {
        const field = id.slice("symbol-".length) as SymbolField;
        setAndNormalize((next) => setSymbol(next, field, value));
        return;
      }
      if (id.startsWith("tool-dot-")) {
        const kind = id.slice("tool-dot-".length) as ToolDotField;
        setAndNormalize((next) => { next.symbols.toolDots[kind] = value; });
        return;
      }
      if (id.startsWith("color-")) {
        const field = id.replace(/^color-(?:status-|thinking-)?/u, "") as ColorField;
        setAndNormalize((next) => setColor(next, field, value));
      }
    };

    settingsList = new SettingsList(
      items,
      11,
      getSettingsListTheme(),
      updateDraftValue,
      () => done(null),
      { enableSearch: true },
    );

    function currentValueFor(id: string): string {
      if (id === "trim-file-names") return draft.trimming.fileNames ? "on" : "off";
      if (id === "trim-commands") return draft.trimming.commands ? "on" : "off";
      if (id === "reset-defaults") return "reset";
      if (id === "save-reload") return "save";
      if (id.startsWith("symbol-")) return valueForSymbol(draft, id.slice("symbol-".length) as SymbolField);
      if (id.startsWith("tool-dot-")) return draft.symbols.toolDots[id.slice("tool-dot-".length) as ToolDotField];
      if (id.startsWith("color-")) return colorFor(draft, id.replace(/^color-(?:status-|thinking-)?/u, "") as ColorField);
      return "";
    }

    function syncValues(): void {
      for (const item of items) {
        const value = currentValueFor(item.id);
        if (value !== "") settingsList?.updateValue(item.id, value);
      }
    }

    const container = new Container();
    container.addChild(new Text(
      theme.fg("accent", theme.bold(`Pi Storyboard Settings · ${displayScope(scope)}`)),
      1,
      0,
    ));
    container.addChild(new Text(
      theme.fg("muted", "Enter changes a value; choose Save and reload when finished."),
      1,
      0,
    ));
    container.addChild(new Spacer(1));
    container.addChild(settingsList);

    return {
      render(width: number): string[] {
        return container.render(width);
      },
      handleInput(data: string): void {
        settingsList.handleInput(data);
        tui.requestRender();
      },
      handleMouse(event): ReturnType<NonNullable<Component["handleMouse"]>> {
        const result = settingsList.handleMouse(event);
        if (result?.render) tui.requestRender();
        return result;
      },
      invalidate(): void {
        container.invalidate();
      },
    };
  });
}