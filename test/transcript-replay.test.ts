import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { installToolGroupingPatch } from "../src/pi-adapter.ts";
import { renderToolGroup } from "../src/renderer.ts";
import { TranscriptReplay } from "../src/transcript-replay.ts";

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

describe("transcript replay", () => {
  it("uses native Pi components inside closed turn story blocks", () => {
    initTheme("dark", false);
    const tui = fakeTui();
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: (group, width, groupTheme) => renderToolGroup(group, width, groupTheme),
    });
    expect(handle).toBeDefined();

    const replay = new TranscriptReplay(tui, process.cwd(), theme as unknown as Theme);
    const first = replay.render(120).join("\n");
    expect(first).toContain("Planning detailed width rendering tests");
    expect(first).toContain("Analyzing user rendering issue with long lines");
    expect(first).toContain("Run 1 command");
    expect(first).toContain("Command exited with code 1");
    expect(first).toContain("◉");
    expect(first.split("\n").every((line) => visibleWidth(line) <= 120)).toBe(true);

    let all = first;
    for (let index = 0; index < 80; index++) {
      replay.handleInput("\u001b[B");
      all += "\n" + replay.render(120).join("\n");
    }
    expect(all).toContain("Inspecting formatRow replacement failure");
    expect(all).toContain("Edit 1 time");
    expect(all).toContain("Running test suite");
    expect(all).toContain("Checking ripgrep em dash handling");
    expect(all).toContain("Locating exact types source files");
    expect(all).toContain("I’ll separate what Pi’s documented schema proves");
    expect(all).toContain("Clarifying separator usage and error formatting");
    expect(all).toContain("Validation:");
    expect(all).toContain("Inspecting the existing row shape");
    expect(all).toContain("native commentary");
    expect(all).toContain("Applying the settled replacement");
    expect(all).not.toContain("Tool step");
    expect(all).toContain("actions");
    expect(all).toContain("├─");
    expect(all).toContain("╰─");
    // The mixed thinking + final-text message is deliberately native, so its
    // thinking paragraphs do not receive turn-storyboard decoration.
    expect(all).toContain("Fixed.");
    expect(all.split("\n").every((line) => visibleWidth(line) <= 120)).toBe(true);

    replay.invalidate();
    handle?.uninstall();
  });
});
