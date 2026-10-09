import {
  AssistantMessageComponent,
  createBashToolDefinition,
  createEditToolDefinition,
  ToolExecutionComponent,
  type Theme,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
  Key,
  Container,
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

/**
 * A deliberately small, checked-in fixture extracted from the supplied
 * session's final visible tail. It is data for the preview only: the live
 * extension never reads a session file.
 */
type ReplayToolCall = {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly result: ReplayToolResult;
};

type ReplayToolResult = {
  readonly content: readonly ReplayContentBlock[];
  readonly isError: boolean;
};

type ReplayContentBlock = {
  readonly type: string;
  readonly text?: string;
  readonly data?: string;
  readonly mimeType?: string;
};

type ReplayContent =
  | { readonly type: "thinking"; readonly thinking: string; readonly thinkingSignature?: string; readonly redacted?: boolean }
  | { readonly type: "tool"; readonly call: ReplayToolCall }
  | {
      readonly type: "text";
      readonly text: string;
      readonly phase?: "commentary" | "final_answer";
    };

type ReplayAssistant = {
  readonly thinking: readonly string[];
  readonly text?: string;
  readonly textPhase?: "commentary" | "final_answer";
  readonly calls: readonly ReplayToolCall[];
  readonly stopReason: string;
  /** Optional source-order fixture for the interleaving seam. */
  readonly content?: readonly ReplayContent[];
};

type ReplayAssistantMessage = NonNullable<ConstructorParameters<typeof AssistantMessageComponent>[0]>;
type ReplayToolDefinition = ConstructorParameters<typeof ToolExecutionComponent>[4];
type ReplayToolResultInput = Parameters<ToolExecutionComponent["updateResult"]>[0];

const EMPTY_RESULT: ReplayToolResult = Object.freeze({
  content: Object.freeze([]),
  isError: false,
});

const FAILED_CHECK_RESULT: ReplayToolResult = Object.freeze({
  content: Object.freeze([
    Object.freeze({
      type: "text",
      text: "many earlier output\n\nCommand exited with code 1",
    }),
  ]),
  isError: true,
});

const TRANSCRIPT_TAIL: readonly ReplayAssistant[] = Object.freeze([
  {
    // Transcript JSONL entry 496: several thinking paragraphs are stored in
    // one assistant message; Pi renders their consecutive thinking content as
    // one native assistant component before the following tool row.
    thinking: Object.freeze([
      "**Planning detailed width rendering tests**\n\n**Analyzing user rendering issue with long lines**\n\n**Confirming separate diagnostic wrapping with ANSI widths**",
      "**Fixing separate diagnostic rendering and width checks**",
    ]),
    calls: Object.freeze([
      {
        id: "replay-496-bash",
        name: "bash",
        args: Object.freeze({ command: "npm run check", timeout: 120 }),
        result: FAILED_CHECK_RESULT,
      },
    ]),
    stopReason: "toolUse",
  },
  {
    // Transcript JSONL entry 498.
    thinking: Object.freeze(["**Inspecting formatRow replacement failure**"]),
    calls: Object.freeze([
      {
        id: "replay-498-edit",
        name: "edit",
        args: Object.freeze({
          path: "/Users/fong/Documents/FHY/pi-storyboard/src/renderer.ts",
          edits: Object.freeze([{ oldText: "old", newText: "new" }]),
        }),
        result: EMPTY_RESULT,
      },
    ]),
    stopReason: "toolUse",
  },
  {
    // Transcript JSONL entry 500.
    thinking: Object.freeze(["**Running test suite**"]),
    calls: Object.freeze([
      {
        id: "replay-500-bash",
        name: "bash",
        args: Object.freeze({ command: "npm run check" }),
        result: EMPTY_RESULT,
      },
    ]),
    stopReason: "toolUse",
  },
  {
    // Transcript JSONL entry 502.
    thinking: Object.freeze(["**Checking ripgrep em dash handling**"]),
    calls: Object.freeze([
      {
        id: "replay-502-bash",
        name: "bash",
        args: Object.freeze({
          command: "rg -n 'appendWrappedLine|mainTrim|trimming' src/renderer.ts README.md docs/ARCHITECTURE.md test/renderer.test.ts | head -80",
          timeout: 10,
        }),
        result: EMPTY_RESULT,
      },
    ]),
    stopReason: "toolUse",
  },
  {
    // A validated OpenAI Responses commentary block is user-visible native
    // Markdown, not a short scene title. It remains complete on the turn rail
    // before the tool run.
    thinking: Object.freeze(["**Locating exact types source files**"]),
    calls: Object.freeze([
      {
        id: "replay-commentary-bash",
        name: "bash",
        args: Object.freeze({ command: "rg -n 'TextContent|final_answer' node_modules" }),
        result: EMPTY_RESULT,
      },
    ]),
    content: Object.freeze([
      { type: "thinking" as const, thinking: "**Locating exact types source files**" },
      {
        type: "text" as const,
        text: "I’ll separate what Pi’s documented schema proves from what it does not prove, and inspect the canonical type/source definitions before making the claim.",
        phase: "commentary" as const,
      },
      { type: "tool" as const, call: {
        id: "replay-commentary-bash",
        name: "bash",
        args: Object.freeze({ command: "rg -n 'TextContent|final_answer' node_modules" }),
        result: EMPTY_RESULT,
      } },
    ]),
    stopReason: "toolUse",
  },
  {
    // Transcript JSONL entry 504. This is a mixed thinking + final-text
    // assistant message, not a thinking-only storyboard turn.
    thinking: Object.freeze([
      "**Clarifying diagnostic layout and error formatting**\n\n**Planning final package check**",
    ]),
    text: "Fixed.\n\nFailed rows now place the bounded diagnostic on a separate indented line:\n\n```text\n● npm run check\n  Command exited with code 1\n```\n\nOnly path/filename and command values use trim modes; metadata and diagnostics wrap without shortening.\n\nValidation: **126 tests passed.**",
    textPhase: "final_answer",
    calls: Object.freeze([]),
    stopReason: "stop",
  },
  {
    // Presentation-only seam fixture: Pi's assistant content interleaves a
    // native thinking run between two tool calls, while the native transcript
    // still appends both tool components after the assistant row.
    thinking: Object.freeze([]),
    calls: Object.freeze([
      {
        id: "replay-interleaved-edit",
        name: "edit",
        args: Object.freeze({
          path: "src/renderer.ts",
          edits: Object.freeze([{ oldText: "old", newText: "new" }]),
        }),
        result: EMPTY_RESULT,
      },
      {
        id: "replay-interleaved-read",
        name: "read",
        args: Object.freeze({ path: "src/renderer.ts" }),
        result: EMPTY_RESULT,
      },
    ]),
    content: Object.freeze([
      { type: "thinking" as const, thinking: "**Inspecting the existing row shape**" },
      { type: "tool" as const, call: {
        id: "replay-interleaved-read",
        name: "read",
        args: Object.freeze({ path: "src/renderer.ts" }),
        result: EMPTY_RESULT,
      } },
      {
        type: "text" as const,
        text: "The existing row confirms **native commentary** can remain between action runs.",
        phase: "commentary" as const,
      },
      { type: "thinking" as const, thinking: "**Applying the settled replacement**" },
      { type: "tool" as const, call: {
        id: "replay-interleaved-edit",
        name: "edit",
        args: Object.freeze({
          path: "src/renderer.ts",
          edits: Object.freeze([{ oldText: "old", newText: "new" }]),
        }),
        result: EMPTY_RESULT,
      } },
    ]),
    stopReason: "toolUse",
  },
]);

function replayAssistantMessage(scene: ReplayAssistant): ReplayAssistantMessage {
  const sourceContent: readonly ReplayContent[] = scene.content ?? [
    ...scene.thinking.map((thinking) => ({ type: "thinking" as const, thinking })),
    ...scene.calls.map((call) => ({ type: "tool" as const, call })),
    ...(scene.text === undefined
      ? []
      : [{ type: "text" as const, text: scene.text, phase: scene.textPhase }]),
  ];
  return {
    role: "assistant",
    content: sourceContent.map((content) => {
      if (content.type === "thinking") return { ...content };
      if (content.type === "text") {
        return {
          type: "text",
          text: content.text,
          ...(content.phase === undefined
            ? {}
            : {
                textSignature: JSON.stringify({
                  v: 1,
                  id: `replay-${content.phase}`,
                  phase: content.phase,
                }),
              }),
        };
      }
      return {
        type: "toolCall",
        id: content.call.id,
        name: content.call.name,
        arguments: content.call.args,
      };
    }),
    stopReason: scene.stopReason,
    api: "fixture", provider: "fixture", model: "fixture",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    timestamp: 0,
  } as unknown as ReplayAssistantMessage;
}

function replayToolResult(result: ReplayToolResult): ReplayToolResultInput {
  return {
    content: result.content.map((block) => ({ ...block })),
    isError: result.isError,
  };
}

function replayToolDefinition(call: ReplayToolCall, cwd: string): ReplayToolDefinition {
  // These factories only create definitions; their execute functions are never
  // called. Passing them to the real component also keeps native fallback and
  // expansion behavior available for this diagnostic.
  if (call.name === "bash") return createBashToolDefinition(cwd);
  if (call.name === "edit") return createEditToolDefinition(cwd);
  return undefined;
}

function createNativeTranscript(tui: TUI, cwd: string): Container {
  const transcript = new Container();
  for (const scene of TRANSCRIPT_TAIL) {
    transcript.addChild(new AssistantMessageComponent(replayAssistantMessage(scene)));
    for (const call of scene.calls) {
      const tool = new ToolExecutionComponent(
        call.name,
        call.id,
        call.args,
        undefined,
        replayToolDefinition(call, cwd),
        tui,
        cwd,
      );
      // These are state updates, not execution. They put each real Pi tool
      // component into the same settled state as the recorded transcript.
      tool.markExecutionStarted();
      tool.setArgsComplete();
      tool.updateResult(replayToolResult(call.result));
      transcript.addChild(tool);
    }
  }
  const incident = createNoThinkingTranscriptReplay(tui, cwd);
  for (const child of incident.transcript.children) transcript.addChild(child);
  return transcript;
}

/**
 * Fixed synthetic reproduction of the four no-thinking incident responses.
 * This constructs native components and public entry data only; it never
 * reads a session, executes a tool, or inspects private Pi component fields.
 */
export function createNoThinkingTranscriptReplay(tui: TUI, cwd: string): {
  transcript: Container;
  entries: readonly SessionEntry[];
  leafId: string;
  assistants: readonly AssistantMessageComponent[];
  tools: readonly ToolExecutionComponent[];
  messages: readonly ReplayAssistantMessage[];
} {
  const call = (id: string, name: string, args: Record<string, unknown>): ReplayToolCall => ({
    id, name, args, result: EMPTY_RESULT,
  });
  const batches: readonly (readonly ReplayToolCall[])[] = [
    [call("call-a1", "read", { path: "fixture/a.ts" }), call("call-a2", "read", { path: "fixture/b.ts" }),
      call("call-a3", "bash", { command: "fixture-command" }), call("call-a4", "web_enable", {})],
    [call("call-b1", "fetch_content", { urls: ["https://example.invalid/fixture"], mode: "readable" }),
      call("call-b2", "bash", { command: "fixture-command" })],
    [call("call-c1", "bash", { command: "fixture-command" })],
    [call("call-d1", "read", { path: "fixture/c.ts" }), call("call-d2", "read", { path: "fixture/d.ts" }),
      call("call-d3", "get_search_content", { responseId: "fixture", urlIndex: 0, offset: 0, limit: 100 }),
      call("call-d4", "fetch_content", { url: "https://example.invalid/fixture", mode: "readable" })],
  ];
  const transcript = new Container();
  const entries: SessionEntry[] = [];
  const assistants: AssistantMessageComponent[] = [];
  const tools: ToolExecutionComponent[] = [];
  const messages: ReplayAssistantMessage[] = [];
  let parentId: string | null = null;
  const append = (entry: Record<string, unknown>): void => {
    entries.push({ ...entry, parentId, timestamp: "2026-01-01T00:00:00Z" } as unknown as SessionEntry);
    parentId = entry.id as string;
  };
  append({ type: "message", id: "incident-user", message: { role: "user", content: "Proceed with the fixture.", timestamp: 0 } });
  transcript.addChild(new Text("Proceed with the fixture.", 1, 0));
  for (let index = 0; index < batches.length; index++) {
    const calls = batches[index]!;
    const content: ReplayContent[] = [
      ...(index === 2 ? [{ type: "thinking" as const, thinking: "", thinkingSignature: "synthetic-opaque-signature" }] : []),
      ...calls.map((toolCall) => ({ type: "tool" as const, call: toolCall })),
    ];
    const message = replayAssistantMessage({ thinking: [], calls, content, stopReason: "toolUse" });
    messages.push(message);
    const assistant = new AssistantMessageComponent(message);
    assistants.push(assistant);
    transcript.addChild(assistant);
    append({ type: "message", id: `incident-assistant-${index}`, message });
    if (index === 1 || index === 3) {
      // Hidden custom state has no native transcript child. If a host renders
      // a visible custom row instead, the adapter's usual boundary rules win.
      append({ type: "custom", id: `incident-state-${index}`, customType: "web-search-results", data: {} });
    }
    const batchTools = calls.map((toolCall) => {
      const tool = new ToolExecutionComponent(toolCall.name, toolCall.id, toolCall.args, undefined,
        replayToolDefinition(toolCall, cwd), tui, cwd);
      tool.markExecutionStarted();
      tool.setArgsComplete();
      transcript.addChild(tool);
      tools.push(tool);
      return { tool, toolCall };
    });
    // Parallel completions intentionally differ from declared source order.
    for (const { tool, toolCall } of [...batchTools].reverse()) {
      tool.updateResult(replayToolResult(toolCall.result));
      append({ type: "message", id: `incident-result-${toolCall.id}`, message: {
        role: "toolResult", toolCallId: toolCall.id, toolName: toolCall.name,
        content: [], isError: false, timestamp: 0,
      } });
    }
  }
  return { transcript, entries: Object.freeze(entries), leafId: parentId!,
    assistants: Object.freeze(assistants), tools: Object.freeze(tools), messages: Object.freeze(messages) };
}

function fit(line: string, width: number): string {
  const safeWidth = Math.max(1, Math.floor(width));
  return visibleWidth(line) <= safeWidth ? line : truncateToWidth(line, safeWidth, "");
}

/**
 * Replay the selected transcript tail with Pi's actual assistant/tool
 * components. The contained Container is intentionally allowed to pass
 * through the installed turn-storyboard patch, so this is a live-render seam test
 * rather than a second approximation of the renderer.
 */
export class TranscriptReplay implements Component {
  private readonly transcript: Container;
  private scrollOffset = 0;

  constructor(
    private readonly tui: TUI,
    private readonly cwd: string,
    private readonly theme: Theme,
  ) {
    this.transcript = createNativeTranscript(tui, cwd);
  }

  private viewportRows(): number {
    return Math.max(4, (this.tui.terminal.rows || 24) - 6);
  }

  private visibleWindow(allLines: readonly string[], width: number): { lines: string[]; showScroll: boolean } {
    const viewportRows = this.viewportRows();
    const showScroll = allLines.length > viewportRows;
    const contentRows = Math.max(1, viewportRows - (showScroll ? 1 : 0));
    const maxOffset = Math.max(0, allLines.length - contentRows);
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));
    const lines = allLines.slice(this.scrollOffset, this.scrollOffset + contentRows);
    if (showScroll) {
      const end = Math.min(allLines.length, this.scrollOffset + contentRows);
      lines.push(fit(this.theme.fg("dim", `↕ scroll ${this.scrollOffset + 1}-${end}/${allLines.length}`), width));
    }
    return { lines, showScroll };
  }

  handleInput(data: string): void {
    const step = Math.max(1, (this.tui.terminal.rows || 24) - 8);
    if (matchesKey(data, Key.up)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
    } else if (matchesKey(data, Key.down)) {
      this.scrollOffset += 1;
    } else if (matchesKey(data, Key.pageUp)) {
      this.scrollOffset = Math.max(0, this.scrollOffset - step);
    } else if (matchesKey(data, Key.pageDown)) {
      this.scrollOffset += step;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, Math.floor(width));
    const allLines = this.transcript.render(safeWidth);
    return this.visibleWindow(allLines, safeWidth).lines;
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
    // The transcript container has the same native mouse layout that the live
    // patch uses. Translate the visible viewport back to its full transcript
    // coordinates before dispatching to the real child components.
    const allLines = this.transcript.render(Math.max(1, Math.floor(event.width)));
    const viewportRows = this.viewportRows();
    const showScroll = allLines.length > viewportRows;
    const contentRows = Math.max(1, viewportRows - (showScroll ? 1 : 0));
    if (event.y < 0 || event.y >= contentRows) return { handled: true };
    return this.transcript.handleMouse?.({
      ...event,
      y: event.y + this.scrollOffset,
      height: allLines.length,
    });
  }

  invalidate(): void {
    this.transcript.invalidate();
  }
}