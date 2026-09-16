# Plan: Storyboard TUI for Pi tool groups

> Status: **Direction A — Story Spine approved.** Marker pair selected: `◉` for scene headers and `○` for note scenes. This remains a presentation-only TUI change and must not subscribe to or modify Pi's agent, message, tool, context, or session pipelines.

## 1. Objective

Turn the current flat sequence of italic assistant work notes and compact tool groups into a readable **storyboard**:

- one assistant work message becomes one **scene header** (the parent row);
- every tool call owned by that assistant message appears beneath that header;
- one scene may contain several semantic action groups, such as Read, Edit, and Command;
- a scene may contain no tool calls;
- tool source order, native expansion, thinking visibility, live state, errors, and Pi theme behavior remain intact;
- the implementation remains a render-time projection of Pi's existing TUI components, with no harness-side state or event tracking.

The result should make a long agent run read like a sequence of intentional steps rather than an activity log.

## 2. Important Pi terminology

The italic lines in the screenshot, such as:

```text
Designing width fitting utility
Refining failure detail width calculation
Reviewing atomic handling logic
```

are not Pi's `Working` loader message.

They are `thinking` content blocks inside an assistant message, rendered by `AssistantMessageComponent` with `thinkingText` and italic styling. Pi's actual working message is the temporary streaming loader controlled by:

```ts
ctx.ui.setWorkingMessage(...)
ctx.ui.setWorkingVisible(...)
ctx.ui.setWorkingIndicator(...)
```

For this plan:

- **assistant message / assistant turn** is the technical ownership record;
- **scene header** is the visible `◉` row containing that assistant message's work note;
- **scene marker** is only the left-side symbol (`◉` for a tool-owning scene, `○` for a note scene);
- **work note** is the visible thinking content in the assistant message;
- **action group** is a child group such as Read, Search, Edit, or Command;
- **note scene** is a thinking-only assistant message with no child tool groups.

This distinction matters because changing `setWorkingMessage()` cannot group the italic work notes in the transcript.

## 3. What Pi gives us

### 3.1 Assistant message data

An assistant message contains:

```ts
type AssistantMessage = {
  role: "assistant";
  content: Array<TextContent | ThinkingContent | ToolCall>;
  provider: string;
  model: string;
  responseModel?: string;
  usage: Usage;
  stopReason: "pending" | "stop" | "length" | "toolUse" | "error" | "aborted" | "deferred";
  errorMessage?: string;
  timestamp: number;
};
```

Relevant content blocks are:

```ts
type ThinkingContent = {
  type: "thinking";
  thinking: string;
  thinkingSignature?: string;
  redacted?: boolean;
};

type ToolCall = {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  namespace?: string;
};
```

Therefore one assistant message already contains the ownership information needed for a scene:

```text
assistant message
├─ thinking/text content
├─ tool call A (read)
├─ tool call B (bash)
└─ tool call C (edit)
```

The tool-call IDs are the strongest join key. They should be used instead of guessing ownership from visual adjacency alone.

### 3.2 Lifecycle events exist, but Story Spine will not use them

Pi publicly exposes `turn_*`, `message_*`, and `tool_execution_*` events. They could build a parallel storyboard model, but subscribing to them would create a second state path beside the transcript renderer.

Direction A deliberately does **not** subscribe to these events. Live and restored state will be read only from the TUI components that Pi is already rendering. This keeps the extension presentation-only and avoids any coupling to the agent loop.

The only lifecycle subscriptions remain:

- `session_start`: install the guarded TUI render wrapper;
- `session_shutdown`: uninstall that wrapper.

### 3.3 Session data exists, but Story Spine will not read it

`ctx.sessionManager` could rebuild scenes from persisted entries, but Direction A does not need it. The existing transcript already contains the restored `AssistantMessageComponent` and matching `ToolExecutionComponent` rows.

