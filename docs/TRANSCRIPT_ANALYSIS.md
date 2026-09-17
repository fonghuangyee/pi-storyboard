# Transcript analysis: Pi sessions and safer storyboard grouping

## Purpose

This document studies Pi's session model deeply enough to answer a narrower presentation question:

> How can the extension reduce repeated `thinking → tool` cards and group some thinking/tool activity into a smaller storyboard without changing Pi's transcript semantics?

The important distinction is between **semantic ownership** and **visual grouping**:

- a tool call belongs to exactly one assistant response and is joined to its result by `toolCallId`;
- several validated assistant/tool turns may still be displayed inside one larger presentation-only work sequence;
- that larger sequence is not a Pi turn, agent run, session entry, or model-facing object.

## Sources reviewed

### Official and installed documentation

- Official latest session format: <https://pi.dev/docs/latest/session-format>
- Installed Pi extension documentation: `docs/extensions.md`
- Installed Pi SDK documentation: `docs/sdk.md`
- Installed Pi session-format documentation: `docs/session-format.md`
- Installed SDK session example: `examples/sdk/11-sessions.ts`

### Installed implementation and types

The project currently tests against `@earendil-works/pi-coding-agent` **0.85.1**. The following installed files were checked:

- `dist/core/session-manager.d.ts`
- `dist/core/session-manager.js`
- `dist/core/extensions/types.d.ts`
- `dist/modes/interactive/interactive-mode.js`
- `dist/modes/interactive/components/assistant-message.js`
- `dist/modes/interactive/components/tool-execution.js`
- the bundled `pi-ai` OpenAI Responses adapter and message types
- the bundled agent-core lifecycle and harness types

### Local corpus

All 15 JSONL sessions under:

```text
~/.pi/agent/sessions/--Users-fong-Documents-FHY-pi-tool-groups--/
```

were scanned. The mixed-phase session used by the replay fixture was also reviewed separately:

```text
~/.pi/agent/sessions/--Users-fong-Documents-FHY-selfapprove-selfapprove--/
2026-09-16T12-32-57-547Z_01a0aa34-baca-753f-a85a-486dd8566423.jsonl
```

The corpus numbers below are a snapshot taken during this study. One of the files was the active session and continued growing afterward.

## Version warning: “version 3” is not a complete feature flag

Every reviewed local file has a version-3 header, but the official latest schema has evolved additively beyond the installed 0.85.1 declarations.

Examples from the official latest page include:

- `SystemMessage` entries and replayable prompt/tool state;
- `AssistantMessage.stopReason: "deferred"` and a deferred handle;
- optional assistant fields such as `responseId`, `providerThinkingLevel`, `rawStopReason`, and `endTurn`;
- compaction system-prompt checkpoints;
- roots created after `resetLeaf()` or root-level branch operations.

The installed 0.85.1 session manager and its local sessions do not expose all of those fields. The installed package documentation and official latest page also describe different generations of compaction checkpoint data.

Consequences:

1. Do not hard-code the complete schema from one documentation snapshot.
2. Do not assume that session version 3 means every optional latest field exists.
3. Use Pi's public `SessionManager` projections where possible.
4. Feature-detect optional fields and preserve unknown entries.
5. Never rewrite a session file merely to support presentation grouping.

## Terminology

The following terms must remain distinct:

| Term | Meaning |
|---|---|
| session file | Append-only JSONL containing a header and tree-linked entries |
| entry | One JSONL tree node with `id`, `parentId`, and `timestamp` |
| active branch | The root-to-current-leaf path selected by Pi |
| message entry | An entry containing one `AgentMessage` |
| assistant response | One `AssistantMessage` with an ordered `content` array |
| Pi turn | Runtime unit: one assistant response plus that response's tool calls/results |
| agent run | Runtime processing started for a prompt; it may contain many Pi turns |
| action run | This extension's adjacent same-kind compact tool rows |
| work span | Proposed presentation-only chain of validated Pi turns |
| chapter | Proposed visible-thinking/action portion of a work span, bounded by narrative text or another hard boundary |

