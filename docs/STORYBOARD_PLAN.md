# Plan: thinking-led turn storyboard

> Status: **implemented.** This restores the clearer branch hierarchy without reintroducing a persisted or synthetic “master” object. The extension remains a presentation-only TUI projection and does not modify Pi's agent, messages, tools, context, or session pipeline.

## 1. Documented Pi boundary

Pi distinguishes a low-level agent run from its turns:

```text
agent_start
│
├─ turn_start
│  ├─ one streamed assistant response
│  ├─ its tool executions/results
│  └─ turn_end(message, toolResults)
│
├─ turn_start                 repeated while the model calls tools
│  └─ ...
│
└─ agent_end
```

Pi's extension documentation defines a turn as **“one LLM response + tool calls.”** The installed agent-core telemetry describes the same unit as **“One assistant response and its tool batch.”**

One settled `AssistantMessage` contains the authoritative source sequence:

```ts
AssistantMessage.content = [
  ThinkingContent,
  TextContent,
  ToolCall,
];
```

Tool results are separate messages/components joined by `toolCallId`. Pi's session JSONL does not persist a `master`, visual story node, or turn wrapper around those entries.

The extension therefore renders one validated assistant response and its exactly matched tool rows as a **visual turn block**. The block is a projection of Pi's documented turn boundary, not a new Pi record. A later assistant response starts the next block; consecutive blocks form the ongoing visual storyboard for the request.

The current render-only seam does not receive lifecycle run IDs. It therefore does not draw one outer rail across multiple turns or claim that adjacent restored messages share a particular run.

## 2. Visual contract

A normal thinking-led turn is:

```text
 ◉ Inspecting the existing row shape                         2 actions
 │
 ├─ Read 1 file
 │   ● src/renderer.ts
 │
 │ The native results confirm **commentary remains complete**.
 │
 │ Applying the settled replacement
 │
 ╰─ Edit 1 time
     ● src/renderer.ts (1 replacement)
```

Grammar:

- `◉` — native thinking that starts a visual turn with tools;
- `○` — native thinking-only note;
- `├─` — a child action run with another source-ordered child following;
- `╰─` — the final child, explicitly closing the visual turn;
- `●` — one tool row with its existing running/success/error state;
- `│` — the current turn continues.

The header is native assistant content. It is not generated from tool metadata and does not represent a stored master object. Ordinary paragraph-level thinking markers use the muted theme color; the top-level action marker follows the turn state color. Thinking immediately before a validated final answer follows that answer's running/completed state. The optional action count is a render-time aggregate over the already validated turn.

The hierarchy means only **“these items belong to the same Pi turn.”** It does not claim that a thinking or commentary block caused, planned, or semantically owns a tool call.

### Tool-only turn

A tool-only response has no visible native thinking to use as a header, so the renderer inserts a presentation-only `Thinking...` placeholder. It is not stored in Pi's message/session data and does not invent a `Tool step` title:

```text
 ◉ Write 1 file
     ● src/index.ts

 ◉ Run 1 command
     ● npm run check
```

### Thinking-only turn

```text
 ○ Reviewing the ownership rules
```

### Successive turns

Each turn closes before the next native thinking header begins:

```text
 ◉ Inspecting documentation                                  1 action
 │
 ╰─ Read 2 files
     ● docs/extensions.md
     ● agent-loop.js

 ◉ Verifying the implementation                              1 action
 │
 ╰─ Run 1 command
     ● npm test
```

This provides visual continuity without merging two assistant messages or pretending the render seam has an agent-run identity.

## 3. Text phases

Pi's documented `TextSignatureV1` can identify:

```ts
phase?: "commentary" | "final_answer";
```

The adapter parses only valid JSON with `v === 1`, a non-empty string `id`, and one of those phase values. Raw signatures never leave the adapter.