The implementation must not read, append, replace, label, or otherwise interact with session entries. Scene numbering is intentionally omitted; the scene marker and title are sufficient to establish the visual parent row.

### 3.4 Native transcript composition

Pi currently renders a turn as direct transcript children:

```text
AssistantMessageComponent
ToolExecutionComponent(call A)
ToolExecutionComponent(call B)
ToolExecutionComponent(call C)
```

Tool-result messages do not become separate transcript children. They update the matching tool component.

This gives us a safe ownership window: inspect the assistant message's tool-call IDs, claim the contiguous direct tool-component window for ownership, then present those rows in the assistant message's own source order.

### 3.5 Native controls we must preserve

- `Ctrl+T` / `app.thinking.toggle`: hide or reveal thinking blocks.
- `hideThinkingBlock`: default thinking visibility.
- `setHiddenThinkingLabel()`: custom hidden-thinking label.
- `Ctrl+O` / `app.tools.expand`: native tool detail expansion.
- left-click on a native thinking run: local thinking visibility toggle.
- active theme changes and output padding.
- fullscreen transcript scrolling, searching, selection, and mouse hit testing.

### 3.6 What Pi does not publicly expose

Pi does not currently expose a public renderer that can replace or wrap a normal assistant message together with its built-in tool rows.

Public alternatives are insufficient for an integrated transcript storyboard:

- `registerMarkdownTransformer()` can change assistant/thinking Markdown, but cannot own following tools;
- `registerMessageRenderer()` only handles extension custom messages;
- `registerEntryRenderer()` only handles extension custom entries;
- widgets and overlays are separate from transcript rows;
- tool renderers operate on one tool, not the parent assistant turn.

An integrated storyboard therefore requires extending the project's existing guarded `Container.prototype.render` seam. Direction A uses only that render-time seam; a separate session-backed `/storyboard` viewer is explicitly out of scope.

## 4. Fidelity and privacy rules

1. Use the assistant message as the scene boundary, not individual thinking paragraphs.
2. Join tools to a scene only by validated `toolCallId` values.
3. Preserve tool-call source order; never regroup by kind if that reorders calls.
4. Adjacent calls of the same semantic kind may merge into one action run.
5. Render the assistant component's native output inside the scene rather than recreating its Markdown.
6. Respect hidden thinking. The storyboard must never reveal thinking hidden by Pi.
7. Never display or copy `thinkingSignature`, `thoughtSignature`, response IDs, or encrypted/redacted payloads.
8. Do not persist a second copy of assistant thinking or tool output.
9. Keep the current minimal tool snapshots: no successful output, command output, write contents, edit text, diffs, patches, or full failed output.
10. A pure final-answer message with no thinking and no tools should remain native, not become a decorative scene.
11. A thinking/work-note message with no tools may become a quiet scene.
12. Any ownership mismatch or incompatible private shape fails open to Pi's complete native rendering.
13. Do not subscribe to `agent_*`, `turn_*`, `message_*`, `tool_execution_*`, `tool_call`, `tool_result`, `context`, or `before_agent_start`.
14. Do not read or write `ctx.sessionManager`; do not append entries or inject messages.
15. Do not start timers, animation loops, background work, filesystem access, subprocesses, or network requests.
16. The scene state changes only because Pi updates its existing components and requests a render.

### 4.1 Compliance with `docs/PLAN.md`

| Baseline rule | Story Spine decision |
|---|---|
| Presentation-only extension | Preserved: render-time snapshots only |
| Native tools/execution/results unchanged | Preserved |
| No tool registration or active-tool changes | Preserved |
| No mutation-capable hooks or agent-loop changes | Strengthened: no agent/message/tool event subscriptions at all |
| No session-message or context changes | Preserved; `sessionManager` is not used |
| No I/O, network, subprocesses, timers, or background work | Preserved |
| One guarded private seam in `pi-adapter.ts` | Preserved and extended to validated assistant metadata |
| Never patch tool renderers | Preserved; no `ToolExecutionComponent.render()` or `updateDisplay()` patch |
| Running edits stay native | Preserved; a scene containing a running edit falls back natively |
| Expanded tools stay native | Preserved; global expansion makes the complete scene native |
| Failed/unsafe shapes fail open | Preserved at whole-scene granularity |
| Minimal sanitized tool summaries | Preserved unchanged |
| Width and active-theme safety | Preserved |