A work span and chapter are UI terms only. They must never be presented as persisted Pi identities.

## 1. Session storage is an append-only tree

A session starts with a metadata header. Every later entry normally has:

```ts
interface SessionEntryBase {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
}
```

`parentId` gives tree ancestry. It does **not** mean:

- a tool result belongs to that parent's assistant message;
- two adjacent assistant responses share a runtime run;
- a thinking block owns the next call;
- an entry is visually nested beneath another entry.

The current leaf selects one path through the tree. Raw file order contains abandoned branches as well as the active path, so a parser must not treat JSONL line order as the displayed conversation.

Use the public APIs according to intent:

- `getEntries()` — every entry in append order, including abandoned branches;
- `getBranch()` — the current root-to-leaf path without compaction filtering;
- `buildContextEntries()` — the active compaction-aware entry projection used for context/rendering;
- `buildSessionContext()` — the corresponding model-facing messages and restored settings.

The installed `SessionManager` rebuilds the current leaf from the last appended entry when loading. `getBranch()` then follows `parentId` links back to a root and reverses that path.

### Compaction and branch summaries are hard presentation boundaries

Compaction does not merely insert an ordinary assistant message. It replaces an earlier context range with a summary/checkpoint while retaining selected entries. Branch summaries likewise represent navigation from an abandoned path.

A storyboard must not join work across:

- compaction entries or compaction-summary messages;
- branch-summary entries or messages;
- broken parent chains, multiple roots that cannot be resolved, or unknown checkpoint shapes.

This is true even if the rendered components happen to look adjacent.

## 2. Entry types and context participation

Relevant persisted entry classes include:

- `message` — user, assistant, tool result, and version-dependent message roles;
- `custom_message` — extension message that participates in model context;
- `custom` — extension state/display entry that does not participate in model context;
- `compaction` and `branch_summary`;
- `model_change` and `thinking_level_change`;
- `label` and `session_info`;
- latest-schema system-message state.

A plain `custom` entry is context-neutral, but it is not automatically visually invisible. An extension may register an entry renderer for it. Therefore a grouping algorithm needs both views:

1. the active session path, to detect hidden semantic boundaries and validate ownership;
2. the actual component stream, to detect visible custom/native boundaries.

The local corpus demonstrates why raw adjacency is insufficient. In one recorded sequence, assistant entry `d85c2a68` is followed by two `web-search-results` custom entries and only then by its two `fetch_content` results and one `bash` result. The custom entries do not invalidate the `toolCallId` relationship, but a visible custom renderer would still need to break the visual storyboard.

## 3. Assistant content is ordered; tool results are separate messages

An assistant response contains an ordered array:

```ts
AssistantMessage.content = (
  | TextContent
  | ThinkingContent
  | ToolCall
)[];
```

That order is authoritative for source presentation. Examples include:

```text
thinking → toolCall → commentary → thinking → toolCall
thinking → commentary → toolCall → toolCall
thinking → final_answer
```

A tool result is a separate message:

```ts
interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  ...
}
```

Ownership is established through exact `ToolCall.id === ToolResultMessage.toolCallId`, not timestamps, positions, names, or parent IDs.

Pi's default parallel tool mode can finish tools out of order. The extension documentation guarantees that execution-end events may interleave in completion order while finalized `toolResult` message events are emitted later in assistant source order. Presentation should still map by ID and use the assistant's content order rather than relying on that ordering guarantee alone.

### Local ownership result

At the frozen scan point:

- 1,824 assistant responses contained tools;
- those responses contained 2,570 tool calls;
- 1,822 responses had a complete exact source-ordered result set after context-neutral custom/state entries were skipped;
- one historical error response had a dangling call and no result;
- one response was actively pending and had no result yet.

No completed response needed name- or position-based guessing. Ambiguous or incomplete cases must remain native.

## 4. Pi turns and agent runs are runtime concepts

