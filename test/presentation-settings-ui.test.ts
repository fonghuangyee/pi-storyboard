import { describe, expect, it, vi } from "vitest";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth, type Component, type SettingItem, type TUI } from "@earendil-works/pi-tui";
import { DEFAULT_PRESENTATION_SETTINGS, presentationColorNames, type PresentationSettings } from "../src/presentation-settings.ts";

const list = vi.hoisted(() => ({
  items: [] as SettingItem[],
  change: (_id: string, _value: string) => {},
  updateValue: vi.fn(),
}));

vi.mock("@earendil-works/pi-tui", async (importOriginal) => ({
  ...await importOriginal<typeof import("@earendil-works/pi-tui")>(),
  SettingsList: class {
    constructor(items: SettingItem[], _height: number, _theme: unknown, change: typeof list.change) {
      list.items = items;
      list.change = change;
    }
    updateValue = list.updateValue;
  },
}));

import { openPresentationSettings } from "../src/presentation-settings-ui.ts";

describe("presentation settings UI", () => {
  it.each([3, null])("saves and closes when a thinking-root limit of %s is submitted", async (expected) => {
    initTheme("dark", false);
    const ctx = {
      ui: {
        custom: async <T>(factory: (tui: TUI, theme: Theme, keys: unknown, done: (value: T) => void) => Component): Promise<T> => {
          let result!: T;
          const fg = vi.fn((color: string, text: string) => color === "warning" ? `\x1b[33m${text}\x1b[39m` : text);
          factory(
            { requestRender: vi.fn() } as unknown as TUI,
            { fg, bold: (text: string) => text } as unknown as Theme,
            undefined,
            (value) => { result = value; },
          );
          const item = list.items.find(({ id }) => id === "color-skillInvocation");
          expect(item?.label).toBe("Skill invocation color");
          expect(item?.currentValue).toBe("warning");
          expect(list.items.filter(({ id }) => id.startsWith("color-")).every(({ submenu }) => submenu)).toBe(true);
          expect(item?.values).toBeUndefined();
          const closeColor = vi.fn((value?: string) => { if (value !== undefined) list.change("color-skillInvocation", value); });
          const picker = item?.submenu?.("warning", closeColor);
          expect(picker?.render(80).join("\n")).toContain("→ \x1b[33mwarning");
          expect(fg).toHaveBeenCalledWith("warning", "warning");
          expect(picker?.render(5).every((line) => visibleWidth(line) <= 5)).toBe(true);
          picker?.handleInput?.("\x1b");
          expect(closeColor).toHaveBeenCalledExactlyOnceWith();
          const reopened = item?.submenu?.("warning", closeColor);
          reopened?.handleInput?.("\x1b[B");
          reopened?.handleInput?.("\r");
          const nextColor = presentationColorNames[presentationColorNames.findIndex((color) => color === "warning") + 1];
          expect(closeColor).toHaveBeenLastCalledWith(nextColor);
          expect(list.updateValue).toHaveBeenCalledWith("color-skillInvocation", nextColor);
          expect(result).toBeUndefined();
          list.updateValue.mockClear();
          list.change("reset-defaults", "reset");
          expect(list.updateValue).toHaveBeenCalledWith("color-skillInvocation", "warning");
          list.change("color-skillInvocation", "accent");
          const limit = list.items.find(({ id }) => id === "max-thinking-roots");
          expect(limit?.currentValue).toBe("Unlimited");
          const close = vi.fn((value?: string) => { if (value !== undefined) list.change("max-thinking-roots", value); });
          const editor = limit?.submenu?.(expected === null ? "3" : "Unlimited", close);
          expect(editor?.render(80).join("\n")).toContain("Enter saves all pending changes and reloads");
          if (expected === null) editor?.handleInput?.("\x04");
          editor?.handleInput?.("0");
          editor?.handleInput?.("\n");
          expect(close).not.toHaveBeenCalled();
          expect(result).toBeUndefined();
          expect(editor?.render(80).join("\n")).toContain("Enter a positive whole number");
          editor?.handleInput?.("\x7f");
          if (expected !== null) editor?.handleInput?.(String(expected));
          editor?.handleInput?.("\n");
          expect(close).toHaveBeenCalledExactlyOnceWith(expected === null ? "Unlimited" : String(expected));
          return result;
        },
      },
    };
    const saved: PresentationSettings | null = await openPresentationSettings(ctx, DEFAULT_PRESENTATION_SETTINGS);
    expect(saved?.colors.skillInvocation).toBe("accent");
    expect(saved?.maxThinkingRoots).toBe(expected);
  });
});
