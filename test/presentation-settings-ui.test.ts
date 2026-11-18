import { describe, expect, it, vi } from "vitest";
import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import type { Component, SettingItem, TUI } from "@earendil-works/pi-tui";
import { DEFAULT_PRESENTATION_SETTINGS, type PresentationSettings } from "../src/presentation-settings.ts";

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
  it("edits, resets, and saves the skill color through the existing color picker", async () => {
    initTheme("dark", false);
    const ctx = {
      ui: {
        custom: async <T>(factory: (tui: TUI, theme: Theme, keys: unknown, done: (value: T) => void) => Component): Promise<T> => {
          let result!: T;
          factory(
            { requestRender: vi.fn() } as unknown as TUI,
            { fg: (_color: string, text: string) => text, bold: (text: string) => text } as Theme,
            undefined,
            (value) => { result = value; },
          );
          const item = list.items.find(({ id }) => id === "color-skillInvocation");
          expect(item?.label).toBe("Skill invocation color");
          expect(item?.currentValue).toBe("warning");
          expect(item?.values).toContain("mdHeading");
          list.change("color-skillInvocation", "mdHeading");
          expect(list.updateValue).toHaveBeenCalledWith("color-skillInvocation", "mdHeading");
          list.updateValue.mockClear();
          list.change("reset-defaults", "reset");
          expect(list.updateValue).toHaveBeenCalledWith("color-skillInvocation", "warning");
          list.change("color-skillInvocation", "accent");
          list.change("save-reload", "save");
          return result;
        },
      },
    };
    const saved: PresentationSettings | null = await openPresentationSettings(ctx, DEFAULT_PRESENTATION_SETTINGS);
    expect(saved?.colors.skillInvocation).toBe("accent");
  });
});
