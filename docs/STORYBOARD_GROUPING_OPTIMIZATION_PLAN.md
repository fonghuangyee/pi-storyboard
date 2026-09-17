# Plan: transcript-aware storyboard grouping

> Status: **implemented conservatively.** The read-only active-session projection validates each restored turn. Production does not aggregate arbitrary historical turns, but it now allows a narrow visual continuation: directly adjacent settled tool turns with empty/absent thinking may render under the previous validated visible-thinking root. Pi-turn ownership, call IDs, and session entries remain separate. The commentary-suffix placeholder is implemented below.

## 1. Objective

Reduce repetition within one validated assistant response while preserving clear turn boundaries. General cross-turn aggregation remains disabled because historical sessions do not expose a durable public agent-run boundary. The one exception is a constrained visual continuation for immediately adjacent settled turns whose later thinking is empty/absent; this hides an empty visual slot without inventing an agent-run identity.

```text
◉ Inspecting files
╰─ Read 3 files

◉ Thinking...
╰─ Edit 2 files

◉ Thinking...
╰─ Run 1 command
```

into compact source-ordered storyboards, with empty-thinking continuations attached to the preceding visible root:

```text
◉ Inspecting files
├─ Read 3 files
├─ Edit 2 files
╰─ Run 1 command
```

A later assistant response with visible thinking starts a new storyboard rather than being silently absorbed into the previous one. A validated later response with empty/absent thinking may continue beneath the previous root only under the explicit continuation rules below:

```text
◉ Applying the validated fix
├─ Edit 2 files
╰─ Run 1 command
```

The optimization must remain presentation-only. It must not concatenate messages, thinking signatures, model context, session entries, or tool batches.

## 2. Updated visual semantics

The production root normally means “one validated Pi turn.” A restricted work span/chapter may contain one visible-thinking turn followed by directly adjacent settled tool turns with empty/absent thinking. This is a render-time composition, not a persisted Pi run, and must not be named or documented as one. Each tool remains owned by its original assistant response.

Internal ownership remains unchanged:

```text
work span / storyboard
└─ Pi turn: assistant + that response's exact tools/results
```

A previous implementation experiment allowed arbitrary multiple turns here and produced misleading displays such as `152 actions · failed`. That broad cross-turn aggregation remains disabled; only the empty-thinking continuation is enabled.

### Marker grammar

- `◉` — root of one visual work span/chapter;
- `○` — later visible-thinking step inside the same chapter;
- `├─` — action run with meaningful work following;
- `╰─` — final action run in the chapter;
- `│` — chapter continuation;
- `●` — individual tool status, unchanged from the current renderer.

The rail communicates transcript continuity only. It does not claim that one thought caused every later action.

## 3. Grouping hierarchy

Apply grouping in this order:

### 3.1 Exact turn projection

For each assistant response:

1. validate the assistant shape;
2. read its ordered `content` array;
3. collect unique tool-call IDs;
4. match the complete tool row/result set by exact ID;
5. reconstruct thinking/text/tool order;
6. leave the whole affected response native on any ambiguity.

This preserves the existing safety foundation.

### 3.2 Work-span projection

Validate each turn against the read-only active session path and rendered component stream. Do not combine arbitrary assistant responses. The session projection proves active-path membership, exact result ownership, and whether two adjacent tool turns have a hard boundary; it does not invent a durable run boundary that Pi does not persist. Only the explicit empty-thinking continuation may compose multiple scenes visually.

A work span ends before or at:

- a user message;
- a system or custom message;
- final-answer or unknown-phase text;
- a branch or compaction summary/checkpoint;
- a visible custom entry;
- user bash or another native transcript row;
- malformed/missing/duplicate call ownership;
- an error/aborted turn with unresolved calls;
- an expanded row;
- incompatible private component shape;
- session replacement, tree navigation, or reload;
- any mismatch between session projection and component order.

Context-neutral custom state entries may be transparent for ID ownership, but an actually rendered custom component is always a visual boundary.

### 3.3 Chapter projection

Split a work span into chapters around narrative text:

- validated commentary closes the preceding chapter;
- commentary renders full-width in exact source order;
- later work starts a new chapter;
- when the later chapter begins with eligible tools and the same response already has a visible thinking root, the implemented exception inserts a fixed presentation-only `Thinking...` placeholder before that tool run;
- final/unknown text closes the work span completely.

