import { initTheme } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { visibleWidth, type TUI } from "@earendil-works/pi-tui";
import { TuiPreview } from "../src/tui-preview.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
  italic: (text: string) => text,
  underline: (text: string) => text,
  strikethrough: (text: string) => text,
};

function fakeTui(): TUI {
  return {
    terminal: { rows: 30 } as TUI["terminal"],
    requestRender: () => undefined,
  } as unknown as TUI;
}

describe("TuiPreview", () => {
  it("previews current tool groups and every public pi-tui component", () => {
    // Real Pi components require the same global theme initialization as the
    // interactive application before they can be constructed.
    initTheme("dark", false);
    const tui = fakeTui();
    let closed = false;
    const preview = new TuiPreview(tui, theme as unknown as Theme, () => {
      closed = true;
    });

    const first = preview.render(100).join("\n");
    expect(first).toContain("Read 3 files");
    expect(first).toContain("●");
    expect(first).toContain("...");

    preview.handleInput("\u001b[B");
    const storyboard = preview.render(100).join("\n");
    expect(storyboard).toContain("Refining row layout logic");
    expect(storyboard).toContain("◉");
    expect(storyboard).toContain("○");
    expect(storyboard).not.toContain("07 ");
    expect(storyboard).not.toContain("08 ");
    expect(storyboard).toContain("╰─ Read 2 files");
    expect(storyboard).toContain("native results confirm commentary can contain Markdown");
    expect(storyboard).toContain("Confirming the separator after the first read");
    expect(storyboard).toContain("╰─ Run 2 commands");
    expect(storyboard).toContain("expanded");
    expect(storyboard).toContain("native Pi rows");
    expect(storyboard).toContain("native thinking starts a visual Pi turn block");
    expect(storyboard).toContain("no persisted master record");
    expect(storyboard).not.toContain("scene header = one assistant message");
    expect(storyboard).toContain("├─");
    expect(storyboard).toContain("╰─");
    expect(storyboard.split("\n").every((line) => visibleWidth(line) <= 100)).toBe(true);

    // Enter the preview pane and scroll through the complete scenario matrix.
    preview.handleInput("\t");
    let scrolledStoryboard = "";
    for (let index = 0; index < 100; index++) {
      preview.handleInput("\u001b[B");
      scrolledStoryboard += preview.render(100).join("\n");
    }
    expect(scrolledStoryboard).toContain("Write 1 file");
    expect(scrolledStoryboard).toContain("Collapsed running edit");
    expect(scrolledStoryboard).toContain("Planning handler with effect for default config");
    expect(scrolledStoryboard).toContain("◉ Thinking...");
    expect(scrolledStoryboard).toContain("README.md");
    expect(scrolledStoryboard).toContain("thinking steps behind the scenes");
    expect(scrolledStoryboard).toContain("Final answer");
    expect(scrolledStoryboard).toContain("Unknown text phase");
    expect(scrolledStoryboard).toContain("Locating registerTool definitions");
    expect(scrolledStoryboard.split("\n").every((line) => visibleWidth(line) <= 100)).toBe(true);

    preview.handleInput("\u001b[D");
    preview.handleInput("\u001b[B");
    const colors = preview.render(100).join("\n");
    expect(colors).toContain("All Pi theme foreground colors using ●");
    expect(colors).toContain("● accent");
    expect(colors).toContain("● success");
    expect(colors).toContain("● error");
    expect(colors).toContain("● warning");
    expect(colors).toContain("● bashMode");
    preview.handleInput("\u001b[A");
    preview.handleInput("\u001b[A");

    for (let index = 0; index < 21; index++) {
      const wideLines = preview.render(100);
      const narrowLines = preview.render(35);
      expect(wideLines.length).toBeGreaterThan(0);
      expect(narrowLines.length).toBeGreaterThan(0);
      expect(wideLines.every((line) => visibleWidth(line) <= 100)).toBe(true);
      expect(narrowLines.every((line) => visibleWidth(line) <= 35)).toBe(true);
      preview.handleInput("\u001b[B");
    }

    preview.handleInput("\u001b");
    expect(closed).toBe(true);
    preview.dispose();
  });
});
