import { beforeEach, describe, expect, it, vi } from "vitest";
import { AssistantMessageComponent, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container, type TuiMouseEvent } from "@earendil-works/pi-tui";
import {
  classifyToolRowForTesting,
  installToolGroupingPatch,
  PATCH_MARKER,
} from "../src/pi-adapter.ts";
import type { ThemeLike, ToolRowSnapshot } from "../src/renderer.ts";

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
    expect(lines.join("\\n")).toContain("2 actions");
    expect(renderGroup.mock.calls.map(([group]) => group.kind)).toEqual(["read", "command"]);
    expect(owner.render).toHaveBeenCalledOnce();
    expect(read.render).not.toHaveBeenCalled();
    expect(bash.render).not.toHaveBeenCalled();
    expect(following.render).toHaveBeenCalledOnce();
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

  it("groups failures with only the last bounded error line", () => {
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