The placeholder is not a recovered thinking block. It is a local visual container for an orphan action run created only because carrying a rail through long commentary is undesirable.

### 3.4 Action-run projection

Within one validated turn/chapter:

- merge adjacent same-kind tools;
- an empty/absent thinking block does not create a fake action boundary;
- a visible thinking block breaks an action run;
- commentary/native boundaries break an action run;
- preserve every tool row's source order and state.

Across an allowed empty-thinking continuation, preserve each original turn's action-group boundary even when adjacent groups have the same kind. The continuation removes the orphan root, not the ownership boundary. This keeps action summaries compact within one validated response while preserving every Pi-turn boundary.

### 3.5 Empty-thinking continuation

A later scene may continue under the previous visible-thinking root only when all of the following hold:

- both scenes are settled and uniquely matched to consecutive active-path projected turns;
- the first scene has visible thinking, actions, and no text/commentary;
- every later scene has actions but no visible thinking, text, final-answer phase, or unknown phase;
- the scenes are directly adjacent in the validated component projection;
- the previous projected turn has no `boundaryAfter`, and the next has no `boundaryBefore`;
- no expanded/incompatible row or native boundary occurs between them.

The first scene renders `◉`; carried action groups render `├─`/`╰─`. Empty/absent thinking content and opaque signatures remain untouched and are simply omitted from the visual projection. Consecutive empty-thinking scenes may continue under the same root. A leading empty-thinking scene remains an action root, and a live unsettled scene waits for settlement rather than being attached speculatively.

## 4. Empty and absent thinking policy

### Established chapter

When a validated turn has empty or absent visible thinking:

- add no fake thinking content;
- if it immediately follows an eligible visible-thinking root, render its observable actions as continuation children of that root;
- otherwise use the first observable action as the storyboard root when the turn is rendered through the active-path projection;
- retain its original thinking block/signature untouched.

### Commentary-suffix placeholder

The no-fake-thinking rule has one explicitly presentation-only exception. If one validated assistant response contains:

```text
visible thinking → validated commentary → eligible collapsed tool calls
```

then render:

```text
 ◉ visible thinking
 │
 Full native commentary, at its original width and source position.

 ◉ Thinking...
 ╰─ Run 3 commands
     ● npm test
     ● npm run typecheck
     ● npx eslint ...
```

The fixed `Thinking...` text is not copied from the model and does not claim to expose hidden reasoning. It is inserted only after the complete commentary breakout and only before the immediately following eligible tool run. No session entry, assistant content item, tool call, signature, or native component is created or mutated. This exception does not apply across assistant responses or across final/unknown/native boundaries.

### Leading tool-only work

When a chapter begins without visible thinking, do not invent prose. Promote the first action group to the root:

```text
◉ Edit 3 files
╰─ Run 1 command
```

This is preferred over a synthetic `Thinking...` header because it matches Pi's native treatment of empty thinking and states only observable work.

### Streaming

During an unsettled stream:

- retain the current safe per-turn/native rendering until ownership and phase are known;
- do not attach a live empty-thinking turn to an earlier chapter;
- attach the turn to an earlier chapter only after the current assistant/tool mapping is settled and validated;
- tolerate a presentation-only reflow after settlement;
- never guess from partial JSON or temporary component adjacency.

## 5. Commentary breakout

Validated commentary should no longer be rendered inside the story rail. It may be long, multiline, or rich Markdown, so the earlier rail must not be stretched through it.

For the orphan-tool condition:

```text
thinking A → commentary C → read → edit
```

render:

```text
◉ thinking A

C rendered by Pi's native assistant Markdown at full width

◉ Thinking...
├─ Read 1 file
╰─ Edit 1 file
```

The placeholder is a fixed presentation node, not a semantic thinking item. Commentary remains exactly where the model emitted it. If the condition is not met, existing action-root or native-fallback rules remain in force.

Requirements:

1. Validate `TextSignatureV1` exactly (`v === 1`, non-empty `id`, `phase === "commentary"`).
2. Reuse Pi's native Markdown child and full width.
3. Preserve exact source position and all Markdown/OSC behavior.
4. Do not summarize, truncate, italicize, or relabel commentary.
5. Do not change its signature to `final_answer`.
6. Do not move it after tool calls.
7. Resume a fresh chapter after it only when later validated work exists.
8. Keep unknown and in-progress text native and unsplit.