Two baseline presentation rules require an explicit, narrow evolution:

1. `AssistantMessageComponent` was previously always a hard boundary. It is now the validated scene header, but its native rendered lines are reused rather than reimplemented.
2. A visible assistant component previously split tool groups. It may now own only the following tool rows whose validated `toolCallId` values exactly match that assistant message. Any mismatch restores the whole region to native output.

These are TUI composition changes only. They do not affect Pi's harness, messages, execution, persistence, context, or usage accounting.

## 5. Proposed information model

```ts
type StoryboardScene = {
  assistantRow: unknown;           // native component, never mutated
  renderedAssistantLines: string[]; // produced once in this render pass
  expectedToolCallIds: readonly string[];
  actionRuns: readonly ActionRun[];
  state: "running" | "complete" | "failed" | "note";
  stopReason: string;
  hasThinking: boolean;
  hasText: boolean;
};

type ActionRun = {
  kind: GroupKind;
  rows: readonly ToolRowSnapshot[];
};
```

The display should use the native assistant lines as the scene header content. Raw thinking text is needed only for validation and classification, not for a second renderer.

### Scene state

Use deterministic aggregate state:

- **running**: assistant is streaming or at least one owned tool is pending;
- **failed**: assistant stopped with error/abort/length, or at least one owned tool failed;
- **complete**: finalized scene with calls and no failures;
- **note**: eligible work-note scene with no calls.

Do not invent progress percentages.

### Scene marker color rule

The marker shape identifies the kind of scene; its color communicates aggregate state. The shape does not change based on which tool kind ran:

- `◉` means the scene owns one or more tool calls;
- `○` means a thinking-only note scene with no tool calls;
- a plain final assistant answer has no Story Spine marker and remains native.

Use one deterministic precedence rule across all owned calls, rather than following the last call to finish (parallel tools make completion order unreliable):

1. **Running** → `syntaxKeyword` when the assistant is streaming or any owned tool is pending/partial.
2. **Failed** → `error` when no tool remains pending and the assistant or any owned tool ended with an error, abort, or length stop.
3. **Complete with tools** → `success` when at least one tool exists and all owned tools settled successfully.
4. **Settled note** → `muted` when there are no tool calls and the thinking-only message is complete.

Thus a settled no-tool note normally has a muted `○`, while an actively streaming note may use the same `○` shape in `syntaxKeyword`. A later successful tool cannot incorrectly turn an earlier failed tool's scene green.

## 6. Visual directions

All previews below are monochrome approximations. The implementation would use the active Pi theme:

- scene marker: `success`, `syntaxKeyword`, `error`, or `muted` by aggregate state;
- rails and separators: `borderMuted` / `dim`;
- assistant work note: Pi's native `thinkingText` italic rendering;
- action headings: `toolTitle`;
- item markers: the current success/running/error colors;
- secondary counts and timing: `muted`.

### Selected direction — Story Spine

A continuous rail turns the transcript into a sequence of scenes. It is compact, remains readable at normal terminal widths, and gives the tool groups clear parentage without surrounding everything in heavy boxes.

```text
 ◉  Refining row layout logic                         5 actions
   │
   ├─ Read 2 files
   │  ● src/renderer.ts (offset=340, limit=45)
   │  ● src/pi-adapter.ts
   │
   ├─ Edit 1 time
   │  ● src/renderer.ts (2 replacements)
   │
   ╰─ Run 2 commands
      ● npm test (took 1.5s)
      ● npm run check - Command exited with code 1

 ○  Reviewing atomic handling logic                  note

 ◉  Verifying errorDetail line changes                1 action
   ╰─ Read 1 file
      ● src/renderer.ts (offset=458, limit=46)
```

