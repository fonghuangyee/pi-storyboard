# pi-storyboard development documentation

> **Authoritative project document.** This file is the source of truth for how the extension works, what it is allowed to do, and how it must be verified. Update it in the same change as any behavioral, architectural, compatibility, dependency, test-fixture, or workflow change. `README.md` is intentionally reserved for Pi extension marketplace users.
>
> This document consolidates the former `PLAN.md`, `STORYBOARD_PLAN.md`, `STORYBOARD_GROUPING_OPTIMIZATION_PLAN.md`, and `TRANSCRIPT_ANALYSIS.md` documents. It describes the implemented design unless a section is explicitly marked as future work.

## 1. Project identity and status

`pi-storyboard` is a zero-runtime-dependency, presentation-only Pi extension. It replaces eligible collapsed tool rows with compact summaries and composes validated assistant responses into source-ordered visual storyboards. Pi remains the owner of tools, execution, messages, context, session storage, native rendering, expansion, and interaction.

The implementation is complete for the current design:

- semantic grouping covers built-in, custom, MCP, and subagent tool rows;
- a validated assistant response and its exact tool rows form one storyboard scene;
- native thinking, commentary, and tool-call source order is preserved;
- a narrow active-path continuation can hide directly adjacent empty/absent-thinking roots without merging ownership;
- eligible absent/empty-thinking tool scenes have an explicit presentation-only `Thinking...` root; a same-response commentary-to-tool suffix can also receive the fixed placeholder;
- expanded or ambiguous content falls back to Pi's original renderer;
- `/storyboard-settings` opens the interactive presentation-settings page directly for global settings and saves only the validated global `pi-storyboard.json` file, including a switch for bounded successful result summaries;
- the guarded private adapter, settings validation/storage, and pure projection layers are covered by unit tests.

Remaining release work is interactive verification against live streaming, expansion, theme changes, session replacement, and coexistence with other transcript-patching extensions. Optional long-span UI windowing is deliberately not shipped.

### The central distinction

The extension has two different kinds of grouping:

1. **Semantic ownership:** a `StoryboardScene` represents exactly one Pi assistant response and its exactly matched tool rows.
2. **Visual composition:** a `StoryboardWorkSpan` may arrange one scene, or a narrowly validated sequence of scenes, as one visual layout.

A work span is never a persisted Pi identity, an agent run, a context record, or a synthetic parent message. No assistant messages, tool calls, results, thinking signatures, or session entries are merged or rewritten.

## 2. Pi model and constraints

This section records the platform facts that the implementation relies on. Private implementation details are treated as compatibility probes, not contracts.

### 2.1 Sessions are active-path trees

Pi session storage is append-only JSONL with tree-linked entries. An entry normally has:

```ts
{
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}
```

Raw append order includes abandoned branches. The displayed conversation is the selected root-to-leaf path, not necessarily the file order. Compaction and branch-summary entries are presentation boundaries even when the native TUI happens to place adjacent components next to one another.

The live extension reads the public session projection supplied by `ctx.sessionManager.buildContextEntries()`. It does not parse session files. The current implementation derives the snapshot leaf from the final entry returned by that one call so the entries and leaf cannot become inconsistent between separate reads.

The public session methods have different purposes:

| Method | Meaning | Used by the extension |
|---|---|---|
| `getEntries()` | all entries in append order, including abandoned branches | no |
| `getBranch()` | current root-to-leaf path without compaction filtering | no |
| `buildContextEntries()` | active, compaction-aware path used for context/rendering | yes |
| `buildSessionContext()` | model-facing messages and restored settings | no |

Relevant entry categories include:

- `message` entries containing user, assistant, or tool-result messages;
- `custom_message` entries, which may participate in model context;
- `custom` entries, which are context-neutral but may still have a visible renderer;
- `compaction` and `branch_summary` entries;
- `model_change`, `thinking_level_change`, `label`, and `session_info` entries;
- additional schema entries introduced by later Pi versions.

Known transparent state entries are safe for ownership continuity only when they are not visible transcript rows. User messages, system messages, visible custom messages, summaries, branch changes, unknown entries, and malformed parent chains are hard boundaries. The recognized visible `web-search-content-ready` custom status remains a separate hard-boundary message. It is rendered as plain wrapped detail under a `web_search` tool row only when the active-path projection proves the custom-message entry's parent is its exact matched tool-result entry and that result belongs to an unambiguous `web_search` call; otherwise it is shown as a standalone plain-text storyboard status. No tool ID or ownership is invented. Other visible custom messages remain native. A collapsed compaction summary is a storyboard-owned hard-boundary row; only its explicitly expanded state uses Pi's native preview. A validated runtime `context_edit` deletion marker (`targetId` plus `replacement: null`) is also non-visual, but is treated as a hard boundary so exact scene ownership can continue without visually composing across a model-context edit. Replacement payloads or extra fields remain incompatible and fail open. If the projection cannot classify an entry safely, storyboard continuation fails open. A compaction can also leave older direct transcript children visible in the TUI while those entries are absent from `buildContextEntries()`; those unmatched older scenes remain native, while independently matched scenes after the compaction may still storyboard. The compaction boundary is never visually bridged.

### 2.2 Assistant content is ordered; tool results are separate

One `AssistantMessage` contains an ordered `content` array:

```ts
AssistantMessage.content = [
  ThinkingContent,
  TextContent,
  ToolCall,
];
```

The actual sequence may be interleaved, for example:

```text
thinking → toolCall → commentary → thinking → toolCall
thinking → commentary → toolCall → toolCall
thinking → final_answer
```

Tool results are separate `toolResult` messages/components. Ownership is proven by exact equality between `ToolCall.id` and `ToolResultMessage.toolCallId`; timestamps, array positions, tool names, and `parentId` are not ownership proofs. Parallel tools can finish out of order, so completion order must not determine presentation order.

The storyboard first validates the contiguous direct tool-row window belonging to an assistant component, then reorders those validated rows by the assistant content's call IDs. Nothing is silently dropped, duplicated, or guessed.

### 2.3 A Pi turn is not an agent run

Pi documents a turn as one LLM response plus its tool calls. One agent run can contain many turns:

```text
agent_start
├─ turn_start
│  ├─ assistant response
│  ├─ tool executions/results
│  └─ turn_end
├─ turn_start
│  └─ ...
└─ agent_end
```

The public session format does not persist a durable agent-run ID. Provider response IDs, stop reasons, timestamps, adjacency, similar thinking, and private harness run IDs are not substitutes. Consequently, the extension does not reconstruct arbitrary historical agent runs and does not aggregate arbitrary assistant responses.