Pi's extension and SDK documentation define a turn as:

> one LLM response + tool calls

The lifecycle is conceptually:

```text
agent_start
├─ turn_start
│  ├─ assistant response
│  ├─ tool executions/results
│  └─ turn_end(message, toolResults)
├─ turn_start
│  └─ ...
└─ agent_end
```

The public extension `turn_start`/`turn_end` events expose `turnIndex`; they do not expose a durable session run ID. The installed lower-level harness has internal operation/run/turn IDs, but those are not stable public coding-agent session fields and are not persisted in the reviewed JSONL message entries.

Other fields are not substitutes:

- `responseId` identifies a provider response, not an agent run;
- `stopReason: "toolUse"` says the response called tools, not which larger run owns it;
- latest `endTurn` is explicitly documented as provider diagnostic information that does not currently control Pi's loop;
- timestamps cannot establish ownership;
- adjacency alone misses hidden custom messages and tree/compaction boundaries.

Therefore exact historical agent-run reconstruction is not available from these session files. A larger grouping must use a deliberately weaker and truthful concept: a **presentation-only work span** defined by transcript structure.

## 5. What Pi's native TUI does

`InteractiveMode` renders an assistant component and then creates one `ToolExecutionComponent` for every `toolCall` in that assistant message. Persisted `toolResult` messages update those components and are not rendered as separate transcript rows.

`AssistantMessageComponent` renders only visible text and thinking. It skips tool-call blocks. This can flatten a source interleave because assistant children and tool rows are separate TUI children; the extension currently reconstructs the original sequence from `AssistantMessage.content` and exact call IDs.

### Empty thinking natively

Pi's native assistant renderer:

1. groups consecutive thinking blocks;
2. trims their visible text;
3. skips the run completely when every block is empty;
4. adds no assistant spacer when no text/thinking is visible.

The native `Thinking...` label is used only when a **non-empty** thinking run is hidden by the user's thinking visibility setting. It is not shown for empty or absent thinking.

Accordingly, this extension's current `Thinking...` header for a tool-only response is synthetic presentation, not native Pi behavior.

## 6. Empty thinking is visually empty but not semantically disposable

The OpenAI Responses adapter creates a `ThinkingContent` slot with `thinking: ""` when a reasoning output item starts. When the item completes, it stores the provider reasoning item in `thinkingSignature`, even if there is no visible summary text.

In the local snapshot:

- 123 tool-bearing assistant responses had an explicit empty thinking block;
- every one had a reasoning signature;
- every inspected signature had `type: "reasoning"`, non-empty encrypted content, and an empty summary array;
- another 155 tool-bearing responses had no thinking block at all;
- 1,546 had visible thinking.

Thus `thinking: ""` does not mean “delete this content block from the transcript.” Its opaque signature may be required for provider replay and continuity.

Safe operation:

- suppress or replace its **visual placeholder**;
- retain the original block, order, signature, and message unchanged.

Unsafe operation:

- delete it from session/context;
- concatenate its signature into another thinking block;
- move its tools into another assistant response;
- claim it is the previous response's reasoning.

## 7. Text phases: commentary is narrative, not thinking

The installed `pi-ai` type defines:

```ts
interface TextSignatureV1 {
  v: 1;
  id: string;
  phase?: "commentary" | "final_answer";
}
```

The OpenAI Responses adapter preserves provider output order and stores this phase in `textSignature`.

The local corpus contained:

- 38 commentary blocks;
- 122 final-answer blocks;
- no visible unknown-phase text in these OpenAI Codex sessions.

All 38 local commentary blocks occurred in tool-bearing responses, after one or more visible thinking blocks and before one or more tool calls. The most common shapes were `thinking → commentary → tool` and `thinking → commentary → multiple tools`. The largest commentary block was 2,789 characters over 52 lines; the median was 156 characters.

These observations do not create a schema rule. Future providers or sessions may interleave commentary elsewhere.

### Presentation conclusion for commentary