“Final text” in this plan means ordinary full-width assistant presentation, not final-answer semantics.

## 6. Read-only session projection

Cross-turn grouping cannot be proven from private TUI children alone. Add a small public-API session index.

### Implemented module

```text
src/session-projection.ts
```

Suggested pure inputs:

```ts
type SessionProjectionInput = {
  readonly entries: readonly SessionEntry[];
  readonly leafId: string | null;
};
```

Suggested output:

```ts
type ProjectedAssistantTurn = {
  readonly entryId: string;
  readonly toolCallIds: readonly string[];
  readonly resultEntryIds: readonly string[];
  readonly hasVisibleThinking: boolean;
  readonly hasCommentary: boolean;
  readonly boundaryBefore: boolean;
  readonly boundaryAfter: boolean;
};

type ProjectedWorkSpan = {
  readonly stableKey: string;
  readonly turns: readonly ProjectedAssistantTurn[];
};
```

These are extension-owned records, not attributes added to Pi objects. The final types should expose only the minimum immutable metadata needed by the renderer. Do not retain a full `AssistantMessage` reference or copy tool outputs, thinking text/signatures, written content, diffs, or provider payloads.

### Data source

On `session_start`, capture read-only callbacks that use:

```ts
ctx.sessionManager.buildContextEntries();
ctx.sessionManager.getBranch();
ctx.sessionManager.getLeafId();
```

Prefer `buildContextEntries()` for the displayed active compaction-aware path. Use `getBranch()` only when information omitted by compaction projection is required to identify a hard boundary. Never parse the JSONL file during live rendering.

### Lifecycle use

Public events may invalidate ephemeral projection state:

- `message_end`;
- `turn_end`;
- `agent_end` / `agent_settled`;
- compaction completion;
- session start/shutdown and replacement flows.

Handlers must not return mutations or alter messages. Their only job is to discard/rebuild presentation indexes and request normal rendering when Pi already does so.

### State lifetime

- state is session-local and in memory;
- clear it on shutdown/reload/new/resume/fork/tree navigation;
- persist no custom entries;
- inject no custom messages;
- hold no references after uninstall.

## 7. Component-to-session matching

The renderer still operates on Pi's actual components. Match session records conservatively:

1. Prefer exact assistant message object identity when Pi supplies the same object from the active entries.
2. Otherwise use a session-unique set/order of validated tool-call IDs.
3. Require all IDs to be non-empty and unique.
4. Require assistant provider/model/content metadata to agree when used as a secondary check.
5. Never match by text, timestamps, tool names, or array position alone.
6. If more than one entry could match, keep all affected rows native.

Streaming messages not yet available in the session projection stay per-turn/native until a unique match exists.

All private component-field inspection remains confined to `src/pi-adapter.ts`. `session-projection.ts` must use only public session/message types.

## 8. Pure projection model changes

Introduce a model above `StoryboardScene` rather than weakening scene ownership:

```ts
type StoryboardWorkSpan = {
  readonly scenes: readonly StoryboardScene[];
  readonly chapters: readonly StoryboardChapter[];
  readonly state: SceneState;
};

type StoryboardChapterItem =
  | { readonly type: "thinking"; ... }
  | { readonly type: "synthetic-thinking-placeholder"; ... }
  | { readonly type: "action"; ... };

type StoryboardBreakout =
  | { readonly type: "commentary"; ... }
  | { readonly type: "native-boundary"; ... };
```

Key invariant:

> A normal work span contains one scene. The only multi-scene span is the constrained empty-thinking continuation: its first scene has visible thinking, later scenes have only settled actions, and every tool snapshot remains owned by exactly one original assistant response.

Do not flatten ownership into one combined call-ID set. A continuation is a visual layout span, not a reconstructed agent run.

## 9. Rendering algorithm

For each validated work span:

1. flatten only its presentation items in source order;
2. split at commentary/native breakouts;
3. render the first visible thinking as `◉`;
4. render later visible thinking as `○` continuation steps;
5. omit empty/absent thinking presentation, except for the specific commentary-suffix placeholder;
6. when the same response has visible thinking followed by validated commentary and an immediately following eligible tool run, insert one fixed `Thinking...` presentation node after the commentary and before that run;
7. if no thinking exists before actions and the exception does not apply, promote the first action group to `◉` root;
8. for an allowed empty-thinking continuation, keep the first visible thinking as the only root and append later action groups without merging their turn boundaries;
9. merge adjacent compatible action runs only within the original validated turn;
10. calculate the final meaningful item and apply `╰─` there;
11. derive aggregate state with `running > failed > complete > note`;
12. retain each `●` row's individual state;
13. width-check every final line;
14. preserve native mouse regions for every visible native assistant child and use a mouse sink for the synthetic placeholder.

Commentary is rendered outside this width budget at normal native assistant width.

## 10. Optional long-span windowing

Do not ship this in the first implementation phase.

After work-span grouping is stable, allow long completed spans to collapse successful middle chapters:

```text
◉ first step
├─ initial actions
│
│ … 12 completed steps · 19 actions collapsed …
│
○ latest step
╰─ latest actions
```

Eligibility:

- chapter is fully settled and successful;
- no commentary/final/unknown text;
- no errors, aborts, truncation, diagnostics, or running tools;
- not adjacent to the current streaming turn;
- exact hidden chapter/action count is available.

Expanded mode must restore Pi's complete native rows. Any local chapter toggle must be ephemeral and keyed by stable active-path entry IDs.

## 11. Native fallback matrix

Render the complete affected region natively when:

- session entries cannot be mapped to components uniquely;
- the active path changes during projection;
- compaction or branch boundaries are uncertain;
- call IDs are missing, duplicated, or mismatched;
- a result is missing after settlement;
- commentary phase is invalid/unknown;
- an unsupported content block occurs;
- a custom entry is rendered between candidate scenes;
- any row is expanded;
- private assistant/tool/container shape changes;
- native child mouse layout cannot be reconstructed;
- width calculations or a renderer throw;
- a streaming response has not settled enough to classify safely.

Fallback granularity should be the smallest region that remains provably correct. If reduced-width rendering has already occurred for an owner that later fails validation, rerun the complete native container as the current adapter does.

## 12. Safety invariants

The optimized extension must never:

- mutate `AssistantMessage.content`;
- remove or combine thinking signatures;
- change text phases;
- alter tool calls, arguments, execution, results, or ordering;
- append session/custom entries;
- inject context/messages;
- modify compaction, branching, model selection, prompts, or thinking level;
- inspect private lower-level harness run IDs;
- read session JSONL files from the renderer;
- perform network, subprocess, timer, or background work;
- copy successful tool output, edit text, diffs, patches, or full errors into projection state.

Allowed new behavior:

- read the active session through public read-only APIs;
- listen to public lifecycle notifications for cache invalidation;
- retain minimal ephemeral IDs/boundaries in extension-owned objects for presentation;
- arrange validated native children and compact summaries differently;
- insert the fixed `Thinking...` placeholder for the narrowly defined same-response commentary suffix, without creating a Pi message, session entry, or native assistant child.

Explicitly prohibited:

- adding private properties to `AssistantMessage`, `ToolExecutionComponent`, or any other Pi object;
- modifying `message.content`, tool rows, session entries, or `ctx.sessionManager`;
- persisting the projection as a custom entry or sending it to the model.

## 13. Implementation phases

### Phase A — fixtures and pure session analysis

1. Add checked-in minimal session-entry fixtures for:
   - multi-turn tool chains;
   - empty and absent thinking;
   - custom entries between call and result;
   - commentary before tools;
   - compaction and branch boundaries;
   - dangling/error calls;
   - parallel multi-call results.
2. Implement `session-projection.ts` as a pure module.
3. Verify active-path and boundary behavior without TUI imports.

### Phase B — work-span model

1. Keep `StoryboardScene` unchanged as the ownership unit.
2. Add pure work-span/chapter construction above scenes.
3. Add empty-thinking suppression and action-root rules.
4. Add same-kind merging only within the validated turn.

### Phase C — commentary breakout

1. Split ordered assistant content at validated commentary.
2. Render commentary through its native child at full width.
3. Close/reopen chapter rails without moving source content.
4. Preserve native commentary mouse/OSC behavior.

### Phase D — adapter integration

1. Pass read-only session projection callbacks from `src/index.ts`.
2. Invalidate indexes on public lifecycle/session events.
3. Match active entries to components conservatively.
4. Retain the single guarded `Container.prototype.render` private seam.
5. Keep session mapping logic outside private component inspection.

