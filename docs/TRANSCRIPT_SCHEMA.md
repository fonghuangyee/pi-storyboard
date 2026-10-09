# Pi transcript schema reference

**Status: development-only reference; not a runtime validator or new compatibility claim.** Implementation truth remains [ARCHITECTURE.md](ARCHITECTURE.md). The explicit-root implementation is documented there; [STORYBOARD_TRANSFORMATION_PLAN.md](STORYBOARD_TRANSFORMATION_PLAN.md) records its completed automated work and pending interactive release checks.

## 1. Sources and version profiles

Pi publishes TypeScript definitions and prose, not one universal closed JSON Schema covering every extension/provider/version. Our [JSON Schema](../schema/pi-session.schema.json) is a reviewed translation of the persisted-record definitions, including every known entry and coding-agent message role at the following upstream snapshot. It is not an upstream-issued schema.

| Profile | Evidence | Meaning |
|---|---|---|
| Project baseline | `v0.85.1`, commit `d981de1229ef899957bbe968bc8dcda02a21f477`; installed declarations | Existing development/test target; unchanged by this investigation |
| Declaration sync baseline | `schema/pi-transcript-types.json`; installed `pi-coding-agent`, `pi-ai`, and `pi-agent-core` `0.85.1` declarations | Exact tracked public type declarations; not a complete persisted or live transcript schema |
| Upstream reference | `main` resolved to `6fb2e7815167e6b19006fc526d1a5d0f5f998787` | Schema reference only; not a promise that the private adapter supports this runtime |
| Incident | Session `01a11e5e-3df5-7180-9d24-1a976a258c67`, header version `3` | Observed data; producer package version is not recorded in the header |

Pinned upstream sources:

- [Session entry definitions](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/src/core/session-manager.ts)
- [Messages, blocks, usage, deferred handles, nested calls, tool declarations](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/ai/src/types.ts)
- [Coding-agent roles](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/coding-agent/src/core/messages.ts)
- [Extensible AgentMessage](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/agent/src/types.ts)
- [Diagnostics](https://github.com/earendil-works/pi/blob/6fb2e7815167e6b19006fc526d1a5d0f5f998787/packages/ai/src/utils/diagnostics.ts)
- [Baseline session definitions](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/coding-agent/src/core/session-manager.ts)
- [Baseline message definitions](https://github.com/earendil-works/pi/blob/d981de1229ef899957bbe968bc8dcda02a21f477/packages/ai/src/types.ts)

Human-facing references (moving URLs, not version pins): [session format](https://pi.dev/docs/latest/session-format), [message types](https://pi.dev/docs/latest/message-types), [JSON events](https://pi.dev/docs/latest/json), [SDK](https://pi.dev/docs/latest/sdk).

### Important drift

The installed `0.85.1` declarations do **not** include all features described by current documentation or seen in this session:

- `SystemMessage` and its prompt/tool patches;
- persisted `usage` and `context_edit` entries;
- compaction `systemMessage` checkpoints;
- assistant `thinkingLevel` and `durationMs`;
- result `nestedCalls` and `durationMs`.

The baseline result type also exposes `addedToolNames`, absent from the reviewed latest result definition. Additional properties intentionally remain allowed, so historical fields are not discarded. The live projector already recognizes system messages as boundaries and the exact context-edit deletion shape as a boundary; that is narrower than the full upstream schema. `usage` is currently unknown to that projector and fails open. Schema recognition must not silently enlarge runtime eligibility.

A session's `version: 3` identifies the storage/migration generation, **not** the exact producer API, provider, private TUI shape, or feature set.

## 2. Three different data surfaces

### Persisted session JSONL

Apply `schema/pi-session.schema.json` to **one parsed record per line**. It is not a schema for a JSON array, an entire JSONL byte stream, or RPC events.

- First record: `SessionHeader`, metadata only; its `id` is the session ID, not a tree-entry ID.
- Subsequent records: tree entries with `type`, `id`, `parentId`, and ISO timestamp.
- Nested message timestamps: Unix milliseconds.
- Version 1 files require Pi migration; the schema documents modern tree entries and does not implement that migration.
- Split JSONL on LF, not arbitrary Unicode line separators.

### Public active-path snapshot

The extension consumes `ctx.sessionManager.buildContextEntries()`, not session files. Pi selects the active leaf and compaction-aware entries. This is not necessarily append order or a simple parent-linked list after compaction reorders the selected range. Model context replacement/deletion semantics belong to Pi; visible history can still contain original entries. Never substitute `buildSessionContext()` or model-visible replacements for the transcript.

Offline analysis may choose an explicit leaf and walk parents. The final appended record is only a diagnostic leaf candidate, not proof of the leaf currently selected in the TUI.

### Live SDK / JSON / RPC events

These are **not persisted entries** and are intentionally outside the root record schema. `LiveAssistantMessage` is a reusable definition for the full in-process message shape, including `pending`, not a wire-event schema.

- In-process SDK updates may contain cumulative mutable `partial` snapshots.
- JSON/RPC `message_update` is delta-only: `usage` plus `assistantMessageEvent`; cumulative `partial` and `message` are removed.
- Block identity is `contentIndex`; `*_end` and `message_end` are authoritative, not accumulated guesses.
- `toolcall_start` on the wire includes `id` and `toolName`; execution events correlate by `toolCallId`.
- `agent_start/end/settled` and `turn_start/end` are lifecycle events, not durable ownership IDs.
- Persisted assistant messages cannot have `stopReason: "pending"`; deferred messages are allowed by the schema but are not automatically storyboard eligible.

See the pinned upstream `packages/ai/src/types.ts`, `packages/agent/src/types.ts`, and `packages/coding-agent/src/modes/json-event.ts`, plus the JSON reference, for the separate event protocol. This extension does not ingest wire events or reconstruct persisted messages from them.

## 3. Complete known persisted-entry inventory

All entries below include the entry base; `?` means optional in JSON. `details`/`data` remain arbitrary JSON and must not be traversed for ownership.

| `type` | Fields beyond base | Presentation interpretation |
|---|---|---|
| `message` | `message: AgentMessage` | Classify nested role; assistant/result ownership is separately proven |
| `thinking_level_change` | `thinkingLevel: string` | Known non-visible state only |
| `model_change` | `provider`, `modelId` | Known non-visible state only |
| `usage` | `kind`, `provider`, `model`, `usage`, `note?` | Latest upstream accounting entry; currently native/fail-open compatibility boundary |
| `compaction` | `summary`, `firstKeptEntryId`, `tokensBefore`, `details?`, `usage?`, `fromHook?`, `systemMessage?` | Hard boundary; concise caption or native expansion |
| `branch_summary` | `fromId`, `summary`, `details?`, `usage?`, `fromHook?` | Hard boundary |
| `custom` | `customType`, `data?` | Not model context; may still be visibly rendered by another extension |
| `custom_message` | `customType`, `content`, `display`, `details?` | Displayed messages are boundaries; hidden messages do not invent tool ownership |
| `context_edit` | `targetId`, `replacement: null \| { content }` | Latest upstream model-context edit; current adapter accepts deletion only, as hard boundary |
| `label` | `targetId`, `label?` | Omitted label clears it |
| `session_info` | `name?` | Omitted name clears it |

Header fields: `type: "session"`, `version?`, `id`, `timestamp`, `cwd`, `parentSession?`; no `parentId` is required. Entry IDs have no fixed length or UUID/hex pattern requirement.

Unknown entry discriminators are accepted only as a preservation envelope and remain native boundaries. A malformed known entry cannot escape validation by matching the unknown-entry branch.

## 4. Messages and blocks

Known roles: `system`, `user`, `assistant`, `toolResult`, `bashExecution`, `custom`, `branchSummary`, `compactionSummary`. `AgentMessage` is extensible by declaration merging; unknown roles are preservation envelopes, never scenes.

- System: string/text content, optional named `sections` patches, tool declarations/references, timestamp. It is not assistant narrative.
- User/custom: string or text/image array. Custom additionally has `customType`, `display`, optional `details`.
- Assistant: **ordered** text/thinking/tool-call array, API/provider/model, usage, stop reason, timestamp; optional response IDs/model, provider/Pi thinking levels, diagnostics, deferred handle, errors/raw stop reason/endTurn/duration.
- Result: exact `toolCallId`, `toolName`, text/image content, `isError`, timestamp; optional details, usage, nested-call metadata, duration.
- Direct shell (`bashExecution`): command/output/exitCode when defined/cancelled/truncated/timestamp and optional path/context flag. This is **not** an LLM tool result.
- Summary roles contain their summary and source/token metadata; they are boundaries, not assistant responses.

The schema explicitly defines all fields, including `Usage.cost`, diagnostics, deferred handles, nested calls, tool declarations, and content-edit replacement envelopes. It preserves unrecognized additional properties. JSON cannot represent TypeScript `undefined`; optional properties and fields such as undefined shell exit code or cleared labels are omitted, not set to `null` unless the upstream type permits null.

Thinking is allowed to be absent, empty, whitespace-only, redacted, or visible. Empty thinking can carry opaque replay data. Signatures remain immutable and opaque; only a validated `TextSignatureV1` phase is reduced to a presentation enum. `phase` is optional upstream, so a schema-valid text block can still be ineligible for storyboard.

`NestedToolCalls` are tool-owned audit metadata. They are not top-level assistant tool calls, separate native rows, or extra storyboard counts. Never join nested IDs to top-level calls.

## 5. What the schema cannot prove

Schema validity is not storyboard validity. Required semantic checks include:

- header placement, supported migration/version profile;
- unique non-empty entry IDs, acyclic parent graph, selected leaf/path, no cross-root composition;
- compaction retention and branch boundaries;
- exact unique assistant call IDs and matching result IDs within the applicable ownership window;
- complete settled ownership; source order independent of result completion order;
- context-edit target role/content compatibility and deferred lifecycle validity;
- source-block/native-child correspondence, native expansion, mouse layout, and private component compatibility;
- terminal-width safety and approved summary extraction.

Format validation for ISO timestamps requires a validator's date-time format checker. The schema mirrors upstream primitive types rather than imposing invented non-negative counters, tool-specific argument schemas, signature decoding, MIME restrictions, or fixed ID lengths.

This change adds no runtime schema loader, validator dependency, network retrieval, session parser, or model-facing behavior. The schema and incident fixture are maintainer material and remain outside the existing marketplace file list.

## 6. Incident evidence

Reviewed file: `~/.pi/agent/sessions/--Users-fong-Documents-RnD-AsSpring-samples-starter--/2026-10-09T01-54-15-158Z_01a11e5e-3df5-7180-9d24-1a976a258c67.jsonl`.

At inspection: 1 header + 165 entries; 149 messages (57 assistant, 85 result, 5 user, 2 system), 5 thinking-level changes, 5 session-info entries, 4 custom entries, 2 model changes. Walking parents from the final appended entry `25022a7f` selected all 165 entries. This is an explicitly chosen diagnostic path, not a claim about the live selected leaf.

There were 45 tool-bearing responses with no visible thinking on that path. Immediately after user entry `ecc4bdd2` (`ok proceed`):

| Assistant entry | Ordered source | Result count |
|---|---|---:|
| `6ad1d23f` | read, read, bash, web_enable; **no thinking block** | 4 |
| `6ae57703` | fetch_content, bash; **no thinking block** | 2 |
| `d3eaf163` | empty signed thinking, bash | 1 |
| `43e611e9` | read, read, get_search_content, fetch_content; **no thinking block** | 4 |

Every listed call has its exact result ID match. Interleaved custom entries `6c388d06` and `ae382bea` are `web-search-results` state, not `web-search-content-ready` visible messages. Their payload is not a reasoning node or an ownership source.

These source patterns explain the screenshot's former action roots. The original renderer used `renderDirectActionRun` when a work chapter began with an action, and the original tests permitted action-only chapters for leading no-thinking scenes. The implemented pure root policy now adds a distinct inert presentation node for eligible source-empty scenes; native fallback and genuinely render-hidden reasoning are not reclassified. The screenshot also shows configurable generic-argument/path output; settings could not be recovered from the transcript, so this investigation does not claim to diagnose those display choices.

The sanitized [fixture](../test/fixtures/no-thinking-transcript.json) reproduces the four response shapes and the intervening custom-state positions with invented IDs, arguments, output, and signatures. No raw source code, commands, provider payloads, replay signatures, or user-project output is checked in.

## 7. Release-to-release declaration review

Pi does not currently publish a complete universal JSON Schema for persisted sessions. The canonical public material is distributed TypeScript declarations and documentation across `pi-coding-agent`, `pi-ai`, and `pi-agent-core`. `scripts/sync-transcript-schema.mjs` snapshots selected transcript-related declarations from the locally installed packages and compares them with `schema/pi-transcript-types.json`; it makes no network requests and does not run inside the extension.

When reviewing a new Pi release:

1. Update the pinned development package versions and lockfile using the normal dependency workflow.
2. Run `npm run transcript:schema`. Package-version changes and added, removed, or changed tracked declarations are printed in one diff-style report; the command exits nonzero while the reviewed baseline is stale.
3. Review changes to the session-format version constant, entry/message unions, required and optional fields, content block order/types, stop reasons, nested metadata, and extension-added message roles. Separately inspect session projection semantics and the private TUI adapter—the type snapshot cannot prove active-path behavior, component shape, ownership, or safe rendering.
4. Update `schema/pi-session.schema.json`, this document, compatibility decisions, and regression/native tests by hand as needed. Do not infer storyboard eligibility from a newly recognized type.
5. Only after review, run `npm run transcript:schema:update` to refresh the declaration baseline. Review that generated diff and commit it with the corresponding schema/docs/tests.

The helper tracks published `.d.ts` declarations, not source implementation changes or every Pi type. A version-only change is still reported, but is not itself evidence of a transcript break. If Pi later publishes an official schema, review its scope/versioning before adopting it; do not assume it covers provider extensions, SDK events, active-path projection, or private TUI components. Never load a schema or fetch upstream data at extension runtime, and never declare compatibility from a successful schema check alone.
