import {
  AssistantMessageComponent,
  createBashToolDefinition,
  createEditToolDefinition,
  ToolExecutionComponent,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { Container, Text, type TUI } from "@earendil-works/pi-tui";

type FixtureToolCall = {
  readonly id: string;
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly result: FixtureToolResult;
};

type FixtureToolResult = {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly isError: boolean;
};

type FixtureContent =
  | { readonly type: "thinking"; readonly thinking: string; readonly thinkingSignature?: string; readonly redacted?: boolean }
  | { readonly type: "tool"; readonly call: FixtureToolCall }
  | { readonly type: "text"; readonly text: string; readonly phase?: "commentary" | "final_answer" };

type FixtureAssistant = {
  readonly thinking: readonly string[];
  readonly calls: readonly FixtureToolCall[];
  readonly stopReason: string;
  readonly content?: readonly FixtureContent[];
};

type FixtureAssistantMessage = NonNullable<ConstructorParameters<typeof AssistantMessageComponent>[0]>;
type FixtureToolDefinition = ConstructorParameters<typeof ToolExecutionComponent>[4];
type FixtureToolResultInput = Parameters<ToolExecutionComponent["updateResult"]>[0];

const EMPTY_RESULT: FixtureToolResult = Object.freeze({
  content: Object.freeze([]),
  isError: false,
});

function fixtureAssistantMessage(scene: FixtureAssistant): FixtureAssistantMessage {
  const sourceContent: readonly FixtureContent[] = scene.content ?? [
    ...scene.thinking.map((thinking) => ({ type: "thinking" as const, thinking })),
    ...scene.calls.map((call) => ({ type: "tool" as const, call })),
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
                  id: `fixture-${content.phase}`,
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
  } as unknown as FixtureAssistantMessage;
}

function fixtureToolResult(result: FixtureToolResult): FixtureToolResultInput {
  return {
    content: result.content.map((block) => ({ ...block })),
    isError: result.isError,
  };
}

function fixtureToolDefinition(call: FixtureToolCall, cwd: string): FixtureToolDefinition {
  // These factories only create definitions; their execute functions are never
  // called. Passing them to the real component keeps native expansion available.
  if (call.name === "bash") return createBashToolDefinition(cwd);
  if (call.name === "edit") return createEditToolDefinition(cwd);
  return undefined;
}

/**
 * Fixed test fixture for four no-thinking responses. It constructs native
 * components and public entry data only; it never reads a session or executes a tool.
 */
export function createNoThinkingTranscriptFixture(tui: TUI, cwd: string): {
  transcript: Container;
  entries: readonly SessionEntry[];
  leafId: string;
  assistants: readonly AssistantMessageComponent[];
  tools: readonly ToolExecutionComponent[];
  messages: readonly FixtureAssistantMessage[];
} {
  const call = (id: string, name: string, args: Record<string, unknown>): FixtureToolCall => ({
    id, name, args, result: EMPTY_RESULT,
  });
  const batches: readonly (readonly FixtureToolCall[])[] = [
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
  const messages: FixtureAssistantMessage[] = [];
  let parentId: string | null = null;
  const append = (entry: Record<string, unknown>): void => {
    entries.push({ ...entry, parentId, timestamp: "2026-01-01T00:00:00Z" } as unknown as SessionEntry);
    parentId = entry.id as string;
  };
  append({ type: "message", id: "incident-user", message: { role: "user", content: "Proceed with the fixture.", timestamp: 0 } });
  transcript.addChild(new Text("Proceed with the fixture.", 1, 0));
  for (let index = 0; index < batches.length; index++) {
    const calls = batches[index]!;
    const content: FixtureContent[] = [
      ...(index === 2 ? [{ type: "thinking" as const, thinking: "", thinkingSignature: "synthetic-opaque-signature" }] : []),
      ...calls.map((toolCall) => ({ type: "tool" as const, call: toolCall })),
    ];
    const message = fixtureAssistantMessage({ thinking: [], calls, content, stopReason: "toolUse" });
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
        fixtureToolDefinition(toolCall, cwd), tui, cwd);
      tool.markExecutionStarted();
      tool.setArgsComplete();
      transcript.addChild(tool);
      tools.push(tool);
      return { tool, toolCall };
    });
    // Parallel completions intentionally differ from declared source order.
    for (const { tool, toolCall } of [...batchTools].reverse()) {
      tool.updateResult(fixtureToolResult(toolCall.result));
      append({ type: "message", id: `incident-result-${toolCall.id}`, message: {
        role: "toolResult", toolCallId: toolCall.id, toolName: toolCall.name,
        content: [], isError: false, timestamp: 0,
      } });
    }
  }
  return { transcript, entries: Object.freeze(entries), leafId: parentId!,
    assistants: Object.freeze(assistants), tools: Object.freeze(tools), messages: Object.freeze(messages) };
}