The sole cross-response visual exception is the constrained empty/absent-thinking continuation described in [Section 4](#4-storyboard-projection).

### 2.4 Native TUI behavior

Pi's interactive transcript contains native assistant and tool-execution components as separate children. `AssistantMessageComponent` renders visible thinking and text but skips tool-call blocks; `ToolExecutionComponent` rows are rendered separately and later updated by matching tool results. This can flatten an interleaved assistant content array.

The extension therefore reuses native assistant children and reconstructs only the presentation order around validated compact tool summaries. It never recreates Markdown, thinking text, diffs, or images. A recognized Pi terminal diagnostic is retained as its original Text child and emitted as a storyboard-owned full-width diagnostic breakout. The recognized `web-search-content-ready` custom status is sanitized and bounded; when its exact active-path tool-result link is proven it becomes wrapped plain-text detail beneath that `web_search` row, otherwise it stays a standalone storyboard status. An unknown visible native child remains a native ownership boundary.

Pi's native thinking renderer skips empty thinking runs. An empty `thinking: ""` block may still carry an opaque provider signature required for replay, so visual omission is permitted but message/content/signature mutation is not.

Pi's global `app.tools.expand` action also appends a native spacer/status-text pair such as `Tool output: expanded` while the toggle is being reported. The interactive `/session` command can similarly append a `Text` status pair headed `Session Info` while a response is still streaming. If either pair lands between a still-streaming assistant component and the tool component created by a later message update, it is not transcript content and can otherwise strand the tool outside its owner window. In session-aware mode the adapter recognizes only these exact Pi-shaped pairs, proves the owner with the active-path tool-call IDs, and keeps each pair visible after the atomic scene. A collapsed compaction summary is handled separately as a storyboard boundary; when Pi's native expansion state is active, the original component is rendered natively. The recognized `web-search-content-ready` custom status remains a separate transcript message and hard boundary; only its visually attached detail presentation is allowed when active-path IDs prove the exact `web_search` result. All other native children remain ownership boundaries; legacy adjacency mode does not bridge these rows.

## 3. Marketplace-facing behavior

The public README contains the short installation and feature description. The complete contract is here.

### 3.1 Visual grammar

A normal thinking-led scene looks like:

```text
 ◉ Inspecting the existing row shape
 │
 ├─ Read 1 file
 │   ● src/renderer.ts
 │
 │ Native commentary remains complete and source ordered.
 │
 │ Applying the settled replacement
 │
 ╰─ Edit 1 time
     ● src/renderer.ts (1 replacement)
```

Markers mean:

- `◉` — a native-thinking or explicit presentation-only root that starts a visual turn with actions, or the root marker for a standalone boundary/status;
- `○` — a thinking-only note or a later visible thinking step;
- `├─` — an action run with another meaningful child following;
- `╰─` — the final meaningful child in the scene/chapter;
- `●` — one compact tool row;
- `│` — muted structural continuation.

The hierarchy communicates presentation membership only. It never claims that a thought or commentary caused, planned, or semantically owns a tool call.

Thinking markers use the configured assistant lifecycle colors: active thinking defaults to `syntaxKeyword`, settled thinking defaults to `success`. They never turn red because a tool failed. The top-level action marker follows aggregate scene state, and each tool row retains its own configured success/running/error state.

### 3.2 Tool groups

Every compatible collapsed eligible row is a group, including a singleton. Adjacent rows merge only when their semantic kinds match.

| Tool name(s) | Group kind | Compact heading |
|---|---|---|
| `read` | `read` | `Read N file(s)` |
| `grep`, `find` | `search` | `Search N time(s)` |
| `ls` | `list` | `List N director(ies)` |
| `write` | `write` | `Write N file(s)` |
| `edit` | `edit` | `Edit N time(s)` |
| `bash`, `powershell` | `command` | `Run N command(s)` |
| custom, unknown, MCP, subagent | `tool` | `Run N tool(s)` |

Examples:

```text
Read 2 files
  ● src/a.ts
  ● src/b.ts (offset=80, limit=40)

Search 2 times
  ● grep "UserService" in src/
  ● find "*.test.ts" in test/

Edit 1 time
  ● src/index.ts (2 replacements)

Run 2 commands
  ● npm test (took 1.5s)
  ● git status

Run 2 tools
  ● custom-tool {"target":"src"}
  ● mcp.lookup {"id":42}
```

`read + edit + read` produces three action runs. `grep + find + grep` produces one Search group. Within a scene, same-kind tools separated by thinking, commentary, or native content do not merge. A validated empty/absent-thinking continuation may visually coalesce adjacent same-kind action runs across its scene boundaries, while retaining separate scene ownership.

### 3.3 Tool summary data

Collapsed summaries expose only the minimum safe display data:

- `read`: path and supplied `offset`/`limit`;
- `grep`: quoted pattern, optional path/glob/limit;
- `find`: quoted pattern, optional path/limit;
- `ls`: path, defaulting to `.` only where that matches native behavior;
- `write`: destination path only, never content;
- `edit`: destination path and settled `edits.length`; running edits retain at most a validated path;
- `bash`/`powershell`: command and an actual `cwd` when present, never output;
- generic tools: tool name plus sanitized compact JSON arguments;
- image-producing calls: path/status only, never image data.

The adapter validates recognized argument shapes. Malformed recognized arguments use the tool name and sanitized compact JSON rather than an invented label. A failed malformed edit may still use the safe label `edit` and its bounded failure line. When enabled, a separate successful-result summary may expose one bounded line from plain-text result content for any tool kind.

Command timing is shown only when Pi exposes valid `startedAt`/`endedAt` state. No duration is invented. For a settled successful result, the adapter may retain one sanitized, bounded useful line from its plain-text result blocks as a presentation-only summary; it never retains the complete result or opaque `details` object. This summary is enabled by default and independently controlled by `showToolResultSummary`.

### 3.4 Result summaries, failure, and running behavior

Failures remain in their normal semantic group. They use an error-colored `●`, while the bounded generic diagnostic is always rendered on a new indented line:

```text
Run 1 command
  ● npm run check
    Command exited with code 1
```

For successful settled calls, the adapter scans plain-text result blocks and keeps the last non-empty useful line, skipping only structural punctuation and common `Took`/`Elapsed`/`Duration` timing footers. It strips terminal controls, caps the retained line at 512 Unicode code points, and stores no other result text. This can expose a short excerpt of read-file or command output, so `showToolResultSummary` is independently configurable and defaults to `true`; setting it to `false` hides the excerpt without affecting errors or native expansion. No summary is shown for a running or failed call, or when there is no usable text. The complete bounded summary is wrapped rather than trimmed and has no `-` prefix:

```text
Run 1 command
  ● npm test
    142 tests passed
```

For failures, the adapter does not classify tool-specific error formats. It scans text result blocks, sanitizes lines, skips empty/structural tails such as `}` and serialized property lines, prefers the last generic diagnostic-looking line, and otherwise uses the last useful line. The stored diagnostic is capped at 512 Unicode code points; if no usable text exists, it is `Failed`. The complete bounded diagnostic is wrapped rather than trimmed, and no `-` prefix is added. Full output remains owned by Pi and is available through native expansion.

Every running call, including a running edit, is compact while collapsed. A running edit never copies `oldText`, `newText`, diff, patch, preview, or full result details. If it later settles or fails, its compact row updates without invoking the native edit renderer in collapsed mode.

### 3.5 Text phases and commentary

The adapter accepts a text phase only when its serialized signature is valid `TextSignatureV1` data: `v === 1`, a non-empty `id`, and `phase` equal to `commentary` or `final_answer`.

| Text state | Presentation |
|---|---|
| validated `commentary` | complete native Markdown, full width, exact source position |
| validated `final_answer` | complete native Pi rendering; the affected tool-bearing response is native |
| missing, invalid, or unknown phase | native; never guessed from wording or position |

Commentary is narrative, not a short thinking title. It may contain headings, lists, links, tables, code, multiple paragraphs, OSC sequences, and other native Markdown behavior. It is never summarized, relabeled, moved, or truncated to make room for a rail.

When one validated response has:

```text
visible thinking → validated commentary → eligible collapsed tool calls
```

the renderer emits:

```text
 ◉ Planning the handler
 │
 The complete native commentary remains here at full width.

 ◉ Thinking...
 ╰─ Run 3 commands
     ● npm test
     ● npm run typecheck
     ● npx eslint ...
```

`Thinking...` is a fixed presentation-only node. It is not model reasoning, a recovered hidden block, a session entry, a message, a native assistant child, or context. The commentary-suffix node stays same-response and distinct from the source-empty scene roots described below. Commentary-only responses with no tools, final/unknown text, expanded rows, incomplete ownership, and incompatible private shapes do not receive it. A validated leading commentary block with no source thinking remains full-width before a source-empty root and its tools; without native source-order composition, that affected response remains native rather than guessing commentary placement.

### 3.6 Empty thinking and tool-only turns

Empty or absent source thinking is semantically retained, while its native content stays visually empty. Eligible collapsed tool scenes now use an explicit inert UI root rather than promoting their first action:

```text
 ◉ Thinking...
 ├─ Read 2 files
 │   ● fixture/a.ts
 │   ● fixture/b.ts
 ╰─ Run 1 command
     ● fixture-command
```

- absent, empty, whitespace-only, and empty redacted thinking all receive the fixed UI root; opaque signatures are untouched and never extracted into presentation state;
- `hasThinking` records non-empty **source** reasoning, independently of Pi's native thinking toggle; optional `thinkingPresence: "absent" | "empty" | "visible"` metadata distinguishes empty from absent blocks without retaining their payload;
- real reasoning hidden by Pi keeps its native label and mouse toggle; rendered-empty real reasoning is not relabeled as absent/empty and receives no invented replacement thought;
- each leading tool-only scene has its own root, including consecutive same-kind scenes; a synthetic root never authorizes continuation or cross-response coalescing;
- a settled empty/absent-thinking scene may still continue beneath the immediately preceding genuine visible-source-thinking root only when all existing continuation checks pass;
- scene, work-span, and legacy source-empty render paths share the pure root policy; the renderer never creates source-empty roots by guessing from blank native lines;
- validated leading commentary stays complete and full-width before its root; commentary without source-order extraction remains native;
- the commentary-suffix placeholder is a distinct same-response presentation node. In work spans, an action chapter orphaned by a diagnostic or preceding later native thinking can use an `unanchored-actions` UI root, without moving or fabricating the native content;
- no-tool messages, native fallback, and expanded scenes do not gain synthetic decoration.

A continuous thinking block longer than four paragraphs shows the first paragraph and last three paragraphs, with an explicit presentation-only hidden count such as `↳ 2 thinking steps behind the scenes`. The native thinking component and full content remain available through Pi's normal thinking toggle. Commentary is never collapsed.

### 3.7 Presentation settings

`/storyboard-settings` is an interactive TUI command that opens the global settings page directly; it does not show a scope-selection prompt. `/storyboard-settings global` is also accepted, while a `project` argument is rejected. The page exposes independent file/path, command, and generic-tool-argument trimming modes, a `showToolMetadata` switch for optional timing and argument metadata, a `showToolResultSummary` switch for bounded successful-result excerpts, the default and per-kind tool dots, thinking/rail/branch symbols, status/thinking/structure color tokens, reset-to-defaults, and Save and reload.

The command buffers edits until Save. Saving atomically replaces only `~/.pi/agent/pi-storyboard.json`; project settings are not editable through this command. Pi's unrelated `settings.json` files are never changed. Existing trusted-project `pi-storyboard.json` values can still participate in effective runtime settings and continue to override global values as documented below, but this command neither edits nor creates them. A successful save runs Pi's reload flow so the new immutable snapshot is active immediately; cancelling writes nothing. Non-TUI modes show a warning and perform no I/O.

Settings are read from `~/.pi/agent/pi-storyboard.json` and, for trusted projects, `.pi/pi-storyboard.json`. Project values override global values; an invalid project field falls back to the corresponding validated global field so one bad project value cannot erase unrelated global customization. Invalid global values fall back independently to built-in defaults. Symbols cannot contain terminal controls or line breaks, and colors are allowlisted Pi theme tokens. The editor accepts short text input for symbols and cycles through the allowlisted color names. Theme ANSI strings are still generated at render time.

Each trimming field accepts one of three values: `none` preserves the complete target value by wrapping it; `middle` keeps both the beginning and end with a middle ellipsis; and `end` keeps the beginning with an end ellipsis. `fileNames` applies only to path/filename values, `commands` applies only to Bash/PowerShell command values, and `tools` applies to the compact JSON arguments of custom, MCP, and subagent tools. Offsets, limits, search metadata, replacement counts, `cwd`, timing, bounded successful-result summaries, bounded error diagnostics, and bounded web-search status details are never trim targets; they remain complete and wrap when necessary. Errors and attached status details start on their own indented line without a `-` prefix. The default is `middle`. The previous boolean schema remains readable for migration (`true` maps to `middle`, `false` maps to `none`); settings saved by the editor use the string modes.

`showToolMetadata` defaults to `true`. When false, the compact renderer hides optional timing, range, replacement-count, search-option, `cwd`, and similar metadata suffixes while retaining the primary path/command/tool-argument value, tool name, status marker, headings, result summaries, and bounded error diagnostics. `showToolResultSummary` also defaults to `true`; setting it to `false` hides only the one-line successful-result excerpt. Neither setting affects native expansion or ownership.

The settings page is presentation-only: it does not change ownership, grouping, source order, native expansion, messages, session entries, tools, prompts, or model behavior.

### 3.8 State, closure, and expansion

Scene state follows:

```text
running > failed > complete > note
```

- `running`: assistant streaming, stop reason pending, partial tool, or missing tool result;
- `failed`: settled failure stop reason (`error`, `aborted`, `length`) or failed tool result;
- `complete`: settled scene with tools and no failure;
- `note`: thinking content without tools.

The final meaningful source child gets `╰─`; earlier action runs get `├─`. A recognized terminal diagnostic is a full-width storyboard breakout in its exact source position, so it is not placed on the action rail. Unknown native content remains a native boundary.

A Pi terminal diagnostic is presentation data, not a reason to discard an otherwise validated scene. For the known `Text` diagnostic shape, the adapter reuses Pi's rendered lines and original child for mouse mapping while the storyboard owns placement. If the stop reason or private child shape is not recognized, the conservative native fallback still applies.

A collapsed compaction summary is presentation-owned as an independent hard boundary: it displays only `Compacted from N tokens`, derived from Pi's `tokensBefore` field. The caption is generated by the extension, not copied from the summary text; no expansion hint is appended. The summary never visually joins the scene before or after it and uses the existing thinking-root marker `◉`, not a branch marker that implies a missing parent. When Pi marks it expanded, the original component is the sole native preview; collapsing it returns to the concise boundary caption. The validated `web-search-content-ready` custom message remains distinct, but when active-path IDs prove its parent tool result belongs to an unambiguous `web_search` call, its sanitized, bounded content is rendered as plain wrapped detail beneath that exact tool row. It does not add a tool count or receive a synthetic `toolCallId`. If that link cannot be proven, the status is a standalone plain-text storyboard row with the same thinking-root marker. Both cases omit the custom-type label and native message box.

Pi's configured global tool expansion state is authoritative. Expanded mode is a hard boundary: all affected tool rows and storyboard decoration return to Pi's complete native rendering, including live output, edit diffs, images, custom details, diagnostics, and no-tool thinking markers. The extension does not register a shortcut or assume a particular key binding.

## 4. Storyboard projection

The pure storyboard model lives in `src/storyboard.ts`. It has no Pi imports and is intentionally fail-open.

### 4.1 Projection layers

```text
active path / native children
└─ validated assistant response
   ├─ native assistant content in source order
   ├─ exact tool-call ownership by ID
   └─ compact action runs within that response
```

The main types are:

```ts
type StoryboardScene = {
  type: "scene";
  assistant: AssistantSceneSnapshot;
  actionRuns: readonly StoryboardActionRun[];
  orderedChildren?: readonly StoryboardOrderedChild[];
  state: SceneState;
};

type StoryboardWorkSpan = {
  type: "work-span";
  scenes: readonly StoryboardScene[];
  parts: readonly StoryboardWorkSpanPart[];
  chapters: readonly StoryboardChapter[];
  state: SceneState;
};
```

`StoryboardScene` is the ownership unit. `StoryboardWorkSpan` is a presentation composition. `StoryboardChapter` contains native thinking, inert synthetic root/placeholder, and action items; `StoryboardBreakout` contains full-width commentary or a recognized Pi terminal diagnostic. `StoryboardBoundarySegment` contains a collapsed compaction boundary or a recognized web-search status. A proven web-search status may be passed as presentation-only row detail for its exact call; it remains a separate boundary/message and does not change the scene's assistant/tool ownership. Synthetic placeholder nodes and boundaries are presentation-only and never become model or session data.

### 4.2 Building one scene

`buildStoryboard()` processes direct transcript-child snapshots:

1. recognize an assistant component and inspect its ordered content metadata;
2. collect only its contiguous following tool-row window;
3. require unique assistant call IDs and unique tool-row IDs;
4. require the complete direct window to have exactly the assistant's call-ID set;
5. reorder validated rows by assistant source call order;
6. reject expanded or malformed rows, final/unknown text with tools, extra rows, missing rows, or unsupported children; recognize only the validated Pi terminal diagnostic Text shape, collapsed compaction boundary, and `web-search-content-ready` custom status as storyboard content;
7. make a native segment for every rejected affected region; expanded compaction remains a native segment so Pi's expansion state restores its full summary preview, while the recognized custom status remains a hard storyboard boundary and never renders its native message box; only its visual placement as row detail requires exact `web_search` result association;
8. otherwise create one scene and split adjacent same-kind tools into action runs.

When no tool calls exist, only a thinking-only assistant can become a quiet scene. Ordinary final answers and unrelated assistant messages remain native.

Unknown native children and unrecognized diagnostic children are never silently absorbed. A visible unknown native child is a boundary. A recognized Pi terminal diagnostic is the explicit exception described above and is retained as a source-ordered storyboard breakout. A collapsed compaction component and the recognized web-search completion status are explicit boundary exceptions described above; an expanded compaction state remains native. An invisible assistant component may be skipped by the legacy grouping state machine only when it has no rendered output; it does not justify semantic ownership guessing.

### 4.3 Source-order content

When native child extraction is available, `orderedChildren` contains:

```ts
{ type: "assistant", content: StoryboardAssistantContent }
{ type: "tool", tool: StoryboardToolSnapshot }
```

The renderer uses that order, not direct child order or tool completion order. Each assistant child remains tied to the original component and rendered line set; recognized terminal diagnostics are rendered as full-width storyboard breakouts rather than as the original assistant preview. Collapsed compaction summaries are rendered as boundary segments, while expanded summaries remain the original Pi component. A proven custom status is passed separately as a bounded row-detail annotation, never inserted into `AssistantMessage.content` or the tool-call list. Text phase metadata is reduced to a validated enum; raw signatures never leave the adapter.

A source sequence such as:

```text
thinking → read → read → commentary → read → edit
```

becomes:

```text
◉ thinking
├─ Read(2)
│ commentary at full width
◉ Thinking...
├─ Read(1)
╰─ Edit(1)
```

A visible thinking block between two calls breaks action runs but does not create a new assistant-message ownership unit.

### 4.4 Active-path continuation

`buildEmptyThinkingContinuation()` is the only multi-scene work-span builder. It accepts a first scene with visible thinking, actions, no text, and no final/unknown phase, followed only by scenes with settled actions and no visible thinking or text. Each scene retains its own assistant and tool ownership.

The adapter additionally requires:

- both scenes are settled and uniquely matched to `SessionProjection.turns`;
- projected turns are consecutive;
- the first scene has no text/commentary and the later scene has no text/thinking;
- the previous projected turn has no `boundaryAfter` and the next has no `boundaryBefore`;
- direct component order is adjacent;
- no expanded, incompatible, native, visible custom, summary, compaction, branch, or unresolved streaming boundary occurs;
- consecutive empty-thinking scenes may continue, and adjacent same-kind action runs may be visually coalesced across those scene boundaries; each original scene and its exact tool ownership remain separate.

This removes an empty visual root, not an ownership boundary:

```text
◉ Applying the validated fix
├─ Edit 2 files
╰─ Run 1 command
```

If any check fails, the scenes stay separate or the affected region is native. Synthetic roots are never source thinking and cannot satisfy the anchor checks; consecutive tool-only responses therefore remain separate rooted scenes.

### 4.5 Session projection

`src/session-projection.ts` retains only immutable presentation metadata:

```ts
type ProjectedAssistantTurn = {
  entryId: string;
  toolCallIds: readonly string[];
  resultEntryIds: readonly string[];
  hasVisibleThinking: boolean;
  hasCommentary: boolean;
  hasFinalAnswer: boolean;
  hasUnknownText: boolean;
  valid: boolean;
  boundaryBefore: boolean;
  boundaryAfter: boolean;
};

type ProjectedWebSearchStatus = {
  entryId: string;
  assistantEntryId: string;
  resultEntryId: string;
  toolCallId: string;
  content: string; // sanitized, capped at 512 code points; only for visible-status matching
};
```

The module:

- validates active-path entry IDs, parent links, known entry shapes, and duplicate IDs;
- accepts only the exact non-visual `context_edit` deletion shape at runtime and marks it as a hard boundary;
- inspects assistant content only for block kinds, visible-thinking presence, text phase, and tool-call IDs;
- joins tool results by exact call ID;
- marks incomplete or duplicate ownership invalid;
- treats model/thinking-level/label/session-info entries and hidden custom state as transparent;
- treats user/assistant/non-tool messages, compaction, branch summaries, and visible custom state as boundaries;
- retains only sanitized bounded text plus exact entry, assistant, result, and call IDs for a recognized web-search status whose parent is its matching tool-result entry and whose assistant call name is `web_search`; the status still marks a hard visual boundary;
- returns `undefined` on ambiguity rather than guessing.

It retains no full message, provider payload, thinking signature, tool argument, output, diff, patch, or result detail.

### 4.6 Commentary chapters

Within a validated scene/work span:

- visible thinking starts or continues a chapter;
- validated commentary flushes the chapter and renders as a full-width native breakout;
- eligible action after a same-response commentary breakout receives the distinct suffix placeholder when a visible thinking root already exists; otherwise a source-empty action chapter receives its explicit scene root;
- the pure builder emits `synthetic-scene-root` with only its scene and a reason (`absent-thinking`, `empty-thinking`, or `unanchored-actions`); it invents no native child, source-content index, call ID, provider signature, or mouse target;
- synthetic roots use assistant lifecycle colors (active thinking while running, settled thinking otherwise), never red solely because a tool failed; they produce no native assistant region and are inert to mouse input;
- final/unknown text and unrecognized visible native content remain native; recognized Pi terminal diagnostics (`Response was truncated before completion.` and compatible validated terminal Text shapes) are storyboard breakouts and no longer force the whole assistant/tool scene native; the diagnostic remains source ordered and mouse-addressable;
- action runs merge within their original validated scene; a validated empty/absent-thinking continuation may additionally coalesce adjacent same-kind runs for presentation without merging scene ownership.

The renderer never turns commentary into a synthetic title and never moves it after tools.

## 5. Tool grouping implementation

The pure grouping state machine is `src/grouping.ts`. It accepts immutable classifications and returns native/group segments:

```ts
type GroupKind =
  | "read" | "search" | "list" | "write"
  | "edit" | "command" | "tool";
```

Eligibility and grouping are separate from rendering:

1. `src/pi-adapter.ts` validates a native row and creates a minimal `ToolRowSnapshot`.
2. `grouping.ts` merges adjacent matching kinds and preserves native boundaries.
3. `src/renderer.ts` formats and width-checks the immutable group snapshot, including any separately proven, bounded presentation-only detail aligned with its exact tool row.
4. `src/safe-display.ts` contains the pure terminal-control sanitizer shared by the renderer and session projection.

The legacy grouping path allows an empty assistant component between visually adjacent tool rows without flushing a run. It does not skip visible assistant output or incompatible components. Singleton groups are intentional so one collapsed row has the same compact presentation as a batch.

### 5.1 Renderer guarantees

`src/renderer.ts`:

- uses the active theme at render time;
- uses `visibleWidth()`, `sliceByColumn()`, and `truncateToWidth()` from `pi-tui`;
- uses the pure `safe-display.ts` helper to strip ANSI CSI/OSC and C0/C1 control sequences from model/tool-controlled display values;
- flattens newlines, tabs, and other line-breaking controls;
- uses independent `none`, `middle`, or `end` modes for long path/file-name, command, and generic-tool-argument values, defaulting to `middle`;
- applies trimming only to the selected path/file-name, command, or generic-tool-argument value; all metadata remains complete and wraps when necessary;
- renders every bounded error diagnostic on a new indented line without a prefix marker and wraps it without applying trim modes;
- renders a proven web-search completion status as plain wrapped row detail with the same no-trim, new-indented-line behavior; it does not display the internal custom type or pretend the status is a tool result;
- hides optional timing and argument metadata when `showToolMetadata` is false without hiding the primary value, successful-result summary, or diagnostic;
- shows one bounded sanitized successful-result text line by default and hides only that line when `showToolResultSummary` is false;
- never returns a line wider than the requested width, including widths from 1 through 200;
- falls back to compact JSON for malformed recognized arguments without guessing;
- never renders complete successful result contents, write arguments/content, command output, diffs, patches, image data, or generic tool output; the sole successful-result exception is one explicitly configurable, sanitized line capped at 512 Unicode code points;
- never stores complete successful or failed output—only the bounded successful-result excerpt and/or bounded generic error diagnostic.

The compact renderer is a summary, not a result viewer. Native expansion is the source of complete details.

## 6. Runtime architecture

```text
pi-storyboard/
├── package.json
├── package-lock.json
├── scripts/
│   ├── sync-transcript-schema.mjs   # offline diff of installed Pi transcript declarations
│   └── sync-transcript-schema.d.mts # type surface used by maintainer tests
├── tsconfig.json
├── README.md                 # marketplace-facing usage only
├── AGENTS.md                 # contributor/agent workflow rules
├── LICENSE
├── docs/
│   ├── ARCHITECTURE.md       # authoritative implementation document
│   ├── TRANSCRIPT_SCHEMA.md # pinned schema reference and no-thinking incident evidence
│   └── STORYBOARD_TRANSFORMATION_PLAN.md # retired plan / implementation and verification record
├── schema/
│   ├── pi-session.schema.json       # reviewed development-only persisted-record reference
│   └── pi-transcript-types.json      # installed Pi declaration baseline for sync checks
├── src/
│   ├── index.ts              # extension command, lifecycle, projection cache
│   ├── grouping.ts           # pure semantic grouping state machine
│   ├── renderer.ts           # safe compact group summaries
│   ├── safe-display.ts       # pure terminal-control sanitizer
│   ├── storyboard.ts         # pure scene/work-span/order validation
│   ├── session-projection.ts  # pure public active-path index
│   ├── storyboard-renderer.ts # rails, markers, chapters, width, closure
│   ├── pi-adapter.ts         # all private Pi/TUI inspection and patching
│   ├── presentation-settings.ts       # pure defaults, validation, and snapshots
│   ├── presentation-settings-store.ts # Pi settings read/write boundary
│   └── presentation-settings-ui.ts    # interactive settings page
└── test/
    ├── architecture.test.ts
    ├── grouping.test.ts
    ├── renderer.test.ts
    ├── storyboard.test.ts
    ├── storyboard-renderer.test.ts
    ├── session-projection.test.ts
    ├── work-span.test.ts
    ├── pi-adapter.test.ts
    ├── no-thinking-transcript.test.ts
    ├── transcript-schema.test.ts # schema integrity and sanitized incident ownership
    ├── transcript-schema-sync.test.ts # installed declaration snapshot and drift detection
    ├── fixtures/no-thinking-transcript.json # synthetic structural evidence, not a live transcript
    ├── support/no-thinking-transcript.ts # native-component integration-test fixture
    ├── presentation-settings.test.ts
    └── settings-command.test.ts # global-only command flow and no scope prompt
```

### 6.1 Extension entry point

`src/index.ts`:

- exports the default Pi extension factory;
- registers `/storyboard-settings`, which opens global settings directly, is available only in interactive TUI mode, and rejects the unsupported `project` argument;
- listens to public lifecycle notifications only to invalidate the ephemeral session projection;
- installs a fresh guarded patch on `session_start` in TUI mode;
- reads a fresh validated presentation-settings snapshot at the same lifecycle boundary;
- uninstalls it on `session_shutdown` and clears projection callbacks;
- reads `ctx.sessionManager.buildContextEntries()` only inside a lazy, invalidated cache;
- performs no session writes, tool registration, context mutation, or model-facing work; the settings command is the only user-initiated filesystem write and is limited to its validated dedicated settings file.

Projection invalidation currently responds to message/turn/agent/tool completion, compaction, tree, switch, and fork lifecycle notifications. Invalidating is the only purpose of those listeners.

### 6.2 The one private integration seam

Pi has no public transcript grouping hook, so `src/pi-adapter.ts` guards one private seam: a wrapper around `Container.prototype.render`. All private field knowledge is isolated there.

The adapter feature-detects:

- `Container.prototype.render` and its original property descriptor;
- constructibility of `ToolExecutionComponent`;
- native assistant/tool private fields needed for validation;
- collapsed/expanded compaction-summary message and component shapes;
- the recognized visible custom-message shape and active-path proof needed for web-search row details;
- native assistant child and mouse-layout shapes;
- the exact native spacer/status shape used by Pi's expansion feedback;
- valid theme and group-renderer output.

It reads native components but never mutates their messages, arguments, results, child arrays, or rendering state. The only extension-owned private marker is:

```ts
Symbol.for("pi-storyboard.container.v1")
```

### 6.3 Render flow

A patched container render follows this flow:

1. Copy the direct child array for this pass; in session-aware mode, project only the exact Pi expansion or `/session` status pair out of ownership matching while retaining its native rows for output.
2. Inspect assistant metadata, collapsed compaction-boundary fields, and tool-row snapshots without retaining unsafe payloads.
3. Build a preliminary storyboard to identify owners.
4. Render each native non-tool child once at the correct width; collapsed compaction components and recognized web-search status components are represented by storyboard boundaries and are not rendered.
5. Reconstruct native assistant child regions from Pi's own `contentContainer` and mouse layout.
6. Rebuild the final storyboard from validated snapshots.
7. In session-aware mode, uniquely match settled scenes to the active-path projection; scenes absent from that projection (including pre-compaction transcript children) remain native.
8. Build ordinary work spans or the restricted empty-thinking continuation.
9. Render compact groups, recognized diagnostic breakouts, compact status/compaction boundaries, and native fallback children in source order; render a web-search status as detail under its exact `web_search` row only when the active-path entry chain proves the custom-message parent is that call's tool result; otherwise render it as standalone plain status; render a compaction component natively only while explicitly expanded;
10. Rebuild the container's mouse layout with storyboard proxies and zero-height grouped members.
11. Return the projected output.
12. On any incompatibility, exception, invalid child output, ambiguous ownership, or renderer failure that cannot be isolated, call Pi's original container renderer once for the complete affected container. An isolated incompatible scene remains native while independently validated scene plans continue.

The adapter never embeds a native tool renderer inside a valid collapsed storyboard. A collapsed running edit remains a compact row; explicit expansion restores the original native component.

### 6.4 Native components and mouse interaction

Native assistant children remain the actual Pi components. Storyboard layout subtracts the measured assistant/branch gutter before asking compatible children to render. Native content is not recreated, so Markdown styling, links, OSC behavior, code blocks, and thinking toggles remain Pi-owned; recognized terminal diagnostics reuse Pi's rendered Text lines inside a storyboard breakout.

Because the storyboard changes visible heights and prefixes, the adapter rebuilds the private container mouse layout. It uses:

- an inert mouse sink for compact group blocks;
- a scene proxy that translates storyboard coordinates back to native assistant children;
- a thinking proxy for mixed no-tool responses where only thinking markers move and final/unknown text stays at native coordinates;
- zero-height entries for hidden grouped tool members;
- boundary entries mapped to their original components so native compaction expansion state can be observed on the next render; an attached custom status maps to a mouse sink within the storyboard-owned tool detail, while a standalone status keeps its own boundary mapping.

Branches and summaries are presentation-only mouse sinks. Native expansion and thinking toggles remain active; a collapsed compaction summary is never rendered through Pi's component.

### 6.5 Presentation-settings boundary

`src/presentation-settings.ts` has no Pi imports. It owns the settings schema, defaults, layered field validation, immutable snapshots, theme-token allowlist, and symbol safety checks. `src/presentation-settings-store.ts` is the only filesystem boundary: it uses Pi's public `SettingsManager` for trust detection and reads the dedicated global/project files with the validated precedence rules for lifecycle settings; the command separately reads only the global file. The command/UI currently select only global scope, so the interactive save target is `~/.pi/agent/pi-storyboard.json`; project settings may still be read as runtime overrides, but this command does not edit them. The store never writes Pi's `settings.json`, session data, or unrelated files. The public settings factory is feature-detected through a namespace import; if it is unavailable, lifecycle loading keeps built-in defaults and the renderer remains installed. The interactive settings UI is dynamically imported only when its command is invoked.

`src/presentation-settings-ui.ts` owns only the TUI editor. It edits a mutable draft, exposes text submenus for symbols and cycling lists for color tokens, and returns a validated snapshot to the command. It does not change the active renderer directly; `/reload` creates the new lifecycle snapshot. Renderer and storyboard code receive settings as data and never use them for ownership or fallback decisions.

## 7. Defensive patch and compatibility rules

### Installation

Installation must:

1. verify the original `Container.prototype.render` is an own data property with a callable value;
2. verify `ToolExecutionComponent` is constructible without instantiating it;
3. save the exact original descriptor and function;
4. refuse an unrelated existing marker;
5. use the project marker above;
6. support owner counting for duplicate/reloaded extension loads;
7. avoid installation outside TUI mode;
8. return `undefined` silently when compatibility checks fail.

### Uninstallation

Handles are idempotent. The final owner disables the wrapper and restores the exact original descriptor only if the prototype still points at this extension's wrapper. If another extension replaced or wrapped `render` later, this adapter never overwrites it. A disabled marker may remain when safe removal is impossible, preventing accidental stacking.

### Native fallback triggers

The complete affected region remains native when any of the following occurs:

- missing, duplicate, extra, or mismatched call IDs;
- a missing result after a settled response;
- expanded rows or global expansion;
- final-answer, unknown, malformed, or in-progress text that cannot be safely classified;
- unsupported assistant content or entry type, or an unrecognized visible terminal diagnostic child;
- session mapping ambiguity, active-path uncertainty, compaction/branch uncertainty, or a hard boundary; an affected scene remains native, while independently proven scenes elsewhere in the container may still storyboard;
- a visible custom/native child between candidate scenes; the recognized web-search status remains its own hard boundary, with optional exact row-detail display only, while the exact session-proven Pi expansion or `/session` status pair described in [Section 2.4](#24-native-tui-behavior) remains native but outside tool ownership matching;
- incompatible private component fields or mouse layout;
- invalid native child/group output;
- an exception in classification, projection, layout, or rendering;
- a third-party wrapper conflict that makes ownership unsafe.

Failing open is more important than preserving a compact presentation.

### Extension composition

Prototype wrappers can conflict by load order. The adapter preserves a later wrapper on uninstall and does not silently overwrite it. Before release, test against a known transcript-patching extension such as `@pi-kaush/pi-tool-call-markers`. If safe composition is not possible, document the conflict and keep the native fallback; do not invent an undocumented shared protocol.

## 8. Safety and privacy invariants

The extension must never:

- register, replace, remove, or modify a built-in/custom tool;
- call `registerTool()` or `setActiveTools()`;
- modify tool arguments, execution, updates, results, or ordering;
- mutate `AssistantMessage.content` or any Pi message/component object;
- append session/custom entries or inject messages/context;
- modify prompts, model selection, compaction, branching, thinking level, or token usage;
- use private harness run/turn IDs as ownership proof;
- read session JSONL files from the renderer;
- copy raw thinking, signatures, provider payloads, complete successful result content, written content/arguments, command output, edit text, diffs, patches, or full errors into extension state; the sole success-result exception is one sanitized line capped at 512 Unicode code points when `showToolResultSummary` is enabled;
- make network calls or LLM calls;
- perform filesystem writes outside the explicit user-initiated settings save boundary, subprocess work, timers, or background work.

These invariants govern the installed extension. The maintainer-only `scripts/sync-transcript-schema.mjs` is not loaded by Pi: it reads declarations from the already-installed local packages, performs no network or subprocess work, and writes only the development snapshot when invoked with `--update`.

Allowed state is limited to immutable extension-owned snapshots, minimal ephemeral active-path IDs/boundary flags needed for presentation validation, sanitized web-search status text capped at 512 code points for exact visible-message matching and display, and (when enabled) one sanitized successful-result text line capped at 512 code points per settled tool row. Disabling `showToolResultSummary` prevents extraction and retention of these lines. All state is session-local, discarded on invalidation/shutdown, and never sent back to Pi's model or session.

Display values remain model/tool-controlled and may contain sensitive arguments or result text. The renderer sanitizes terminal controls and bounds result/failure summaries, but it does not claim to redact them. Complete results and write content are intentionally excluded from collapsed summaries; the configurable single-line successful-result excerpt is the documented exception.

## 9. Verification and development workflow

### 9.1 Commands

Use the repository's scripts:

```bash
npm install
npm run typecheck
npm test
npm run check
npm run transcript:schema
npm run package:check
```

`npm run check` is the normal pre-commit validation and includes the installed declaration snapshot regression test. `npm run transcript:schema` prints a declaration-level drift report and exits nonzero when installed Pi package versions or tracked transcript types differ from `schema/pi-transcript-types.json`. After reviewing a deliberate Pi version update, `npm run transcript:schema:update` explicitly refreshes that development-only snapshot; it does not regenerate or approve `schema/pi-session.schema.json`. `npm run package:check` must be inspected to ensure the marketplace package contains the intended files and does not accidentally include development-only material.

Pi loads the extension directly from TypeScript through Jiti; there is no required production build step.

### 9.2 Test responsibilities

- `grouping.test.ts`: semantic adjacency, singleton groups, invisible assistant boundaries, and native segments.
- `renderer.test.ts`: labels, argument and successful-result summaries, sanitization, errors, optional-detail visibility, timing, safe edit/write behavior, independent `none`/`middle`/`end` modes, wrapping, truncation, and widths 1–200;
- `presentation-settings.test.ts`: defaults, validation, trust-aware precedence, immutability, dedicated-file paths, and atomic settings writes without Pi settings mutation.
- `settings-command.test.ts`: the command opens global settings without a scope prompt, saves only the global file, and rejects the unsupported project argument.
- `storyboard.test.ts`: scene ownership, exact IDs, source order, action runs, phases, state precedence, and native fallback.
- `storyboard-renderer.test.ts`: markers, rails, closure, commentary layout, thinking cap, configured symbols/colors, state colors, width budgets, and placeholder styling.
- `session-projection.test.ts`: active path, exact result ownership, transparent metadata, validated context-edit boundaries, compaction, boundaries, and text phases.
- `work-span.test.ts`: empty-thinking continuation, adjacent same-kind cross-scene visual grouping, explicit source-empty roots and reasons, no synthetic continuation anchors, scene/work-span parity, rendered-hidden real reasoning, lifecycle colors, widths 1–200, commentary suffix, source order, and no-placeholder cases.
- `pi-adapter.test.ts`: private-shape validation, no mutation, one render per child, compact running edits, bounded successful-result and failure summaries for all tool kinds, settings threading, expansion/status restoration, native thinking-marker restoration, validated terminal-diagnostic storyboard breakouts, exact active-path web-search row-detail association, ambiguous/unmatched standalone status, narrow wrapped details, compaction caption, unknown-diagnostic native fallback, mouse translation, isolated incompatible-scene fallback, fallback, owner counting, and wrapper composition.
- `no-thinking-transcript.test.ts`: native Pi components for the four-response synthetic no-thinking incident; exactly four independent roots and eleven tools, out-of-order completion, signed/redacted/whitespace-empty thinking, leading full-width commentary, running-to-failed settlement, native thinking-toggle mouse translation after inert roots, narrow resize, expansion/collapse, projection replacement/invalidation, visible-native interruption, and complete native renderer-error fallback.
- `transcript-schema.test.ts`: development-schema local reference integrity and discriminator inventory, separate persisted/live assistant profiles, and the synthetic four-response no-thinking fixture's exact ownership, no mutation, visible-custom interruption, and latest-schema/current-projector compatibility separation. These are structural/characterization tests, not a general JSON Schema validator; visual roots are covered separately by work-span, adapter, and no-thinking integration tests.
- `transcript-schema-sync.test.ts`: the checked-in transcript declaration snapshot matches installed Pi packages, and version/type-union changes are reported without auto-acceptance.
- `architecture.test.ts`: prohibited model/mutation/process APIs remain absent from the projection/rendering path, including the pure display sanitizer; the explicit settings-store write boundary remains isolated.

### 9.3 Required semantic matrix

At minimum, preserve tests for:

- one or many adjacent same-kind tools;
- mixed Read/Search/List/Write/Edit/Command/Tool order;
- source order differing from completion/direct-row order;
- duplicate, missing, extra, and malformed ownership IDs;
- running, successful, failed, and malformed-argument edits;
- bounded successful-result summaries across built-in, custom, and MCP tools, with default-visible and configured-hidden cases, no running/error summaries, and no retention of full results;
- generic custom/MCP/subagent rows retaining tool names;
- image rows collapsed versus expanded;
- thinking → tool, thinking → commentary → tool, and thinking → tool → thinking → tool;
- rich commentary with headings, lists, code, links, tables, multiline text, and OSC;
- final-answer and unknown text native fallback;
- validated Pi terminal diagnostics rendered as storyboard breakouts without losing their text;
- the recognized `web-search-content-ready` status rendered without its native message box or custom-type label; exact active-path `web_search` associations render as wrapped plain-text row detail, while ambiguous/unmatched statuses stay standalone;
- unrecognized visible diagnostic/native children remaining native;
- thinking-only notes;
- explicit roots for leading absent/empty/whitespace-only/redacted-thinking tools, one per eligible scene/chapter; synthetic roots must never authorize continuation;
- real thinking hidden through Pi's native toggle, inert root clicks, and native content mouse coordinates after the added root height;
- full-width leading commentary before a source-empty root, and native fallback when its source-order extraction is unavailable;
- same-response commentary-suffix placeholder;
- adjacent settled empty/absent-thinking continuation;
- visible thinking on every turn staying separate;
- hard boundaries from user/custom/native/branch/context-edit content;
- collapsed compaction boundaries rendered as `◉ Compacted from N tokens` without an inline expansion hint, with native compaction rendering only while Pi marks it expanded;
- recognized web-search statuses rendered as wrapped plain-text detail only with exact active-path result/call proof, otherwise standalone with the existing thinking-root marker, without changing tool counts or ownership;
- streaming before and after settlement;
- thinking toggles, expanded tools, theme changes, narrow widths, and mouse coordinates;
- session reload, resume, fork, tree navigation, new session, collapsed compaction storyboard boundaries, expanded compaction native preview, older visible children, and storyboard rendering after the compaction boundary;
- original `Container.render` restoration and coexistence with later wrappers.

### 9.4 Architecture guard

The architecture test must continue to reject model/session mutation and I/O APIs, including:

```text
registerTool
setActiveTools
before_agent_start
sendMessage
sendUserMessage
appendEntry
fetch(
child_process
spawn(
exec(
```

It also rejects unnecessary harness lifecycle coupling. Public session/message notifications are used solely for projection invalidation. This is an intent guard, not a security sandbox.

## 10. Dependencies, packaging, and compatibility

There are no runtime dependencies. Pi packages are optional wildcard peers because Pi owns the runtime modules:

```json
{
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "*",
    "@earendil-works/pi-tui": "*"
  },
  "peerDependenciesMeta": {
    "@earendil-works/pi-coding-agent": { "optional": true },
    "@earendil-works/pi-tui": { "optional": true }
  }
}
```

Current development versions reviewed by the project:

| Package | Version |
|---|---:|
| `@earendil-works/pi-coding-agent` | `0.85.1` |
| `@earendil-works/pi-tui` | `0.85.1` |
| `typescript` | `7.0.2` |
| `vitest` | `5.0.1` |
| `@types/node` | `26.5.1` |

The package targets Node `>=22.19.0`. Exact development versions and `package-lock.json` provide reproducible checks; wildcard peers avoid installing a second Pi runtime.

The package manifest intentionally publishes:

```json
"files": ["src", "README.md", "LICENSE"]
```

The authoritative development document and `AGENTS.md` are repository maintainer material, not marketplace package content.

When changing a reviewed dependency or claiming a new Pi version:

1. review the installed/public extension, TUI, session, and package APIs;
2. update this document's compatibility table and constraints;
3. update manifest and lockfile together;
4. add or update compatibility tests;
5. run the full check and package dry run;
6. perform interactive native-rendering verification.

## 11. Evidence and compatibility notes

The design was checked against Pi extension/session/TUI documentation, installed implementation and type declarations, and a local session corpus. The corpus is evidence for edge cases, not a schema contract; it must never be used to infer behavior for all providers or future Pi versions.

Observed historical patterns included:

- assistant content with tools is commonly separated from tool-result messages;
- empty thinking can carry an opaque reasoning signature;
- commentary commonly appears after visible thinking and before tools, but future providers may interleave it elsewhere;
- active sessions contain many assistant/tool cycles and can contain compaction/custom state;
- raw session append order is not sufficient for branch-aware rendering.

A historical local scan, frozen at the time of the original analysis, measured 15 session files, 4,952 active-path entries, 1,952 assistant messages, 2,568 tool-result messages, 1,824 tool-bearing assistant responses, 1,822 validated completed tool turns, 126 maximal work spans, 106 multi-turn spans, 175 custom entries, 12 compaction entries, 32 model-change entries, and 75 thinking-level-change entries. The later diagnostic session also exposed two runtime `context_edit` deletion markers; these are now recognized only in their exact non-visual form and remain hard boundaries. It also found 278 tool-bearing turns with empty or absent visible thinking, 274 of which followed visible thinking earlier in their validated span. These counts are diagnostic evidence only; they are not assumptions the renderer may use for ownership.

### No-thinking incident and development schema reference

The investigated session `01a11e5e-3df5-7180-9d24-1a976a258c67` contains legitimate assistant responses with absent thinking and empty signed thinking. Its first four responses after `ok proceed` have exactly matched tools but no visible thinking. The former action-root rendering was intentional but did not meet the desired visual contract. Sections 3.6 and 4.6 now specify explicit pure presentation roots for these eligible scenes; no model reasoning is recovered or invented.

[TRANSCRIPT_SCHEMA.md](TRANSCRIPT_SCHEMA.md) records the incident evidence, all known persisted-entry/message definitions, and schema drift. `schema/pi-session.schema.json` is a development-only JSON Schema translation of upstream commit `6fb2e7815167e6b19006fc526d1a5d0f5f998787`, compared with the installed `0.85.1` baseline at `d981de1229ef899957bbe968bc8dcda02a21f477`. The latest reference includes system messages, usage entries, context replacements, compaction checkpoints, and nested tool metadata that are not all in the installed baseline declarations. Schema recognition is not runtime eligibility or a new supported-version claim. Unknown discriminator envelopes preserve data but remain native boundaries; malformed known records cannot match those unknown alternatives. JSON Schema cannot prove tree selection, exact ownership, private component compatibility, or safe layout.

The sanitized `test/fixtures/no-thinking-transcript.json` reproduces four response shapes and intervening custom-state positions with invented data; it is not a real session copy or native-component recording. Maintainer schema material, docs, and tests remain outside the unchanged marketplace file list. The schema reference introduces no runtime schema loading, dependency, session-file parsing, or network retrieval. Pi does not publish a complete universal JSON Schema; `schema/pi-transcript-types.json` records selected transcript-related public TypeScript declarations from the installed `0.85.1` `pi-coding-agent`, `pi-ai`, and `pi-agent-core` packages. The offline `npm run transcript:schema` helper compares these declarations and package versions with that reviewed baseline; after updating the pinned development packages, it reports changed/added/removed declarations. Refreshing the snapshot is explicit and does not automatically alter the hand-reviewed JSON Schema or claim runtime compatibility. Active-path semantics, provider payloads, and private TUI component shapes remain outside this declaration snapshot and require separate review. The explicit-root presentation change is implemented separately in the pure projection/renderer and covered by native-component integration tests. The complete schema and all 166 inspected incident records plus 18 synthetic fixture entries were separately checked with a Draft 2020-12 validator and date-time format checking during this investigation; the repository tests guard reference structure and projection semantics without adding that validator as a project dependency.

Reference material reviewed includes:

- Pi session format: <https://pi.dev/docs/latest/session-format>
- installed Pi extension, SDK, and session-format documentation;
- installed `SessionManager`, assistant-message, and tool-execution declarations/implementations;
- the installed `pi-ai` text-signature and OpenAI Responses adapter types;
- the installed interactive transcript assembly and lifecycle implementation;
- the prior-art `@pi-kaush/pi-tool-call-markers` transcript patch pattern.

Important version rule: a session file's version number is not a complete feature flag. Newer Pi versions may add system messages, deferred stop reasons, response metadata, compaction checkpoints, or multiple roots. Unknown or incompatible shapes must be preserved natively rather than forced into this model.

## 12. Known risks and future work

| Risk | Mitigation |
|---|---|
| Pi private fields change | Keep all inspection in `pi-adapter.ts`, validate every shape, test against supported versions, fail open. |
| Prototype wrapper conflict | Owner-counted guarded patch, conservative uninstall, composition tests, native fallback. |
| Native output becomes stale after theme change | Resolve theme at render time; do not cache ANSI-rendered strings across themes. |
| Long transcripts cause render cost | Render each child once per pass; benchmark before adding a bounded settled cache. |
| Sensitive argument or result text appears | Document visibility; show at most one sanitized successful-result line by default, provide `showToolResultSummary: false` to disable extraction/display, never include write arguments/content, and preserve native expansion for full results. |
| Compact presentation hides complete diagnostics | Show one bounded generic failure diagnostic block; global expansion restores Pi's native details. |
| Empty thinking is mistaken for absent semantics | Suppress only visual output; retain original message/signature untouched. |

### Explicit-root implementation and remaining interactive verification

The no-thinking root proposal is implemented in Sections 3.6 and 4.6. [STORYBOARD_TRANSFORMATION_PLAN.md](STORYBOARD_TRANSFORMATION_PLAN.md) is retired as a design proposal and records implementation/verification status. The test-only `createNoThinkingTranscriptFixture()` constructs four fixed synthetic native assistant/tool scenes plus public entry data with eleven exactly matched tools, reversed result completion order, and two invisible custom-state entries. It reads no session at runtime, executes no tool, and inspects no private component fields. Integration tests exercise signed-empty, leading-commentary, running-tool-only, and failed-tool-only cases through the production renderer and guarded adapter.

Automated checks cover the native seam on the installed `0.85.1` development runtime, including root conservation, native expansion/collapse, real-thinking mouse toggling after synthetic roots, resizing, running settlement, projection replacement/invalidation, and render errors. These are not proof of the user's actual live runtime/settings or full interactive recovery. Before release, manually verify live streaming, themes, reload/resume/fork/tree/new-session/compaction, and coexistence with another transcript patcher. No new Pi-version compatibility claim is made.

### Not currently shipped: long-span windowing

Historical transcripts can contain very long sequences of tool turns. Arbitrary aggregation is intentionally disabled. A future optional UI window could collapse only settled, successful middle chapters while retaining exact counts, first/latest context, ephemeral state, and native expansion. It must never hide running, failed, aborted, truncated, commentary-adjacent, unknown, or ambiguous content. Do not implement this without updating this document and its acceptance tests first.

### Public API replacement

If Pi adds a public transcript grouping/composition hook, replace the private `Container.prototype.render` seam rather than expanding private-field dependencies. The adapter remains the compatibility boundary until then.

## 13. Change checklist

Before changing code:

- read `AGENTS.md` and this document;
- identify whether the change affects the user-visible contract, ownership, native fallback, lifecycle, compatibility, package metadata, test fixtures, or tests;
- preserve any unrelated worktree changes.

While changing code:

- keep Pi/model/session behavior unchanged;
- keep private Pi inspection inside `src/pi-adapter.ts`;
- keep pure projection logic free of Pi imports where specified;
- add or update focused tests for new behavior and fallback cases;
- do not use tool output, thinking signatures, or private run IDs as unsupported ownership signals.

Before completing a change:

- update this document whenever implementation truth changed;
- update examples, module descriptions, compatibility notes, test matrix, and future-work status affected by the change;
- keep `README.md` concise and marketplace-facing—link to this document instead of copying development detail;
- run `npm run check` and, for package-facing changes, `npm run package:check`;
- verify `git diff` contains no accidental code, generated-file, or documentation regressions.

## 14. Acceptance criteria

The implementation remains acceptable only when:

- every validated assistant response keeps its own scene and tool ownership;
- exact source order and exact call-ID matching are preserved;
- only the explicit settled empty-thinking continuation can place multiple scenes in one visual span;
- commentary remains complete native Markdown at its original position;
- the fixed commentary-suffix placeholder remains same-response and presentation-only;
- every eligible standalone source-empty tool scene/chapter has an explicit inert presentation root before its actions; real thinking hidden through Pi's toggle is not reclassified as absent/empty;
- empty/absent thinking does not create fake model content, and synthetic roots never satisfy continuation anchor checks;
- expanded, ambiguous, incompatible, or unsafe scene/tool cases render through Pi natively; an ambiguous recognized web-search association remains a standalone plain-text status;
- compact rows expose at most one configurable sanitized line from a settled successful text result, never write arguments/content, edit text/diffs, image data, or full errors;
- all output respects terminal width and strips unsafe display controls; path/command/tool-argument `none` trimming preserves complete target values by wrapping, while metadata, bounded error diagnostics, and bounded web-search status details remain complete in every mode;
- no tools, messages, context, session entries, prompts, model settings, or agent behavior are changed;
- `/storyboard-settings` writes only the validated dedicated `pi-storyboard.json` file after explicit user Save, never changing Pi settings or session data; `showToolMetadata` and `showToolResultSummary` affect only collapsed presentation;
- no network, subprocess, timer, or background work is introduced;
- patch installation/uninstallation is idempotent and does not overwrite later wrappers;
- tests and package validation pass;
- this document and `AGENTS.md` remain aligned with the implementation.