| Text block | Meaning | Presentation |
|---|---|---|
| validated `commentary` | user-visible intermediate output | complete native Markdown within the turn rail |
| validated `final_answer` | final user-facing response | complete native Pi assistant rendering; thinking in a mixed no-tool response may receive `○` markers |
| missing/invalid/unknown phase | cannot classify safely | text remains native; thinking-only decoration is allowed only when no tools are involved |

Commentary is not a label. It may contain long paragraphs, headings, lists, links, code blocks, or tables. It is never summarized, semantically truncated, converted to a synthetic title, italicized as thinking, or automatically collapsed.

A single continuous thinking block is visually capped at four paragraphs: the first two and last two remain visible, with a presentation-only count of the hidden middle paragraphs. This cap applies only to thinking; the native thinking component and its full content remain available through Pi's normal toggle.

When a response begins with commentary and has no thinking child, the placeholder appears first so the tool remains under a thinking block, followed by the complete native commentary. A tool-only response likewise starts under the placeholder. While streaming, unknown text remains native until Pi supplies a validated phase.

A message containing final-answer or unknown text plus tool calls is rendered completely natively. For a no-tool mixed response, the extension may mark only the thinking child starts and leaves the final/unknown text unprefixed and native. It does not infer phase from position, wording, provider, or `stopReason`.

## 4. Source-order rules

1. Read the assistant message's ordered `content` array.
2. Join each tool row through exact validated `toolCallId` equality.
3. Require the complete contiguous direct tool-row window to match the message's call-ID set.
4. Rebuild display sequence from `content`, not tool completion order or direct row order.
5. Group only contiguous calls of the same semantic kind.
6. Any thinking, commentary, native diagnostic, or spacer ends the current tool run.
7. Keep every assistant child complete and in its original position.
8. Do not infer causal ownership between content and calls.
9. Never merge separate assistant messages into one turn block.

Example:

```text
thinking → read → read → commentary → read → edit

◉ thinking
├─ Read(2)
│ commentary
├─ Read(1)
╰─ Edit(1)
```

For `thinking → tool → thinking → tool`, the second thinking stays in source order inside the same turn. The final tool receives `╰─`.

## 5. Native rendering and width

Assistant content is not recreated. The adapter reuses Pi's native thinking and Markdown children after `AssistantMessageComponent` has built them.

At normal widths:

```text
" ◉" + native header line
" │" + native continuation line
" ├─" + compact group heading
" ╰─" + final compact group heading
```

Pi's own output padding supplies the space before native content. Width is deducted before rendering:

```text
assistant width = terminal width - measured assistant gutter
compact group width = terminal width - measured branch gutter
```

Native wrapping, Markdown styling, code blocks, links, OSC sequences, diagnostics, and thinking visibility remain intact. At narrow widths the leading margin disappears; if necessary, decoration yields before content width falls below one cell. Every final output line is still width-checked defensively.

Pi's native spacer children remain the vertical rhythm between source items. The renderer does not add duplicate semantic content.

## 6. State and closure

Turn state uses the established precedence:

```text
running > failed > complete > note
```

- `running`: assistant is streaming, stop reason is pending, or any tool is pending;
- `failed`: no work is pending and the assistant/tool batch failed;
- `complete`: the turn has settled tools;
- `note`: thinking content without tools.

Ordinary paragraph-level thinking markers (`○`) and rails use `muted`; the top-level thinking-led `◉` follows the turn state color, and thinking immediately before a validated final answer follows that answer's state. Tool-root action markers and individual `●` rows retain their success/running/error colors, so mixed successful and failed actions remain distinguishable.

`├─` and `╰─` are structural rather than status markers. The renderer finds the final meaningful source child; the last action run uses `╰─`. If native commentary/thinking is the final child, its terminal content marker closes the turn instead.

## 7. Native fallback

Render the complete affected response through Pi's original path when:

- a text block is `final_answer` or has unknown phase;
- tool-call IDs are missing, duplicated, incomplete, or mismatched;
- a row is expanded;
- private assistant/tool/component shape is incompatible;
- native child extraction or mouse layout cannot be validated;
- a renderer throws or returns an invalid shape.