State is primarily color, not extra symbols:

- `◉` is the selected running/complete/failed scene-header marker in the corresponding theme color;
- `○` is the selected no-tool note marker;
- `●` retains the current per-tool status meaning.

**Strengths**

- Strong narrative hierarchy with low vertical overhead.
- Mixed action kinds naturally sit under one parent assistant message.
- A no-tool work note still has a clear place.
- Degrades cleanly on narrow terminals.
- Feels distinctive without fighting Pi's visual language.

**Risks**

- Indentation reduces action-row width by roughly 5–8 columns.
- Native thinking click coordinates need an offset mouse proxy.
- Long multi-line assistant content needs careful rail continuation.

### Rejected alternative — Scene Cards

Each assistant turn becomes a cinematic card. This is the boldest visual option and makes scene boundaries unmistakable.

```text
╭─ SCENE · REFINING ROW LAYOUT ────────────── 5 actions · done ─╮
│  Refining row layout logic                                    │
├─ READ · 2 ────────────────────────────────────────────────────┤
│  ● src/renderer.ts (offset=340, limit=45)                     │
│  ● src/pi-adapter.ts                                         │
├─ EDIT · 1 ────────────────────────────────────────────────────┤
│  ● src/renderer.ts (2 replacements)                           │
├─ RUN · 2 ─────────────────────────────────────────────────────┤
│  ● npm test (took 1.5s)                                      │
│  ● npm run check - Command exited with code 1                 │
╰───────────────────────────────────────────────────────────────╯

╭─ SCENE · REVIEWING ATOMIC HANDLING ──────────────── note ────╮
│  Reviewing atomic handling logic                              │
╰───────────────────────────────────────────────────────────────╯
```

A wide-terminal experiment could place short action groups in two columns, but v1 should remain single-column to preserve source order and avoid unstable wrapping.

**Strengths**

- Highest immediate visual impact.
- Excellent scene boundaries and failure highlighting.
- Works well for screenshots and demos.

**Risks**

- Border-heavy and vertically expensive in long sessions.
- Wrapping a native Markdown component inside a fixed border is more complex.
- Can make Pi feel like a dashboard rather than a conversational terminal.

### Rejected alternative — Director Board overlay

A session-level navigator was considered, but it would require `sessionManager` reads and/or agent lifecycle subscriptions to maintain a parallel scene model. That conflicts with this project's stricter pure-TUI boundary, so `/storyboard` is not part of the roadmap. The existing static `/tool-groups-preview` command remains acceptable because it renders fixed sample data and never inspects the harness or session.

### Rejected alternative — Filmstrip Ledger

A restrained editorial layout puts the scene on one headline and action-group summaries on following lanes.

```text
REFINING ROW LAYOUT                                  DONE
◉── Refining row layout logic
│
├── READ 2    src/renderer.ts  ·  src/pi-adapter.ts
├── EDIT 1    src/renderer.ts (2 replacements)
╰── RUN 2     npm test ✓  ·  npm run check !

REVIEWING ATOMIC HANDLING                            NOTE
○── Reviewing atomic handling logic
```

This is the densest option. Individual rows could expand only when global tool expansion is enabled.

**Strengths**

- Very compact and visually unusual.
- Excellent scanability when filenames and commands are short.

**Risks**

- Loses one-row-per-action clarity.
- Width fitting becomes difficult and may hide too much at common terminal sizes.
- Less compatible with the project's current detailed compact rows.

## 7. Decision

**Direction A: Story Spine is approved as the integrated transcript design.**

It provides the requested parent/child relationship while preserving the project's concise tool rows and pure-TUI architecture. Scene Cards, Filmstrip Ledger, and Director Board are rejected for this project; only Story Spine proceeds.