Commentary is user-facing native Markdown. It need not be drawn inside a thinking rail.

A safer and cleaner display is:

1. keep commentary at its exact source-order position;
2. render it full-width with Pi's ordinary native assistant Markdown presentation;
3. close the storyboard chapter before it;
4. resume a new storyboard chapter after it when later actions/thinking exist.

“Display like final text” must mean **final-answer-like visual treatment only**. The extension must not:

- rewrite the phase to `final_answer`;
- move commentary to the end of the response;
- delay or duplicate it;
- collapse or summarize its Markdown;
- infer commentary when the signature is missing or invalid.

While streaming, an unsettled/unknown text phase remains native. Reflow is allowed only after a valid phase is available.

## 8. Local work-span finding

A transcript work span was measured conservatively as a maximal active-path chain of:

```text
assistant(with tool calls)
matching tool results by exact ID
assistant(with tool calls)
matching tool results by exact ID
...
```

Context-neutral custom/state entries were allowed between calls and results for ownership measurement. User/custom messages, summaries, unresolved calls, and other semantic boundaries ended the chain.

Frozen snapshot:

| Metric | Count |
|---|---:|
| session files | 15 |
| active-path entries | 4,952 |
| user messages | 138 |
| assistant messages | 1,952 |
| tool-result messages | 2,568 |
| tool-bearing assistant responses | 1,824 |
| validated completed tool turns in measured spans | 1,822 |
| maximal work spans | 126 |
| multi-turn work spans | 106 |
| largest work span | 103 turns |
| custom entries | 175 |
| compaction entries | 12 |
| model-change entries | 32 |
| thinking-level-change entries | 75 |
| branch points in this corpus | 0 |

The absence of branches in this corpus is not permission to ignore tree semantics. Pi officially supports branches, multiple roots in newer APIs, and compaction.

### Why response-per-card is too granular

The current storyboard can produce one root per tool-bearing assistant response. The local snapshot had 1,824 such responses but only 126 structural work spans. Most user tasks therefore contain many assistant/tool cycles.

Within the 1,822 completed turns in measured spans:

- 278 turns had empty or absent visible thinking and currently need synthetic headers;
- 274 of those occurred after visible thinking already existed earlier in the same validated span;
- only 4 spans began without visible thinking.

If empty/absent turns inherit only the **visual work-span context**—not semantic thinking ownership—the repeated placeholder count could fall from 278 to 4. If a leading action group is allowed to be its own root, all synthetic `Thinking...` text can be removed.

This is the strongest evidence for introducing a presentation work span above individual Pi turns.

## 9. Proposed grouping model

### Layer 1: exact Pi turn ownership

Retain the current strict unit internally:

```text
assistant response + exact toolCallId set + matching tool rows/results
```

Never merge or rewrite these source records.

### Layer 2: presentation work span

Combine adjacent validated turn projections under one outer storyboard only when:

- they are consecutive on the active branch;
- every turn's call/result ownership is complete and unique;
- no user, system, custom message, summary, compaction, branch, visible custom-entry component, or unknown native component separates them;
- source-order reconstruction succeeds for every included turn;
- no row is expanded or otherwise requires native fallback.

The outer rail means only:

> these validated work turns are consecutive in the displayed transcript with no intervening narrative boundary

It does not mean they share a persisted run ID.

### Layer 3: visible-thinking chapters

Inside a work span:

- the first visible thinking run starts the root;
- later visible thinking runs become continuation steps (`○`) rather than new top-level cards;
- empty/absent thinking adds no text and no synthetic step;
- same-kind tool rows may merge across an empty turn boundary when no visible source item intervenes;
- different tool kinds remain separate action runs;
- commentary breaks out as full-width native prose and starts a new chapter afterward;
- final/unknown text ends the work span and remains native.

Example:

```text
 ◉ Inspecting the renderer
 ├─ Read 3 files
 │
 ○ Verifying the ownership map
 ├─ Edit 2 files
 ╰─ Run 1 command
```