Pure final answers remain ordinary full-width Pi output without storyboard decoration.

A collapsed running `edit` is a compact pending action containing at most its validated path. The native component continues to own execution and preview state, but its full-width preview is not rendered inside the storyboard. Explicit expansion restores Pi's complete native edit UI. If the row shape or ownership cannot be validated, the complete affected response still falls back to Pi unchanged.

## 8. Interaction contract

- Pi's thinking toggle and native thinking mouse behavior remain active.
- Pi's tool expansion action restores complete native assistant/tool rows.
- Assistant-child mouse coordinates are translated by the measured storyboard gutter.
- Branches and compact summaries, including running edits, are presentation-only mouse sinks.
- Fullscreen scrolling, selection, searching, theme invalidation, and transcript lifecycle remain Pi-owned.

## 9. Architecture

```text
src/
├── grouping.ts                 # semantic compact tool runs
├── renderer.ts                 # compact tool headings/rows
├── storyboard.ts               # pure response boundary/order validation
├── storyboard-renderer.ts      # thinking-led branch and end-cap grammar
├── pi-adapter.ts               # guarded private component inspection
├── transcript-replay.ts        # fixed real-component diagnostic
└── tui-preview.ts              # fixed turn-storyboard reference
```

The sole live integration seam remains the guarded `Container.prototype.render` wrapper. The extension does not:

- subscribe to agent/turn/message/tool lifecycle hooks;
- read or write `sessionManager`;
- append entries or inject messages;
- register or replace tools;
- keep parallel run/turn transcript state;
- perform filesystem, network, subprocess, timer, or background work;
- mutate Pi components, child arrays, arguments, results, or message content.

## 10. Verification matrix

### Semantics

- thinking → commentary → tool;
- thinking → tool → commentary → thinking → tool;
- repeated same-kind tools separated by content remain separate runs;
- direct tool rows reversed relative to call order map back by ID;
- final source action receives `╰─`;
- tool-only response uses a presentation-only `Thinking...` placeholder and no synthetic `Tool step` title;
- thinking-only response has one quiet `○` header;
- final answer text remains completely native;
- thinking in a mixed no-tool final response receives markers without decorating final text;
- unknown or malformed text remains completely native;
- streaming text without a settled phase remains native.

### Rich commentary and layout

- long paragraphs;
- headings and lists;
- fenced code;
- links and OSC behavior;
- native blank paragraphs;
- widths 1 through 200;
- no rendered line exceeds the supplied width;
- native mouse coordinates account for the exact gutter.

### Lifecycle

- hidden/revealed thinking;
- click-to-toggle native thinking runs;
- collapsed/expanded tools;
- compact running edits with incomplete and complete arguments;
- running-to-settled edit transitions without invoking the native renderer while collapsed;
- parallel and out-of-order completion;
- abort/error/length diagnostics;
- restored sessions, compaction, fork/resume/new/reload;
- multiple successive assistant/tool turns displayed as separate closed blocks;
- theme switching and fullscreen mode.

## 11. Current implementation status

Implemented:

- validated `TextSignatureV1.phase` parsing isolated in `pi-adapter.ts`;
- native commentary inside thinking-led turn blocks;
- native fallback for final and unknown text phases;
- exact source-order reconstruction by `toolCallId`;
- aggregate turn marker/action count without a persisted master record;
- `├─` continuation branches and `╰─` final-child closure;
- presentation-only `Thinking...` headers for tool-only responses;
- compact pending edit rows with native previews reserved for explicit expansion;
- measured assistant and branch width budgets;
- native mouse-coordinate translation;
- updated fixed preview and transcript replay fixtures;
- regression tests for ordering, commentary, closure, width, phase fallback, and mouse offsets.

Remaining release work is interactive verification against live streaming, expansion, theme changes, and session lifecycle flows.