## 8. Responsive behavior

The selected design must be intentionally responsive rather than merely truncated. Scene numbers are intentionally absent; the marker and header text provide enough identity without implying a global session sequence.

### Native TUI layout contract

Story Spine respects Pi's native TUI layout contract rather than introducing web-style spacing:

- render only within the width supplied by Pi, using visible cell width and Pi's width-safe truncation utilities;
- preserve the native assistant component's output padding and the native tool/group renderer's spacer rows;
- add only the measured Story Spine decoration: marker column, rail, and child indentation;
- do not add arbitrary per-row margins, duplicate native top spacers, or strip native padding to make rows align;
- render native assistant/tool components with the remaining content width, then apply only the structural rail prefix needed by the scene;
- keep native theme roles (`thinkingText`, `toolTitle`, `success`, `syntaxKeyword`, `error`, `muted`, and border colors) instead of hard-coded terminal colors;
- if the shell cannot preserve a component's native layout or width, fail open to the complete native region.

Expanded tools, running edits, incompatible ownership, and unsupported private state therefore bypass the shell entirely. Full output, diffs, diagnostics, images, and native interaction remain Pi-native.

### Width 80 and above

Render the scene marker, assistant content, action count, rails, group headings, and current item details. Do not render a scene number.

### Width 50–79

- omit the right-aligned `N actions` label;
- shorten headings only through existing width-safe pluralization;
- keep the scene rail and one action per line;
- truncate main values from the middle using the existing renderer utility.

Example:

```text
 ◉  Refining row layout logic
   ├ Read 2 files
   │  ● /Users/fong/.../renderer.ts
   │  ● src/pi-adapter.ts
   ╰ Edit 1 time
      ● src/renderer.ts (2 replacements)
```

### Width 30–49

Use a compact rail without scene numbering:

```text
 ◉ Refining row layout logic
 │ Read 2
 │ ● .../renderer.ts
 │ ● src/pi-adapter.ts
 ╰ Edit 1
   ● src/renderer.ts
```

### Width below 30

Fail soft to a minimally decorated scene or native Pi output. Never allow border art to consume the content width.

## 9. Interaction contract

### Thinking visibility

`Ctrl+T` remains Pi's thinking control. The scene shell must update around the native assistant render and must not maintain a competing collapsed state.

If thinking is hidden, show Pi's configured hidden-thinking label. Do not derive a title from hidden raw thinking.

### Tool expansion

`Ctrl+O` keeps its existing baseline contract: when global tool expansion is active, the complete affected scene delegates to Pi's native assistant and tool rendering. No rail, indentation, or storyboard shell remains around expanded rows.

This intentionally prioritizes native-render fidelity and guarantees that full diffs, images, diagnostics, custom tools, MCP tools, and subagent renderers are unchanged.

### Mouse

- Clicking native thinking content must still toggle that thinking run.
- Group summaries remain presentation-only in v1.
- Fullscreen selection and transcript scrolling must remain unaffected.
- The adapter must provide offset-aware mouse proxies for shifted native components and accurate height entries for grouped output.

### Keyboard

Do not hardcode keys. Use Pi keybinding IDs in hints:

- `app.thinking.toggle` for thinking;
- `app.tools.expand` for action details.

No new command or global shortcut is required in v1.

## 10. Scene segmentation algorithm

1. Read a snapshot of the transcript container's direct children.
2. Identify validated `AssistantMessageComponent` rows.
3. Read the component's validated `lastMessage` through the private adapter.
4. Extract only:
   - content kinds and native child positions;
   - non-redacted visibility flags needed for eligibility;
   - ordered tool-call IDs;
   - stop reason and streaming state.