An empty-thinking turn between the edit and command contributes no fake title:

```text
 ◉ Verifying the implementation
 ├─ Edit 3 files
 ╰─ Run 1 command
```

A span beginning without visible thinking should prefer a truthful action root over invented prose:

```text
 ◉ Edit 3 files
 ╰─ Run 1 command
```

### Commentary breakout

For source order:

```text
thinking → commentary → read → edit
```

render:

```text
 ○ native thinking

native commentary Markdown at full width

 ◉ Read 1 file
 ╰─ Edit 1 file
```

The commentary remains exactly where the model emitted it. The post-commentary action root does not claim the earlier thought semantically owns those tools.

## 10. Long-span compaction in the UI

A work span may contain dozens of turns; the local maximum was 103. One outer rail alone removes repeated roots but does not reduce all vertical volume.

A second, optional presentation optimization can window only **settled successful middle chapters**:

```text
 ◉ first visible step
 ├─ actions
 │
 │  … 12 completed steps · 19 actions collapsed …
 │
 ○ latest visible step
 ╰─ current actions
```

Safety rules:

- keep first and recent chapters visible;
- never hide running, failed, aborted, truncated, commentary-adjacent, or unknown content;
- report exact hidden chapter/action counts;
- restore full native output through Pi's existing expansion mode;
- keep this as ephemeral UI state only;
- do not modify or compact session/model context.

This should be implemented only after work-span grouping and commentary breakout are proven stable.

## 11. Required architecture change

The current guarded render seam can prove one assistant/tool batch, but component adjacency alone cannot see hidden session entries, active-branch selection, or compaction boundaries.

Safe cross-turn grouping therefore requires a small **read-only session projection**:

- obtain `ctx.sessionManager` on `session_start`;
- read `buildContextEntries()`/`getBranch()` only;
- subscribe to public lifecycle events only to invalidate/rebuild ephemeral projection state;
- never append, replace, inject, or mutate an entry/message;
- clear all projection state on `session_shutdown`, resume, fork, new session, reload, and tree navigation;
- continue isolating all private TUI component inspection in `src/pi-adapter.ts`;
- join projected entries to components only through exact object identity and/or unique validated tool-call IDs;
- fail open when the mapping is incomplete or ambiguous.

This deliberately relaxes the old “never read session state or use lifecycle hooks” architecture rule. It does **not** relax the more important presentation-only rule: no agent, context, tool, or session behavior may change.

Internal harness `runId`/`turnId` fields are not an acceptable shortcut. Use only public extension/session APIs.

## 12. Rejected grouping signals

Do not group across turns based solely on:

- visual adjacency;
- timestamps or short time gaps;
- matching provider/model/response IDs;
- `stopReason`;
- entry `parentId`;
- similar thinking text;
- identical tool names;
- the absence of visible user text;
- private harness run/turn IDs.

These may be supporting diagnostics, never ownership proof.

## 13. Final conclusion

The current assistant-response storyboard is semantically exact but visually too fine-grained for real Pi sessions. Local history shows that long chains of assistant/tool turns are normal and that almost every empty-thinking turn follows visible thinking inside the same transcript work sequence.

The safe optimization is not to merge assistant messages or thinking signatures. It is to add a larger, explicitly presentation-only work-span layer while preserving each Pi turn internally.

Recommended presentation changes:

1. group consecutive validated tool turns into one outer work span;
2. show later visible thinking as continuation steps rather than new cards;
3. omit empty/absent thinking placeholders inside an established span;
4. use an action-root when a span starts without visible thinking;
5. render validated commentary full-width like ordinary final text, at its original position, then resume a new storyboard chapter;
6. optionally window settled middle chapters for very long spans;
7. fail open at every session, ownership, phase, component, expansion, or renderer ambiguity.

The implementation sequence and acceptance criteria are defined in [`STORYBOARD_GROUPING_OPTIMIZATION_PLAN.md`](./STORYBOARD_GROUPING_OPTIMIZATION_PLAN.md).
