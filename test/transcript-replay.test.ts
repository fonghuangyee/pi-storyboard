import { initTheme, type Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { Container, Text, type TUI, visibleWidth } from "@earendil-works/pi-tui";
import { installToolGroupingPatch } from "../src/pi-adapter.ts";
import { renderToolGroup } from "../src/renderer.ts";
import { createNoThinkingTranscriptReplay, TranscriptReplay } from "../src/transcript-replay.ts";
import { buildSessionProjection } from "../src/session-projection.ts";

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
  it("replays the incident as four separate roots with conserved source-order tools", () => {
    initTheme("dark", false);
    const fixture = createNoThinkingTranscriptReplay(fakeTui(), process.cwd());
    const projection = buildSessionProjection(fixture)!;
    const original = JSON.stringify(fixture.messages);
    const groups: string[][] = [];
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSessionProjection: () => projection,
      renderGroup: (group, width, groupTheme) => {
        groups.push(group.rows.map((row) => row.toolName));
        return renderToolGroup(group, width, groupTheme);
      },
    });
    try {
      const output = fixture.transcript.render(120).join("\n");
      expect(output.match(/◉ Thinking\.\.\./gu)).toHaveLength(4);
      expect(groups).toEqual([
        ["read", "read"], ["bash"], ["web_enable"],
        ["fetch_content"], ["bash"], ["bash"],
        ["read", "read"], ["get_search_content", "fetch_content"],
      ]);
      expect(groups.flat()).toHaveLength(11);
      expect(output).toContain("├─ Read 2 files");
      expect(output).toContain("╰─ Run 2 tools");
      expect(output).not.toContain("synthetic-opaque-signature");
      expect(JSON.stringify(fixture.messages)).toBe(original);
      for (const width of [1, 2, 20, 49, 80, 120, 200]) {
        const lines = fixture.transcript.render(width);
        expect(lines.length).toBeGreaterThan(0);
        expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
      }
    } finally {
      handle?.uninstall();
    }
  });

  it.each(["", " \t\n"])("keeps signed/redacted source-empty reasoning %j as UI only", (thinking) => {
    initTheme("dark", false);
    const fixture = createNoThinkingTranscriptReplay(fakeTui(), process.cwd());
    const source = { ...fixture.messages[2]!, content: [
      { type: "thinking" as const, thinking, redacted: true, thinkingSignature: "synthetic-encrypted-payload" },
      ...fixture.messages[2]!.content.filter((content) => content.type !== "thinking"),
    ] };
    fixture.assistants[2]!.updateContent(source);
    const original = JSON.stringify(source);
    const handle = installToolGroupingPatch({ getTheme: () => theme,
      getSessionProjection: () => buildSessionProjection(fixture), renderGroup: renderToolGroup });
    try {
      const output = fixture.transcript.render(120).join("\n");
      expect(output.match(/◉ Thinking\.\.\./gu)).toHaveLength(4);
      expect(output).not.toContain("synthetic-encrypted-payload");
      expect(JSON.stringify(source)).toBe(original);
    } finally { handle?.uninstall(); }
  });

  it("preserves full-width leading commentary before its source-empty root", () => {
    initTheme("dark", false);
    const fixture = createNoThinkingTranscriptReplay(fakeTui(), process.cwd());
    const source = { ...fixture.messages[2]!, content: [
      { type: "text" as const, text: "Leading native commentary stays before its tools.",
        textSignature: JSON.stringify({ v: 1, id: "fixture-commentary", phase: "commentary" }) },
      ...fixture.messages[2]!.content,
    ] };
    fixture.assistants[2]!.updateContent(source);
    const entries = fixture.entries.map((entry) => entry.id === "incident-assistant-2"
      ? { ...entry, message: source } : entry);
    const handle = installToolGroupingPatch({ getTheme: () => theme,
      getSessionProjection: () => buildSessionProjection({ entries, leafId: fixture.leafId }), renderGroup: renderToolGroup });
    try {
      const lines = fixture.transcript.render(120);
      const commentary = lines.findIndex((line) => line.includes("Leading native commentary"));
      expect(commentary).toBeGreaterThan(0);
      expect(lines[commentary]).not.toContain("│");
      const root = lines.findIndex((line, index) => index > commentary && line.includes("◉ Thinking..."));
      expect(root).toBeGreaterThan(commentary);
      expect(lines.slice(root).join("\n")).toContain("╰─ Run 1 command");
      expect(lines.join("\n").match(/◉ Thinking\.\.\./gu)).toHaveLength(4);
    } finally { handle?.uninstall(); }
  });

  it("does not swallow an intervening native row or use it to invent ownership", () => {
    initTheme("dark", false);
    const fixture = createNoThinkingTranscriptReplay(fakeTui(), process.cwd());
    const interrupted = new Container();
    for (const child of fixture.transcript.children) {
      interrupted.addChild(child);
      if (child === fixture.assistants[1]) interrupted.addChild(new Text("Visible native boundary", 1, 0));
    }
    const groups: string[][] = [];
    const handle = installToolGroupingPatch({ getTheme: () => theme,
      getSessionProjection: () => buildSessionProjection(fixture),
      renderGroup: (group, width, groupTheme) => {
        groups.push(group.rows.map((row) => row.toolName));
        return renderToolGroup(group, width, groupTheme);
      } });
    try {
      const output = interrupted.render(120).join("\n");
      expect(output).toContain("Visible native boundary");
      expect(output.match(/◉ Thinking\.\.\./gu)).toHaveLength(3);
      // The two calls in the interrupted response are native, not compacted
      // beneath another assistant or silently discarded.
      expect(groups.flat()).toHaveLength(9);
      expect(groups.flat().filter((name) => name === "fetch_content")).toHaveLength(1);
      expect(output).toContain("fetch_content");
    } finally { handle?.uninstall(); }
  });

  it("fails open to the complete native transcript when compact rendering throws", () => {
    initTheme("dark", false);
    const fixture = createNoThinkingTranscriptReplay(fakeTui(), process.cwd());
    const native = fixture.transcript.render(120);
    const handle = installToolGroupingPatch({ getTheme: () => theme,
      getSessionProjection: () => buildSessionProjection(fixture),
      renderGroup: () => { throw new Error("fixture rendering failure"); } });
    try { expect(fixture.transcript.render(120)).toEqual(native); }
    finally { handle?.uninstall(); }
  });

  it("restores complete native rendering during expansion and ambiguous session replacement", () => {
    initTheme("dark", false);
    const fixture = createNoThinkingTranscriptReplay(fakeTui(), process.cwd());
    let projection = buildSessionProjection(fixture)!;
    fixture.tools.forEach((tool) => tool.setExpanded(true));
    const native = fixture.transcript.render(120);
    const handle = installToolGroupingPatch({ getTheme: () => theme,
      getSessionProjection: () => projection, renderGroup: renderToolGroup });
    try {
      expect(fixture.transcript.render(120)).toEqual(native);
      fixture.tools.forEach((tool) => tool.setExpanded(false));
      expect(fixture.transcript.render(120).join("\n").match(/◉ Thinking\.\.\./gu)).toHaveLength(4);
      projection = { leafId: null, turns: [] };
      expect(fixture.transcript.render(120).join("\n")).not.toContain("◉ Thinking...");
      projection = buildSessionProjection(fixture)!;
      fixture.transcript.invalidate();
      expect(fixture.transcript.render(120).join("\n").match(/◉ Thinking\.\.\./gu)).toHaveLength(4);
    } finally {
      handle?.uninstall();
    }
  });

  it("keeps real native hidden reasoning distinct and mouse-addressable after synthetic roots", () => {
    initTheme("dark", false);
    const fixture = createNoThinkingTranscriptReplay(fakeTui(), process.cwd());
    const source = { ...fixture.messages[1]!, content: [
      { type: "thinking" as const, thinking: "Native secret reasoning" },
      ...fixture.messages[1]!.content,
    ] };
    fixture.assistants[1]!.updateContent(source);
    fixture.assistants[1]!.setHideThinkingBlock(true);
    fixture.assistants[1]!.setHiddenThinkingLabel("Native hidden reasoning");
    const entries = fixture.entries.map((entry) => entry.id === "incident-assistant-1"
      ? { ...entry, message: source } : entry);
    const projection = buildSessionProjection({ entries, leafId: fixture.leafId })!;
    const handle = installToolGroupingPatch({ getTheme: () => theme,
      getSessionProjection: () => projection, renderGroup: renderToolGroup });
    try {
      const lines = fixture.transcript.render(120);
      const output = lines.join("\n");
      // The real source-thinking scene can anchor both following empty scenes;
      // neither its native label nor that continuation needs a synthetic root.
      expect(output.match(/◉ Thinking\.\.\./gu)).toHaveLength(1);
      expect(output).toContain("Native hidden reasoning");
      expect(output).not.toContain("Native secret reasoning");
      const rootY = lines.findIndex((line) => line.includes("◉ Thinking..."));
      fixture.transcript.handleMouse?.({ type: "click", button: "left", x: 6, y: rootY,
        screenX: 6, screenY: rootY, width: 120, height: lines.length,
        shift: false, alt: false, ctrl: false });
      expect(fixture.transcript.render(120).join("\n")).not.toContain("Native secret reasoning");
      const y = lines.findIndex((line) => line.includes("Native hidden reasoning"));
      fixture.transcript.handleMouse?.({ type: "click", button: "left", x: 6, y,
        screenX: 6, screenY: y, width: 120, height: lines.length,
        shift: false, alt: false, ctrl: false });
      expect(fixture.transcript.render(120).join("\n")).toContain("Native secret reasoning");
      fixture.assistants[1]!.setHideThinkingBlock(true);
      expect(fixture.transcript.render(120).join("\n")).not.toContain("Native secret reasoning");
    } finally {
      handle?.uninstall();
    }
  });

  it("updates a running no-thinking root on settlement without changing source content", () => {
    initTheme("dark", false);
    const fixture = createNoThinkingTranscriptReplay(fakeTui(), process.cwd());
    const source = fixture.messages[0]!;
    fixture.assistants[0]!.updateContent({ ...source, stopReason: "pending" }, true);
    fixture.tools[0]!.updateResult({ content: [], isError: false }, true);
    const colors: string[] = [];
    const handle = installToolGroupingPatch({
      getTheme: () => ({ ...theme, fg: (color, text) => { if (text === "◉") colors.push(color); return text; } }),
      getSessionProjection: () => buildSessionProjection(fixture), renderGroup: renderToolGroup,
    });
    try {
      expect(fixture.transcript.render(120).join("\n").match(/◉ Thinking\.\.\./gu)).toHaveLength(4);
      expect(colors[0]).toBe("syntaxKeyword");
      colors.length = 0;
      fixture.assistants[0]!.updateContent(source, false);
      fixture.tools[0]!.updateResult({ content: [{ type: "text", text: "Fixture failed" }], isError: true });
      const settled = fixture.transcript.render(120).join("\n");
      expect(settled).toContain("Fixture failed");
      expect(colors[0]).toBe("success");
      expect(source.content[0]!.type).toBe("toolCall");
    } finally {
      handle?.uninstall();
    }
  });

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
    expect(all).toContain("Clarifying diagnostic layout and error formatting");
    expect(all).toContain("Validation:");
    expect(all).toContain("Inspecting the existing row shape");
    expect(all).toContain("native commentary");
    expect(all).toContain("Applying the settled replacement");
    expect(all).not.toContain("Tool step");
    expect(all).not.toMatch(/\b\d+ actions?\b/u);
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