5. Render the assistant child exactly once for this render pass.
6. Match the contiguous direct `ToolExecutionComponent` window by private `toolCallId`.
7. Verify that the window contains exactly the assistant message's call IDs, regardless of direct row order.
8. Rebuild the scene's display sequence from the assistant content order, attaching each tool by ID.
9. Build semantic action runs without reordering:

```text
read + read + bash + edit + edit
→ Read(2), Command(1), Edit(2)
```

```text
read + bash + read
→ Read(1), Command(1), Read(1)
```

10. A visible unrelated child ends the scene.
11. Rebuild the scene's assistant/tool display sequence from the assistant `content` array; direct tool-child order is used only for ownership validation.
12. Group only adjacent tool calls in that source-order projection. Any thinking/text/native assistant child ends the current action run.
13. A work-note assistant with no tool IDs may form a `note` scene.
14. An assistant with validated tool IDs but no visible thinking/text may form a tool-only scene with the deterministic title `Tool step`.
15. A pure assistant final answer with no thinking and no tools remains native.
16. If IDs are missing, duplicated, reordered unexpectedly, or private state is incompatible, render the complete affected region natively.

### Fact-checked Pi ordering distinction

Pi's native assistant component renders visible text/thinking content together and renders tool components separately afterward, so the default visual tree can flatten an interleaved message. The assistant message itself still retains an ordered `content` array. Story Spine uses that source order to compose the native thinking/text children and compact tool groups back into one ordered scene.

This restores **display sequence**, not causal attribution. A thinking paragraph is not treated as the owner of a particular tool call; the assistant message owns the complete scene, and `toolCallId` joins each tool row/result. If the native child shape cannot be safely projected, the complete region falls back to Pi's renderer.

## 11. Architecture changes

Approved implementation structure:

```text
src/
├── index.ts
├── grouping.ts                 # existing semantic action runs
├── renderer.ts                 # existing compact action rows
├── pi-adapter.ts               # private transcript inspection/patch
├── storyboard.ts               # pure scene assembly and state rules
├── storyboard-renderer.ts      # selected Story Spine visual grammar
└── tui-preview.ts              # Story Spine preview and component gallery

test/
├── storyboard.test.ts
├── storyboard-renderer.test.ts
└── pi-adapter.test.ts
```

### `storyboard.ts`

Pure module with no Pi imports:

- scene eligibility;
- assistant-to-tool ownership checks;
- action-run segmentation;
- aggregate scene state;
- source-order guarantees;
- native fallback decisions.

### `storyboard-renderer.ts`

- responsive Story Spine rails;
- scene headings and counts;
- width-safe line composition;
- status styling through a small `ThemeLike` interface;
- no private Pi fields;
- no raw tool output or hidden thinking.

### `pi-adapter.ts`

Keep all new private knowledge here:

- `AssistantMessageComponent.lastMessage` and `isStreaming`;
- `ToolExecutionComponent.toolCallId` plus existing row fields;
- transcript child ordering;
- parent mouse layout and offset proxies.

Do not patch `AssistantMessageComponent.render()` or `ToolExecutionComponent.render()` directly.

## 12. Delivery plan

### Phase 0 — approved Story Spine preview ✅

Implemented one focused `Storyboard / Spine` sample in `/tool-groups-preview`. It includes:

- a mixed Read/Edit/Command scene;
- a running scene;
- a failed action;
- a no-tool note;
- a tool-only assistant message;
- separate assistant-message boundaries that must not merge;
- a long path at narrow width;
- running, expanded, and final-answer native fallbacks;
- an explicit native-expanded comparison;
- scrollable access to the full scenario matrix.

This phase made no transcript patch changes and uses fixed snapshots only. Automated coverage verifies the sample, viewport rendering, and width safety. Manual verification in the active Pi theme remains part of the next interactive check.

A separate **Transcript replay** diagnostic now replays the supplied session tail with real `AssistantMessageComponent` and `ToolExecutionComponent` instances. It is intentionally not the authority for the static sample; its findings and fixture scope are documented in [`TRANSCRIPT_ANALYSIS.md`](./TRANSCRIPT_ANALYSIS.md).

