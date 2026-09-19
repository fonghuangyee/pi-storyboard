import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantMessageComponent, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, type TuiMouseEvent } from "@earendil-works/pi-tui";
import {
  classifyToolRowForTesting,
  installToolGroupingPatch,
  PATCH_MARKER,
} from "../src/pi-adapter.ts";
import { renderToolGroup, type ThemeLike, type ToolRowSnapshot } from "../src/renderer.ts";
import type { SessionProjection } from "../src/session-projection.ts";
import { normalizePresentationSettings } from "../src/presentation-settings.ts";

const theme: ThemeLike = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

function tool(
  name: string,
  args: unknown = { path: `${name}.ts` },
  result: unknown = undefined,
  expanded = false,
): ToolExecutionComponent & Record<string, unknown> {
  const row = Object.create(ToolExecutionComponent.prototype) as ToolExecutionComponent & Record<string, unknown>;
  const fields = row as unknown as Record<string, unknown>;
  fields.toolName = name;
  fields.args = args;
  fields.result = result;
  fields.isPartial = result === undefined;
  fields.expanded = expanded;
  fields.render = vi.fn(() => [`native ${name}`]);
  return row;
}

function assistant(lines: string[]): AssistantMessageComponent & Record<string, unknown> {
  const component = Object.create(AssistantMessageComponent.prototype) as AssistantMessageComponent & Record<string, unknown>;
  component.render = vi.fn(() => lines);
  return component;
}

function storyboardAssistant(
  lines: string[],
  toolCallIds: readonly string[],
  options: {
    thinking?: boolean;
    text?: boolean;
    textPhase?: "commentary" | "final_answer";
    streaming?: boolean;
    stopReason?: string;
  } = {},
): AssistantMessageComponent & Record<string, unknown> {
  const component = assistant(lines);
  const fields = component as unknown as Record<string, unknown>;
  fields.lastMessage = {
    role: "assistant",
    content: [
      ...(options.thinking === false ? [] : [{ type: "thinking", thinking: "work" }]),
      ...(options.text ? [{
        type: "text",
        text: "answer",
        ...(options.textPhase === undefined
          ? {}
          : { textSignature: JSON.stringify({ v: 1, id: "msg-test", phase: options.textPhase }) }),
      }] : []),
      ...toolCallIds.map((id) => ({ type: "toolCall", id, name: "read", arguments: {} })),
    ],
    stopReason: options.stopReason ?? "stop",
  };
  fields.isStreaming = options.streaming ?? false;
  return component;
}

function interleavedAssistant(): {
  owner: AssistantMessageComponent & Record<string, unknown>;
  firstThinking: Record<string, unknown>;
  secondThinking: Record<string, unknown>;
} {
  const owner = assistant(["", " first thinking", "", " second thinking"]);
  const firstThinking: Record<string, unknown> = {
    render: vi.fn(() => [" first thinking"]),
    handleMouse: vi.fn(() => ({ handled: true })),
  };
  const nativeSpacer: Record<string, unknown> = { render: vi.fn(() => [""]) };
  const secondThinking: Record<string, unknown> = {
    render: vi.fn(() => [" second thinking"]),
    handleMouse: vi.fn(() => ({ handled: true })),
  };
  const fields = owner as unknown as Record<string, unknown>;
  fields.lastMessage = {
    role: "assistant",
    content: [
      { type: "thinking", thinking: "first thinking" },
      { type: "toolCall", id: "read-1", name: "read", arguments: {} },
      { type: "thinking", thinking: "second thinking" },
      { type: "toolCall", id: "edit-1", name: "edit", arguments: {} },
    ],
    stopReason: "toolUse",
  };
  fields.isStreaming = false;
  const contentChildren = [nativeSpacer, firstThinking, nativeSpacer, secondThinking];
  fields.contentContainer = {
    children: contentChildren,
    mouseLayout: {
      width: 78,
      children: contentChildren.map((component) => ({ component, height: 1 })),
    },
  };
  return { owner, firstThinking, secondThinking };
}

function assignToolCallId(row: ToolExecutionComponent, toolCallId: string): void {
  (row as unknown as Record<string, unknown>).toolCallId = toolCallId;
}

function result(isError = false, content: unknown[] = [{ type: "text", text: "output" }]): unknown {
  return { content, details: { source: "test" }, isError };
}

function expansionStatusRows(status = "collapsed"): [Record<string, unknown>, Record<string, unknown>] {
  return [
    { lines: 1, render: vi.fn(() => [""]) },
    {
      text: `Tool output: ${status}`,
      paddingX: 1,
      paddingY: 0,
      render: vi.fn(() => [` status ${status}`]),
    },
  ];
}

function sessionInfoStatusRows(): [Record<string, unknown>, Record<string, unknown>] {
  return [
    { lines: 1, render: vi.fn(() => [""]) },
    {
      text: "Session Info\n\nFile: /tmp/session.jsonl\nID: test\n\nMessages\nTools: 1 calls, 1 results\n\nTokens",
      paddingX: 1,
      paddingY: 0,
      render: vi.fn(() => [" session info"]),
    },
  ];
}

function container(...children: unknown[]): Container {
  const value = new Container();
  value.children = children as never[];
  return value;
}