### Phase E — live/restore parity

Verify identical settled output after:

- live streaming completion;
- `/resume`;
- `/tree` branch navigation;
- `/compact` and automatic compaction;
- `/fork`, `/clone`, `/new`, and `/reload`;
- queued steer/follow-up messages;
- model and thinking-level changes.

### Phase F — optional long-span windowing

Implement only after A–E pass and interactive output is approved.

### Phase G — commentary-suffix placeholder (implemented)

The approved placeholder policy is implemented:

1. add the presentation-only placeholder to the pure work-span model;
2. render it after a complete full-width commentary breakout and before the immediately following eligible tool run;
3. keep the placeholder out of session projection, native component children, model context, and mouse targets;
4. verify long commentary, multiline Markdown, source order, expansion, streaming, and native fallback.

## 14. Test matrix

### Session structure

- active branch differs from raw append order;
- multiple roots/unknown entry types fail open;
- latest and installed compaction shapes;
- branch and compaction summaries;
- hidden and visible custom entries;
- model/thinking/label/session-info entries between call and result.

### Ownership

- exact one-call result;
- parallel calls and source-ordered results;
- completion-order tool events do not affect order;
- duplicate/missing/extra IDs;
- historical error with dangling call;
- currently running call without result.

### Work spans / turn splitting

- one-turn storyboard;
- separate adjacent visible-thinking turns remain separate;
- visible thinking on every turn;
- visible thinking followed by one or many settled empty/absent turns continues under one root;
- leading empty/absent turn uses action root;
- hard boundaries stop continuation;
- same-kind tools merge only within one turn;
- visible thinking breaks action merging;
- user/custom/native boundaries remain native.

### Commentary

- commentary before tools;
- future interleaved tool → commentary → tool;
- multiple commentary blocks;
- headings, lists, code fences, tables, links, OSC sequences;
- commentary remains full-width and source ordered;
- same-response `thinking → commentary → tools` inserts exactly one fixed `Thinking...` placeholder before the eligible tool run;
- long commentary does not receive a rail or become truncated to make room for tools;
- commentary-only responses do not receive the placeholder;
- separate assistant turns do not receive the placeholder through adjacency alone;
- unknown/malformed signatures stay native;
- streaming unknown phase reflows only after validation.

### Interaction

- thinking click/toggle regions;
- global tool expansion and collapse;
- running edit remains compact and never invokes native preview while collapsed;
- expanded edit restores native diff;
- theme and terminal-width changes;
- widths 1–200;
- mouse coordinates after commentary breakout and multi-scene rails.

### Architecture

- no session writes or message mutations;
- no model-facing tools;
- no network/filesystem/subprocess/timer work;
- session references released on shutdown;
- incompatible Pi versions fail open;
- original `Container.render` restored safely.

## 15. Documentation changes after implementation

After implementation:

1. keep `README.md` and `STORYBOARD_PLAN.md` aligned with one-storyboard-per-turn ownership plus the narrow empty-thinking continuation;
2. retain the active-path projection as a read-only validation layer;
3. keep preview coverage for suppressed thinking, action roots, empty-thinking continuation, commentary breakout, the commentary-suffix placeholder, and hard-boundary fallback;
4. document that arbitrary cross-turn aggregation is not enabled without a durable public run boundary;
5. document the commentary-suffix placeholder's fixed wording and exact trigger.

## 16. Acceptance criteria

The implementation is ready only when:

- every validated assistant response retains its own scene and tool ownership;
- adjacent settled empty/absent-thinking tool turns may continue beneath the previous visible-thinking root only when all continuation checks pass;
- empty/absent thinking does not create fake thinking content, except for the explicitly presentation-only commentary-suffix placeholder;
- a validated same-response `thinking → commentary → eligible tools` suffix renders full commentary first, then `◉ Thinking...`, then the tool groups under `├─`/`╰─`;
- visible thinking remains complete, source ordered, and state-colored;
- commentary renders full-width at its exact source position;
- each tool remains owned by its original assistant response;
- live and restored settled transcripts match;
- branch/compaction/custom boundaries are respected;
- expansion restores Pi's complete native rendering;
- every ambiguous case fails open;
- all checks and package validation pass.