### Phase 1 — pure scene model ✅

Implemented scene ownership and action-run tests using plain snapshots. Mixed kinds remain under one assistant scene, source order is preserved, and mismatches fail open.

### Phase 2 — guarded assistant/tool adapter ✅

The guarded private seam now reads validated assistant call IDs/streaming state and tool row IDs, while retaining the existing grouping path for older or incomplete shapes.

### Phase 3 — selected integrated renderer ✅

The Story Spine shell is integrated for validated assistant/tool scenes, including completed, running, failed, note, and tool-only states. Native thinking/text children are projected in the assistant message's source order around contiguous compact tool groups. The approved static preview remains an independent fixed visual reference; the live renderer matches its rails, indentation, spacing, width behavior, and marker rules. Native rendering remains the fallback for expanded tools, running edits, incomplete ownership, and incompatible state.

Exit criteria:

- one assistant message owns all its matching action groups;
- thinking/text runs remain at their source positions;
- a no-tool work note renders correctly;
- pure final answers remain native;
- thinking visibility and tool expansion remain functional;
- mouse coordinates remain correct;
- all output lines obey terminal width.

### Phase 4 — live and lifecycle verification

Test streaming assistant content, parallel tools, out-of-order tool completion, retries, aborts, compaction rebuilds, `/reload`, `/new`, `/resume`, `/fork`, theme switching, and fullscreen mode.

### Phase 5 — package and compatibility release

- keep Director Board and all session-backed views out of scope;
- rerun the architecture guard against forbidden hooks and side effects;
- verify package contents and a clean install;
- document the guarded assistant-component private seam and native fallback behavior.

## 13. Test matrix

### Ownership

| Assistant message | Tool rows | Expected |
|---|---|---|
| thinking + `read` | matching read | one Read scene |
| thinking + `read`, `bash`, `edit` | all IDs match | one scene with three action runs |
| thinking only | none | note scene |
| text only final answer | none | native assistant output |
| calls but no thinking/text | matching rows | fallback-titled tool scene or native, pending design decision |
| calls A/B | rows B/A | map by ID and present in source order |
| calls A/B | row A only | native fallback while incomplete; re-evaluate as streaming updates arrive |
| redacted thinking | tools | do not expose hidden payload |
| hidden thinking | tools | use native hidden label only |

### Rendering

- widths 1 through 200;
- no line exceeds supplied width;
- double-width Unicode and combining characters;
- multi-line native assistant Markdown;
- long paths, commands, and errors;
- scene with every semantic group kind;
- repeated non-adjacent kinds remain separate runs;
- success, running, partial, failed, aborted, and length states;
- light, dark, and custom themes;
- output padding 0 and 1.

### Interaction

- `Ctrl+T` before and after scene creation;
- click-to-toggle a thinking run;
- `Ctrl+O` collapsed and expanded;
- transcript search and text selection in fullscreen;
- mouse clicks on following native rows use correct coordinates;
- theme invalidation rebuilds all themed strings.

### Lifecycle

- live stream and restored session match;
- parallel completion order does not change source order;
- session compaction rebuild;
- branch navigation;
- extension reload owner counting;
- uninstall restores exact native rendering;
- coexistence with another `Container` wrapper fails open.

## 14. Current verification status

Direction A, source-order assistant/tool projection, native expanded fallback, the `◉` / `○` marker pair, note labeling, and responsive rail spacing are implemented. The independent static preview remains the visual authority. The transcript-tail diagnostic is documented in [`TRANSCRIPT_ANALYSIS.md`](./TRANSCRIPT_ANALYSIS.md).

The remaining work is interactive verification in the active Pi theme: compare the live transcript with the approved static preview, then check streaming, thinking visibility, expansion, mouse coordinates, theme changes, and session lifecycle flows.