describe("Container adapter", () => {
  let original: Container["render"];

  beforeEach(() => {
    // Each test owns its handle, but this also makes a failed test unable to
    // poison the prototype for the following case.
    const prototype = Container.prototype as unknown as Record<PropertyKey, unknown>;
    const marker = prototype[PATCH_MARKER];
    if (marker && typeof marker === "object") {
      const savedOriginal = (marker as Record<string, unknown>).original;
      if (typeof savedOriginal === "function") {
        Container.prototype.render = savedOriginal as Container["render"];
      }
      try {
        delete prototype[PATCH_MARKER];
      } catch {
        // The normal adapter marker is configurable.
      }
    }
    original = Container.prototype.render;
  });

  it("renders one assistant response and its tools as a closed story block", () => {
    const owner = storyboardAssistant([`assistant work${" ".repeat(60)}`], ["read-1", "bash-1"]);
    const read = tool("read", { path: "a.ts" }, result());
    const bash = tool("bash", { command: "npm test" }, result());
    assignToolCallId(read, "read-1");
    assignToolCallId(bash, "bash-1");
    const following = { render: vi.fn(() => ["following"]) };
    const renderGroup = vi.fn((group: { kind: string }) => [
      "",
      ` ${group.kind} heading`,
      "  ● row",
    ]);
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup });

    const lines = container(owner, read, bash, following).render(80);
    expect(lines.join("\\n")).toContain("◉assistant work");
    expect(lines.join("\\n")).toContain("├─ read heading");
    expect(lines.join("\\n")).toContain("╰─ command heading");
    expect(lines.join("\\n")).not.toMatch(/\b\d+ actions?\b/u);
    expect(renderGroup.mock.calls.map(([group]) => group.kind)).toEqual(["read", "command"]);
    expect(owner.render).toHaveBeenCalledOnce();
    expect(read.render).not.toHaveBeenCalled();
    expect(bash.render).not.toHaveBeenCalled();
    expect(following.render).toHaveBeenCalledOnce();
    handle?.uninstall();
  });

  it("threads presentation settings through the guarded render path", () => {
    const owner = storyboardAssistant(["assistant"], ["read-1"]);
    const read = tool("read", { path: "a.ts" }, result());
    assignToolCallId(read, "read-1");
    const settings = normalizePresentationSettings({
      symbols: {
        thinkingRoot: "R",
        rail: "!",
        lastBranch: "E",
        toolDots: { read: "r" },
      },
    });
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSettings: () => settings,
      renderGroup: (group, width, groupTheme, passedSettings) =>
        renderToolGroup(group, width, groupTheme, passedSettings),
    });

    const output = container(owner, read).render(80).join("\\n");
    expect(output).toContain("Rassistant");
    expect(output).toContain("E  Read 1 file");
    expect(output).toContain("r a.ts");
    handle?.uninstall();
  });

  it("keeps settled web tools in a validated storyboard", () => {
    const owner = storyboardAssistant(["researching"], ["web-1"]);
    const ownerFields = owner as unknown as Record<string, unknown>;
    const message = ownerFields.lastMessage as Record<string, unknown>;
    const content = message.content as Array<Record<string, unknown>>;
    content[1]!.name = "web_search";
    const webSearch = tool("web_search", { queries: ["Pi"] }, result());
    assignToolCallId(webSearch, "web-1");
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSessionProjection: () => ({
        leafId: "result",
        turns: [{
          entryId: "assistant",
          toolCallIds: ["web-1"],
          resultEntryIds: ["result"],
          hasVisibleThinking: true,
          hasCommentary: false,
          hasFinalAnswer: false,
          hasUnknownText: false,
          valid: true,
          boundaryBefore: false,
          boundaryAfter: false,
        }],
      }),
      renderGroup: (group: { kind: string; rows: readonly ToolRowSnapshot[] }) => [
        "",
        ` ${group.kind} ${group.rows[0]?.toolName}`,
      ],
    });

    const output = container(owner, webSearch).render(80).join("\\n");
    expect(output).toContain("╰─ tool web_search");
    expect(webSearch.render).not.toHaveBeenCalled();
    handle?.uninstall();
  });

  it("keeps a live blocking tool in the storyboard before its session result exists", () => {
    const owner = storyboardAssistant(["waiting for an answer"], ["ask-1"]);
    const pendingQuestion = tool("ask_user_question", { questions: [] });
    assignToolCallId(pendingQuestion, "ask-1");
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSessionProjection: () => ({ leafId: null, turns: [] }),
      renderGroup: (group: { kind: string }) => ["", ` ${group.kind} question`],
    });

    const value = container(owner, pendingQuestion);
    const output = value.render(80).join("\\n");
    expect(output).toContain("◉waiting for an answer");
    expect(output).toContain("╰─ tool question");
    expect(pendingQuestion.render).not.toHaveBeenCalled();
    handle?.uninstall();
  });

  it("continues a validated empty-thinking turn under the previous thinking root", () => {
    const firstOwner = storyboardAssistant(["first thinking"], ["read-1"]);
    const firstTool = tool("read", { path: "first.ts" }, result());
    assignToolCallId(firstTool, "read-1");
    const secondOwner = storyboardAssistant([""], ["read-2"], { thinking: false });
    const secondTool = tool("read", { path: "second.ts" }, result());
    assignToolCallId(secondTool, "read-2");
    const session: SessionProjection = {
      leafId: "a2",
      turns: [
        {
          entryId: "a1",
          toolCallIds: ["read-1"],
          resultEntryIds: ["r1"],
          hasVisibleThinking: true,
          hasCommentary: false,
          hasFinalAnswer: false,
          hasUnknownText: false,
          valid: true,
          boundaryBefore: false,
          boundaryAfter: false,
        },
        {
          entryId: "a2",
          toolCallIds: ["read-2"],
          resultEntryIds: ["r2"],
          hasVisibleThinking: false,
          hasCommentary: false,
          hasFinalAnswer: false,
          hasUnknownText: false,
          valid: true,
          boundaryBefore: false,
          boundaryAfter: false,
        },
      ],
    };
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSessionProjection: () => session,
      renderGroup: (group: { kind: string; rows: readonly ToolRowSnapshot[] }) => [
        "",
        ` ${group.kind} ${group.rows.length}`,
      ],
    });
    const output = container(firstOwner, firstTool, secondOwner, secondTool).render(80).join("\\n");
    expect(output.match(/◉/gu)).toHaveLength(1);
    expect(output).toContain("╰─ read 2");
    expect(output).not.toContain("read 1");
    expect(output).not.toContain("Thinking...");
    handle?.uninstall();
  });

  it("keeps same-kind actions separate across visible-thinking turns", () => {
    const firstOwner = storyboardAssistant(["first thinking"], ["read-1"]);
    const firstTool = tool("read", { path: "first.ts" }, result());
    assignToolCallId(firstTool, "read-1");
    const secondOwner = storyboardAssistant(["second thinking"], ["read-2"]);
    const secondTool = tool("read", { path: "second.ts" }, result());
    assignToolCallId(secondTool, "read-2");
    const session: SessionProjection = {
      leafId: "a2",
      turns: [
        {
          entryId: "a1",
          toolCallIds: ["read-1"],
          resultEntryIds: ["r1"],
          hasVisibleThinking: true,
          hasCommentary: false,
          hasFinalAnswer: false,
          hasUnknownText: false,
          valid: true,
          boundaryBefore: false,
          boundaryAfter: false,
        },
        {
          entryId: "a2",
          toolCallIds: ["read-2"],
          resultEntryIds: ["r2"],
          hasVisibleThinking: true,
          hasCommentary: false,
          hasFinalAnswer: false,
          hasUnknownText: false,
          valid: true,
          boundaryBefore: false,
          boundaryAfter: false,
        },
      ],
    };
    const renderGroup = vi.fn((group: { kind: string; rows: readonly ToolRowSnapshot[] }) => [
      "",
      ` ${group.kind} ${group.rows.length}`,
    ]);
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSessionProjection: () => session,
      renderGroup,
    });

    const output = container(firstOwner, firstTool, secondOwner, secondTool).render(80).join("\\n");
    expect(output.match(/◉/gu)).toHaveLength(2);
    expect(renderGroup.mock.calls.map(([group]) => group.rows.length)).toEqual([1, 1]);
    handle?.uninstall();
  });

  it("does not continue across a projected hard boundary", () => {
    const firstOwner = storyboardAssistant(["first thinking"], ["read-1"]);
    const firstTool = tool("read", { path: "first.ts" }, result());
    assignToolCallId(firstTool, "read-1");
    const secondOwner = storyboardAssistant([""], ["read-2"], { thinking: false });
    const secondTool = tool("read", { path: "second.ts" }, result());
    assignToolCallId(secondTool, "read-2");
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSessionProjection: () => ({
        leafId: "a2",
        turns: [
          {
            entryId: "a1",
            toolCallIds: ["read-1"],
            resultEntryIds: ["r1"],
            hasVisibleThinking: true,
            hasCommentary: false,
            hasFinalAnswer: false,
            hasUnknownText: false,
            valid: true,
            boundaryBefore: false,
            boundaryAfter: true,
          },
          {
            entryId: "a2",
            toolCallIds: ["read-2"],
            resultEntryIds: ["r2"],
            hasVisibleThinking: false,
            hasCommentary: false,
            hasFinalAnswer: false,
            hasUnknownText: false,
            valid: true,
            boundaryBefore: false,
            boundaryAfter: false,
          },
        ],
      }),
      renderGroup: (group: { kind: string; rows: readonly ToolRowSnapshot[] }) => [
        "",
        ` ${group.kind} ${group.rows.length}`,
      ],
    });

    const output = container(firstOwner, firstTool, secondOwner, secondTool).render(80).join("\\n");
    expect(output.match(/◉/gu)).toHaveLength(2);
    handle?.uninstall();
  });

  it("renders validated commentary at full native width before resuming work", () => {
    const owner = assistant(["", "commentary 78"]);
    const fields = owner as unknown as Record<string, unknown>;
    const commentary = {
      render: vi.fn((width: number) => [`commentary ${width}`]),
      handleMouse: vi.fn(() => ({ handled: true })),
    };
    const spacer = { render: vi.fn(() => [""]) };
    fields.lastMessage = {
      role: "assistant",
      content: [
        { type: "text", text: "commentary", textSignature: JSON.stringify({ v: 1, id: "commentary", phase: "commentary" }) },
        { type: "toolCall", id: "read-commentary", name: "read", arguments: {} },
      ],
      stopReason: "toolUse",
    };
    fields.isStreaming = false;
    fields.contentContainer = {
      children: [spacer, commentary],
      mouseLayout: {
        width: 78,
        children: [{ component: spacer, height: 1 }, { component: commentary, height: 1 }],
      },
    };
    const read = tool("read", { path: "commentary.ts" }, result());
    assignToolCallId(read, "read-commentary");
    const session: SessionProjection = {
      leafId: "result",
      turns: [{
        entryId: "assistant",
        toolCallIds: ["read-commentary"],
        resultEntryIds: ["result"],
        hasVisibleThinking: false,
        hasCommentary: true,
        hasFinalAnswer: false,
        hasUnknownText: false,
        valid: true,
        boundaryBefore: false,
        boundaryAfter: false,
      }],
    };
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSessionProjection: () => session,
      renderGroup: () => ["", " Read 1 file"],
    });
    const output = container(owner, read).render(80).join("\\n");
    expect(output).toContain("commentary 80");
    expect(output).not.toContain("│commentary 80");
    expect(commentary.render).toHaveBeenCalledWith(80);
    expect(output).toContain("◉");
    handle?.uninstall();
  });

  it("inserts a thinking placeholder after same-response commentary before tools", () => {
    const owner = storyboardAssistant(["", " planning", "", "commentary 78"], ["read-commentary-suffix"], {
      text: true,
      textPhase: "commentary",
    });
    const ownerFields = owner as unknown as Record<string, unknown>;
    const leadingSpacer = { render: vi.fn(() => [""]) };
    const betweenSpacer = { render: vi.fn(() => [""]) };
    const thinking = {
      render: vi.fn(() => [" planning"]),
      handleMouse: vi.fn(() => ({ handled: true })),
    };
    const commentary = {
      render: vi.fn((width: number) => [`commentary ${width}`]),
      handleMouse: vi.fn(() => ({ handled: true })),
    };
    ownerFields.contentContainer = {
      children: [leadingSpacer, thinking, betweenSpacer, commentary],
      mouseLayout: {
        width: 78,
        children: [
          { component: leadingSpacer, height: 1 },
          { component: thinking, height: 1 },
          { component: betweenSpacer, height: 1 },
          { component: commentary, height: 1 },
        ],
      },
    };
    const read = tool("read", { path: "commentary-suffix.ts" }, result());
    assignToolCallId(read, "read-commentary-suffix");
    const session: SessionProjection = {
      leafId: "result",
      turns: [{
        entryId: "assistant",
        toolCallIds: ["read-commentary-suffix"],
        resultEntryIds: ["result"],
        hasVisibleThinking: true,
        hasCommentary: true,
        hasFinalAnswer: false,
        hasUnknownText: false,
        valid: true,
        boundaryBefore: false,
        boundaryAfter: false,
      }],
    };
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSessionProjection: () => session,
      renderGroup: () => ["", " Read 1 file"],
    });

    const output = container(owner, read).render(80).join("\\n");
    expect(output).toContain("commentary 80");
    expect(output).not.toContain("│commentary 80");
    expect(output).toContain("◉ Thinking...");
    expect(output).toContain("╰─ Read 1 file");
    expect(output).not.toContain("◉ Read 1 file");
    expect(commentary.render).toHaveBeenCalledWith(80);
    expect(read.render).not.toHaveBeenCalled();
    handle?.uninstall();
  });

  it("closes each assistant/tool batch before the next thinking block", () => {
    const firstOwner = storyboardAssistant(["first thinking"], ["read-1"]);
    const firstTool = tool("read", { path: "first.ts" }, result());
    assignToolCallId(firstTool, "read-1");
    const secondOwner = storyboardAssistant(["next thinking"], ["bash-1"]);
    const secondTool = tool("bash", { command: "npm test" }, result());
    assignToolCallId(secondTool, "bash-1");
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: (group: { kind: string }) => ["", ` ${group.kind} heading`],
    });

    const output = container(firstOwner, firstTool, secondOwner, secondTool).render(80).join("\n");
    expect(output.match(/◉/gu)).toHaveLength(2);
    expect(output.match(/╰─/gu)).toHaveLength(2);
    expect(output.indexOf("first thinking")).toBeLessThan(output.indexOf("╰─ read heading"));
    expect(output.indexOf("╰─ read heading")).toBeLessThan(output.indexOf("next thinking"));
    expect(output.indexOf("next thinking")).toBeLessThan(output.indexOf("╰─ command heading"));
    handle?.uninstall();
  });

  it("uses the same placeholder for an explicit empty thinking block", () => {
    const owner = assistant([]);
    const fields = owner as unknown as Record<string, unknown>;
    fields.lastMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "" },
        { type: "toolCall", id: "read-empty-thinking", name: "read", arguments: {} },
      ],
      stopReason: "toolUse",
    };
    fields.isStreaming = false;
    const read = tool("read", { path: "empty-thinking.ts" }, result());
    assignToolCallId(read, "read-empty-thinking");
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: () => ["", " Read 1 file"],
    });

    const output = container(owner, read).render(80).join("\\n");
    expect(output).toContain("◉ Thinking...");
    expect(output).toContain("╰─ Read 1 file");
    handle?.uninstall();
  });

  it("keeps an edit compact through partial args, preview invalidation, and settlement", () => {
    const owner = storyboardAssistant(["", " thinking while editing"], ["edit-running"]);
    const thinking = {
      render: vi.fn(() => [" thinking while editing"]),
      handleMouse: vi.fn(() => ({ handled: true })),
    };
    const spacer = { render: vi.fn(() => [""]) };
    const ownerFields = owner as unknown as Record<string, unknown>;
    ownerFields.contentContainer = {
      children: [spacer, thinking],
      mouseLayout: {
        width: 78,
        children: [
          { component: spacer, height: 1 },
          { component: thinking, height: 1 },
        ],
      },
    };
    const runningEdit = tool("edit", {});
    assignToolCallId(runningEdit, "edit-running");
    const editFields = runningEdit as unknown as Record<string, unknown>;
    const editMouse = vi.fn(() => ({ handled: true }));
    editFields.handleMouse = editMouse;
    runningEdit.render = vi.fn(() => ["FULL-WIDTH GREEN NATIVE EDIT PREVIEW"]);
    const snapshots: ToolRowSnapshot[] = [];
    const renderGroup = vi.fn((group: { rows: readonly ToolRowSnapshot[] }) => {
      const row = group.rows[0]!;
      snapshots.push(row);
      const args = row.args as { path?: string; replacementCount?: number } | undefined;
      const label = args?.path ?? "edit";
      const count = args?.replacementCount;
      const detail = count === undefined ? "" : ` (${count} replacement)`;
      return ["", " Edit 1 time", `  ● ${label}${detail}`];
    });
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup });
    const value = container(owner, runningEdit);

    const partialOutput = value.render(80).join("\\n");
    expect(partialOutput).toContain("◉ thinking while editing");
    expect(partialOutput).toContain("╰─ Edit 1 time");
    expect(partialOutput).toContain("● edit");

    editFields.args = {
      path: "src/storyboard-renderer.ts",
      edits: [{ oldText: "old", newText: "new" }],
    };
    const previewOutput = value.render(80).join("\\n");
    expect(previewOutput).toContain("● src/storyboard-renderer.ts");
    expect(previewOutput).not.toContain("FULL-WIDTH GREEN");

    editFields.result = result();
    editFields.isPartial = false;
    const settledLines = value.render(80);
    const settledOutput = settledLines.join("\\n");
    expect(settledOutput).toContain("● src/storyboard-renderer.ts (1 replacement)");
    expect(settledOutput).not.toContain("FULL-WIDTH GREEN");
    expect(snapshots.map((snapshot) => snapshot.args)).toEqual([
      undefined,
      { path: "src/storyboard-renderer.ts" },
      { path: "src/storyboard-renderer.ts", replacementCount: 1 },
    ]);
    expect(runningEdit.render).not.toHaveBeenCalled();

    const editLine = settledLines.findIndex((line) => line.includes("src/storyboard-renderer.ts"));
    value.handleMouse?.({
      type: "click",
      button: "left",
      x: 8,
      y: editLine,
      screenX: 8,
      screenY: editLine,
      width: 80,
      height: settledLines.length,
      shift: false,
      alt: false,
      ctrl: false,
    });
    expect(editMouse).not.toHaveBeenCalled();

    editFields.expanded = true;
    expect(value.render(80).join("\\n")).toContain("FULL-WIDTH GREEN NATIVE EDIT PREVIEW");
    expect(runningEdit.render).toHaveBeenCalledOnce();
    handle?.uninstall();
  });

  it("renders interleaved native thinking runs in source order", () => {
    const { owner, secondThinking } = interleavedAssistant();
    const read = tool("read", { path: "a.ts" }, result());
    const edit = tool("edit", { path: "a.ts", edits: [{ oldText: "old", newText: "new" }] }, result());
    assignToolCallId(read, "read-1");
    assignToolCallId(edit, "edit-1");
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: (group: { kind: string }) => ["", ` ${group.kind} heading`],
    });

    const value = container(owner, edit, read);
    const lines = value.render(80);
    const rendered = lines.join("\n");
    const firstIndex = rendered.indexOf("first thinking");
    const readIndex = rendered.indexOf("read heading");
    const secondIndex = rendered.indexOf("second thinking");
    const editIndex = rendered.indexOf("edit heading");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeLessThan(readIndex);
    expect(readIndex).toBeLessThan(secondIndex);
    expect(secondIndex).toBeLessThan(editIndex);

    const secondLine = lines.findIndex((line) => line.includes("second thinking"));
    value.handleMouse?.({
      type: "click",
      button: "left",
      x: 10,
      y: secondLine,
      screenX: 10,
      screenY: secondLine,
      width: 80,
      height: lines.length,
      shift: false,
      alt: false,
      ctrl: false,
    });
    expect(secondThinking.handleMouse).toHaveBeenCalledOnce();
    handle?.uninstall();
  });

  it("renders a thinking-only assistant as a quiet content node", () => {
    const note = storyboardAssistant(["reviewing logic"], []);
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["bad"] });

    expect(container(note).render(80).join("\\n")).toContain("○reviewing logic");
    handle?.uninstall();
  });

  it("renders tool-only responses under a thinking placeholder", () => {
    const owner = storyboardAssistant([], ["write-1"], { thinking: false });
    const write = tool("write", { path: "a.txt", content: "hidden" }, result());
    assignToolCallId(write, "write-1");
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: () => ["", " Write 1 file", "  ● a.txt"],
    });

    const lines = container(owner, write).render(80).join("\\n");
    expect(lines).toContain("◉ Thinking...");
    expect(lines).toContain("╰─ Write 1 file");
    expect(lines).not.toContain("Tool step");
    expect(owner.render).toHaveBeenCalledOnce();
    expect(write.render).not.toHaveBeenCalled();
    handle?.uninstall();
  });

  it("translates storyboard-gutter mouse coordinates back to native assistant content", () => {
    const owner = storyboardAssistant(["assistant work"], ["read-1"]);
    const read = tool("read", { path: "a.ts" }, result());
    assignToolCallId(read, "read-1");
    const handleMouse = vi.fn(() => ({ handled: true }));
    (owner as unknown as Record<string, unknown>).handleMouse = handleMouse;
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["", " Read 1 file"] });
    const value = container(owner, read);
    const lines = value.render(80);

    value.handleMouse?.({
      type: "click",
      button: "left",
      x: 6,
      y: 1,
      screenX: 6,
      screenY: 1,
      width: 80,
      height: lines.length,
      shift: false,
      alt: false,
      ctrl: false,
    });
    expect(handleMouse).toHaveBeenCalledOnce();
    const mappedEvent = handleMouse.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(mappedEvent[0]).toMatchObject({ x: 4, width: 78, height: 1 });
    handle?.uninstall();
  });

  it("maps direct tool rows back to assistant source order", () => {
    const owner = storyboardAssistant(["assistant work"], ["read-1", "bash-1"]);
    const read = tool("read", { path: "a.ts" }, result());
    const bash = tool("bash", { command: "npm test" }, result());
    assignToolCallId(read, "read-1");
    assignToolCallId(bash, "bash-1");
    const renderGroup = vi.fn((group: { kind: string }) => ["", ` ${group.kind} heading`]);
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup });

    const lines = container(owner, bash, read).render(80);
    expect(lines[0]).toBe("");
    expect(lines.join("\n")).toContain("◉assistant work");
    expect(lines.join("\n")).toContain("├─ read heading");
    expect(lines.join("\n")).toContain("╰─ command heading");
    expect(renderGroup.mock.calls.map(([group]) => group.kind)).toEqual(["read", "command"]);
    expect(owner.render).toHaveBeenCalledOnce();
    expect(bash.render).not.toHaveBeenCalled();
    expect(read.render).not.toHaveBeenCalled();
    handle?.uninstall();
  });

  it("marks separated thinking paragraphs before a native final answer", () => {
    const owner = assistant([
      "",
      " first final-turn thought",
      "",
      " second final-turn thought",
      "",
      " native final answer",
    ]);
    const fields = owner as unknown as Record<string, unknown>;
    fields.lastMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "first final-turn thought" },
        { type: "thinking", thinking: "second final-turn thought" },
        {
          type: "text",
          text: "native final answer",
          textSignature: JSON.stringify({ v: 1, id: "final-test", phase: "final_answer" }),
        },
      ],
      stopReason: "stop",
    };
    fields.isStreaming = false;
    const spacer = { render: vi.fn(() => [""]) };
    const thinking = {
      render: vi.fn(() => [" first final-turn thought", "", " second final-turn thought"]),
      handleMouse: vi.fn(() => ({ handled: true })),
    };
    const finalText = { render: vi.fn(() => [" native final answer"]) };
    fields.contentContainer = {
      children: [spacer, thinking, spacer, finalText],
      mouseLayout: {
        width: 80,
        children: [
          { component: spacer, height: 1 },
          { component: thinking, height: 3 },
          { component: spacer, height: 1 },
          { component: finalText, height: 1 },
        ],
      },
    };

    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["bad"] });
    const lines = container(owner).render(80);
    const output = lines.join("\\n");
    expect(output).toContain("○ first final-turn thought");
    expect(output).toContain("○ second final-turn thought");
    expect(output).toContain(" native final answer");
    expect(output).not.toContain("○ native final answer");
    expect(owner.render).toHaveBeenCalledOnce();
    handle?.uninstall();
  });

  it("uses validated text phase and fails open for final or unknown text", () => {
    const commentaryOwner = storyboardAssistant(["commentary update"], ["read-commentary"], {
      thinking: false,
      text: true,
      textPhase: "commentary",
      stopReason: "toolUse",
    });
    const commentaryTool = tool("read", { path: "commentary.ts" }, result());
    assignToolCallId(commentaryTool, "read-commentary");
    const commentaryRender = vi.fn(() => ["", " Read 1 file"]);
    const commentaryHandle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: commentaryRender,
    });
    const commentaryLines = container(commentaryOwner, commentaryTool).render(80).join("\n");
    expect(commentaryLines).toContain("○commentary update");
    expect(commentaryLines).toContain("╰─ Read 1 file");
    expect(commentaryTool.render).not.toHaveBeenCalled();
    commentaryHandle?.uninstall();

    for (const textPhase of ["final_answer", undefined] as const) {
      const owner = storyboardAssistant(["native assistant text"], ["read-native"], {
        thinking: false,
        text: true,
        ...(textPhase === undefined ? {} : { textPhase }),
      });
      const nativeTool = tool("read", { path: "native.ts" }, result());
      assignToolCallId(nativeTool, "read-native");
      const renderGroup = vi.fn(() => ["bad"]);
      const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup });

      expect(container(owner, nativeTool).render(80)).toEqual([
        "native assistant text",
        "native read",
      ]);
      expect(renderGroup).not.toHaveBeenCalled();
      handle?.uninstall();
    }
  });

  it("groups eligible rows without rendering grouped native rows", () => {
    const first = tool("read", { path: "a.ts" }, result());
    const second = tool("read", { path: "b.ts" }, undefined);
    const value = container(first, second);
    const renderGroup = vi.fn((group: { rows: readonly ToolRowSnapshot[] }) => [`group ${group.rows.length}`]);
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup });

    expect(handle).toBeDefined();
    expect(value.render(80)).toEqual(["group 2"]);
    expect(first.render).not.toHaveBeenCalled();
    expect(second.render).not.toHaveBeenCalled();
    expect(renderGroup).toHaveBeenCalledOnce();
    handle?.uninstall();
  });

  it("passes through Pi-provided command timing and omits absent timing", () => {
    const timed = tool("bash", { command: "npm test" }, result());
    (timed as unknown as Record<string, unknown>).rendererState = {
      startedAt: 1000,
      endedAt: 2488,
    };
    const untimed = tool("bash", { command: "git status" }, result());
    const snapshots: ToolRowSnapshot[] = [];
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: (group) => {
        snapshots.push(...group.rows);
        return ["group"];
      },
    });

    expect(container(timed, untimed).render(80)).toEqual(["group"]);
    expect(snapshots[0]?.elapsedMs).toBe(1488);
    expect(snapshots[1]?.elapsedMs).toBeUndefined();
    handle?.uninstall();
  });

  it("groups every tool kind while keeping an incompatible settled edit native", () => {
    const write = tool("write", { path: "a.txt", content: "hidden" }, result());
    const bash = tool("bash", { command: "npm test" }, result());
    const powershell = tool("powershell", { command: "Get-ChildItem" }, result());
    const custom = tool("custom-tool", { target: "src" }, result());
    const edit = tool("edit", { path: "a.txt" }, result());
    const failedCustom = tool("mcp.lookup", { id: 42 }, result(true));
    const renderGroup = vi.fn((group: { kind: string; rows: readonly ToolRowSnapshot[] }) => [
      `${group.kind} ${group.rows.length}`,
    ]);
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup });

    expect(container(write, bash, powershell, custom, edit, failedCustom).render(80)).toEqual([
      "write 1",
      "command 2",
      "tool 1",
      "native edit",
      "tool 1",
    ]);
    expect(renderGroup.mock.calls.map(([group]) => [group.kind, group.rows.length])).toEqual([
      ["write", 1],
      ["command", 2],
      ["tool", 1],
      ["tool", 1],
    ]);
    expect(renderGroup.mock.calls[3]?.[0].rows[0]?.errorSummary).toBe("output");
    expect(edit.render).toHaveBeenCalledOnce();
    expect(failedCustom.render).not.toHaveBeenCalled();
    expect(write.render).not.toHaveBeenCalled();
    expect(bash.render).not.toHaveBeenCalled();
    expect(powershell.render).not.toHaveBeenCalled();
    expect(custom.render).not.toHaveBeenCalled();
    handle?.uninstall();
  });

  it("groups failures with only a useful bounded error line", () => {
    const failed = tool(
      "bash",
      { command: "npm run check" },
      {
        content: [
          { type: "text", text: "many earlier output\n\nDuration 488ms\n\nCommand exited with code 1" },
          { type: "image", data: "must not be copied", mimeType: "image/png" },
        ],
        details: { fullOutput: "must not be copied" },
        isError: true,
      },
    );
    const noText = tool(
      "custom-tool",
      { target: "src" },
      { content: [{ type: "image", data: "x", mimeType: "image/png" }], details: { secret: true }, isError: true },
    );
    const long = tool("bash", { command: "long" }, {
      content: [{ type: "text", text: "x".repeat(600) }],
      details: { secret: true },
      isError: true,
    });
    const snapshots: Array<{ kind: string; rows: readonly ToolRowSnapshot[] }> = [];
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: (group) => {
        snapshots.push(group);
        return ["group"];
      },
    });

    expect(container(failed, noText, long).render(80)).toEqual(["group", "group", "group"]);
    expect(snapshots[0]?.rows[0]?.errorSummary).toBe("Command exited with code 1");
    expect(snapshots[0]?.rows[0]?.result).toEqual({ content: [], isError: true });
    expect(snapshots[1]?.rows[0]?.errorSummary).toBeUndefined();
    expect(snapshots[1]?.rows[0]?.result).toEqual({ content: [], isError: true });
    expect(snapshots[2]?.rows[0]?.errorSummary).toHaveLength(512);
    for (const row of [failed, noText, long]) expect(row.render).not.toHaveBeenCalled();
    handle?.uninstall();
  });

  it("chooses a useful diagnostic instead of a trailing structural line", () => {
    const validationFailure = tool("edit", { path: "test/tui-preview.test.ts" }, {
      content: [{
        type: "text",
        text: [
          'Validation failed for tool "edit":',
          "  - edits: must have required properties edits",
          "",
          "Received arguments:",
          "{",
          '  "path": "test/tui-preview.test.ts",',
          '  "offset": 60,',
          '  "limit": 16',
          "}",
        ].join("\n"),
      }],
      details: {},
      isError: true,
    });
    const structuralOnly = tool("bash", { command: "invalid" }, {
      content: [{ type: "text", text: "{\n}" }],
      details: {},
      isError: true,
    });
    const snapshots: Array<{ rows: readonly ToolRowSnapshot[] }> = [];
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: (group) => {
        snapshots.push(group);
        return ["group"];
      },
    });

    expect(container(validationFailure, structuralOnly).render(80)).toEqual(["group", "group"]);
    expect(snapshots[0]?.rows[0]?.errorSummary).toBe("edits: must have required properties edits");
    expect(snapshots[1]?.rows[0]?.errorSummary).toBeUndefined();
    handle?.uninstall();
  });

  it("groups running and settled edits with minimal snapshots", () => {
    const first = tool(
      "edit",
      { path: "a.ts", edits: [{ oldText: "old", newText: "new" }, { oldText: "x", newText: "y" }] },
      result(),
    );
    const second = tool(
      "edit",
      { path: "b.ts", edits: [{ oldText: "before", newText: "after" }] },
      result(),
    );
    const running = tool("edit", { path: "running.ts", edits: [{ oldText: "a", newText: "b" }] });
    const failed = tool(
      "edit",
      { path: "failed.ts", edits: [{ oldText: "a", newText: "b" }] },
      result(true),
    );
    const malformed = tool("edit", { path: "malformed.ts", edits: [{ oldText: "a" }] }, result());
    const snapshots: Array<{ kind: string; rows: readonly ToolRowSnapshot[] }> = [];
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: (group) => {
        snapshots.push(group);
        return [`${group.kind} ${group.rows.length}`];
      },
    });

    expect(container(first, second, running, failed, malformed).render(80)).toEqual([
      "edit 4",
      "native edit",
    ]);
    expect(snapshots[0]?.kind).toBe("edit");
    expect(snapshots[0]?.rows[0]?.args).toEqual({ path: "a.ts", replacementCount: 2 });
    expect(snapshots[0]?.rows[0]?.result).toEqual({ content: [], isError: false });
    expect(snapshots[0]?.rows[2]?.args).toEqual({ path: "running.ts" });
    expect(snapshots[0]?.rows[2]?.result).toBeUndefined();
    expect(snapshots[0]?.rows[2]?.isPartial).toBe(true);
    expect(snapshots[0]?.rows[3]?.args).toEqual({ path: "failed.ts", replacementCount: 1 });
    expect(snapshots[0]?.rows[3]?.errorSummary).toBe("output");
    expect(first.render).not.toHaveBeenCalled();
    expect(second.render).not.toHaveBeenCalled();
    expect(running.render).not.toHaveBeenCalled();
    expect(failed.render).not.toHaveBeenCalled();
    expect(malformed.render).toHaveBeenCalledOnce();
    handle?.uninstall();
  });

  it("groups singleton, image, and failed rows while preserving expanded rows natively", () => {
    const single = tool("read");
    const expandedA = tool("read", { path: "a" }, result(), true);
    const expandedB = tool("read", { path: "b" }, result(), true);
    const failedA = tool("read", { path: "a" }, result(true));
    const failedB = tool("read", { path: "b" }, result(true));
    const imageA = tool("read", { path: "a" }, result(false, [{ type: "image", data: "x", mimeType: "image/png" }]));
    const imageB = tool("read", { path: "b" }, result(false, [{ type: "image", data: "y", mimeType: "image/png" }]));

    const singletonHandle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["group"] });
    expect(container(single).render(80)).toEqual(["group"]);
    expect(single.render).not.toHaveBeenCalled();
    singletonHandle?.uninstall();

    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["group"] });
    expect(container(expandedA, expandedB).render(80)).toEqual(["native read", "native read"]);
    expect(container(failedA, failedB).render(80)).toEqual(["group"]);
    expect(container(imageA, imageB).render(80)).toEqual(["group"]);
    for (const row of [expandedA, expandedB]) {
      expect(row.render).toHaveBeenCalledOnce();
    }
    for (const row of [failedA, failedB, imageA, imageB]) {
      expect(row.render).not.toHaveBeenCalled();
    }
    expect(imageA.render).not.toHaveBeenCalled();
    expect(imageB.render).not.toHaveBeenCalled();
    handle?.uninstall();
  });

  it("restores a scene after Pi's expansion status split its direct children", () => {
    const owner = storyboardAssistant(["thinking"], ["restore-read"]);
    const row = tool("read", { path: "restore.ts" }, result(), true);
    assignToolCallId(row, "restore-read");
    const [statusSpacer, statusText] = expansionStatusRows("expanded");
    const session: SessionProjection = {
      leafId: "result",
      turns: [{
        entryId: "assistant",
        toolCallIds: ["restore-read"],
        resultEntryIds: ["result"],
        hasVisibleThinking: true,
        hasCommentary: false,
        hasFinalAnswer: false,
        hasUnknownText: false,
        valid: true,
        boundaryBefore: false,
        boundaryAfter: false,
      }],
    };
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSessionProjection: () => session,
      renderGroup: () => ["", " restored group"],
    });
    const value = container(owner, statusSpacer, statusText, row);

    expect(value.render(80)).toContain("native read");
    (row as unknown as Record<string, unknown>).expanded = false;
    statusText.text = "Tool output: collapsed";
    statusText.render = vi.fn(() => [" status collapsed"]);

    const restored = value.render(80).join("\\n");
    expect(restored).toContain("restored group");
    expect(restored).not.toContain("native read");
    expect(restored).toContain("status collapsed");
    expect(statusText.render).toHaveBeenCalled();
    handle?.uninstall();
  });

  it("bridges Pi's session-info status pair without losing storyboard ownership", () => {
    const owner = storyboardAssistant(["thinking"], ["session-info-read"]);
    const row = tool("read", { path: "session-info.ts" }, result());
    assignToolCallId(row, "session-info-read");
    const [statusSpacer, statusText] = sessionInfoStatusRows();
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      getSessionProjection: () => ({
        leafId: "result",
        turns: [{
          entryId: "assistant",
          toolCallIds: ["session-info-read"],
          resultEntryIds: ["result"],
          hasVisibleThinking: true,
          hasCommentary: false,
          hasFinalAnswer: false,
          hasUnknownText: false,
          valid: true,
          boundaryBefore: false,
          boundaryAfter: false,
        }],
      }),
      renderGroup: () => ["", " Read 1 file"],
    });

    const output = container(owner, statusSpacer, statusText, row).render(80).join("\\n");
    expect(output).toContain("◉");
    expect(output).toContain("Read 1 file");
    expect(output).toContain("session info");
    expect(row.render).not.toHaveBeenCalled();
    handle?.uninstall();
  });

  it("does not leave storyboard thinking markers during native expansion", () => {
    const owner = assistant(["", " thinking", "", " answer"]);
    const ownerFields = owner as unknown as Record<string, unknown>;
    ownerFields.lastMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "work" },
        {
          type: "text",
          text: "answer",
          textSignature: JSON.stringify({ v: 1, id: "native-expansion", phase: "final_answer" }),
        },
      ],
      stopReason: "stop",
    };
    ownerFields.isStreaming = false;
    const leadingSpacer = { render: vi.fn(() => [""]) };
    const thinking = { render: vi.fn(() => [" thinking"]) };
    const betweenSpacer = { render: vi.fn(() => [""]) };
    const answer = { render: vi.fn(() => [" answer"]) };
    ownerFields.contentContainer = {
      children: [leadingSpacer, thinking, betweenSpacer, answer],
      mouseLayout: {
        width: 80,
        children: [
          { component: leadingSpacer, height: 1 },
          { component: thinking, height: 1 },
          { component: betweenSpacer, height: 1 },
          { component: answer, height: 1 },
        ],
      },
    };
    const expandedTool = tool("read", { path: "expanded.ts" }, result(), true);
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["bad"] });
    const value = container(owner, expandedTool);

    const native = value.render(80).join("\\n");
    expect(native).toContain(" thinking");
    expect(native).not.toContain("○");

    (expandedTool as unknown as Record<string, unknown>).expanded = false;
    const collapsed = value.render(80).join("\\n");
    expect(collapsed).toContain("○");
    handle?.uninstall();
  });

  it("treats an invisible assistant as skippable but a visible one as a boundary", () => {
    const hidden = assistant([]);
    const first = tool("read");
    const second = tool("read");
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["group"] });

    expect(container(first, hidden, second).render(80)).toEqual(["group"]);
    expect(hidden.render).toHaveBeenCalledOnce();
    expect(first.render).not.toHaveBeenCalled();
    expect(second.render).not.toHaveBeenCalled();
    handle?.uninstall();

    const visible = assistant(["assistant text"]);
    const third = tool("read");
    const fourth = tool("read");
    const secondHandle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["bad"] });
    expect(container(third, visible, fourth).render(80)).toEqual([
      "bad",
      "assistant text",
      "bad",
    ]);
    expect(visible.render).toHaveBeenCalledOnce();
    expect(third.render).not.toHaveBeenCalled();
    expect(fourth.render).not.toHaveBeenCalled();
    secondHandle?.uninstall();
  });

  it("keeps mouse coordinates aligned with grouped output", () => {
    const first = tool("read", { path: "a.ts" }, result());
    const second = tool("read", { path: "b.ts" }, result());
    const following = {
      render: vi.fn(() => ["following"]),
      handleMouse: vi.fn(() => ({ handled: true })),
    };
    const value = container(first, second, following);
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["group"] });

    expect(value.render(80)).toEqual(["group", "following"]);
    value.handleMouse?.({
      type: "click",
      button: "left",
      x: 0,
      y: 1,
      screenX: 0,
      screenY: 1,
      width: 80,
      height: 2,
      shift: false,
      alt: false,
      ctrl: false,
    } satisfies TuiMouseEvent);
    expect(following.handleMouse).toHaveBeenCalledOnce();
    handle?.uninstall();
  });

  it("falls back to the original container on renderer failure", () => {
    const first = tool("read");
    const second = tool("read");
    const renderGroup = vi.fn(() => {
      throw new Error("incompatible renderer");
    });
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup });

    expect(container(first, second).render(80)).toEqual(["native read", "native read"]);
    expect(first.render).toHaveBeenCalledOnce();
    expect(second.render).toHaveBeenCalledOnce();
    handle?.uninstall();
  });

  it("does not use the patch for containers without tool rows", () => {
    const child = { render: vi.fn(() => ["ordinary"]) };
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["bad"] });
    expect(container(child).render(80)).toEqual(["ordinary"]);
    expect(child.render).toHaveBeenCalledOnce();
    handle?.uninstall();
  });

  it("counts owners and restores the exact original method", () => {
    const originalMethod = Container.prototype.render;
    const first = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["group"] });
    const second = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["group"] });
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(Container.prototype.render).not.toBe(originalMethod);

    first?.uninstall();
    expect(Container.prototype.render).not.toBe(originalMethod);
    second?.uninstall();
    expect(Container.prototype.render).toBe(originalMethod);
    second?.uninstall();
  });

  it("does not overwrite a wrapper installed after this adapter", () => {
    const originalMethod = Container.prototype.render;
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["bad"] });
    const later = vi.fn(function (this: Container, width: number) {
      return originalMethod.call(this, width);
    });
    Container.prototype.render = later;
    handle?.uninstall();
    expect(Container.prototype.render).toBe(later);
    Container.prototype.render = originalMethod;
  });

  it("rejects malformed private row state", () => {
    const malformed = tool("read");
    delete (malformed as unknown as Record<string, unknown>).expanded;
    expect(classifyToolRowForTesting(malformed)).toBeUndefined();
    const handle = installToolGroupingPatch({ getTheme: () => theme, renderGroup: () => ["bad"] });
    expect(container(malformed, tool("read")).render(80)).toEqual(["native read", "bad"]);
    handle?.uninstall();
  });

  it("passes an immutable copy of row data to the group renderer", () => {
    const args = { path: "original.ts", nested: { value: 1 } };
    const first = tool("read", args);
    const second = tool("read", { path: "second.ts" });
    let snapshot: ToolRowSnapshot | undefined;
    const handle = installToolGroupingPatch({
      getTheme: () => theme,
      renderGroup: (group) => {
        snapshot = group.rows[0];
        return ["group"];
      },
    });
    expect(container(first, second).render(80)).toEqual(["group"]);
    expect(snapshot && Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot && Object.isFrozen(snapshot.args)).toBe(true);
    expect(args).toEqual({ path: "original.ts", nested: { value: 1 } });
    handle?.uninstall();
  });
});
