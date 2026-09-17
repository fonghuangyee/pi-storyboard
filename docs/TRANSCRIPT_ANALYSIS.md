# Transcript analysis: Pi turns, ordered assistant output, and tool rows

## Inputs reviewed

- Session: `01a0a830-040b-7266-8b72-ba8c6581a269`
- Transcript: `/Users/fong/.pi/agent/sessions/--Users-fong-Documents-FHY-pi-tool-groups--/2026-09-16T03-08-34-187Z_01a0a830-040b-7266-8b72-ba8c6581a269.jsonl`
- Mixed-phase session: `/Users/fong/.pi/agent/sessions/--Users-fong-Documents-FHY-selfapprove-selfapprove--/2026-09-16T12-32-57-547Z_01a0aa34-baca-753f-a85a-486dd8566423.jsonl`
- Pi documentation: `docs/extensions.md` and `docs/session-format.md`
- Installed agent-core lifecycle implementation and type declarations
- Screenshots supplied during analysis, including the 5:14 PM, 9:59 PM, 10:31 PM, and 11:18 PM captures.

## Pi has turns, but no persisted visual master

Pi's lifecycle documentation distinguishes a low-level agent run from repeated turns:

```text
agent_start
├─ turn_start
│  ├─ assistant response
│  ├─ tool calls/results
│  └─ turn_end
├─ turn_start ...             repeats while tools continue
└─ agent_end
```

The documentation defines a turn as “one LLM response + tool calls.” Agent-core telemetry calls the same unit “One assistant response and its tool batch.” `turn_end` carries the assistant message and its tool results.

Pi's JSONL session format nevertheless has no `master`, storyboard, or enclosing turn entry. It stores ordered assistant messages and separate tool-result messages. Session entry `id`/`parentId` represents branching, not visual ownership.

The extension can therefore truthfully project one validated assistant response and its matching tool rows as a **visual turn block**, but it must not claim Pi persisted a master object. A later assistant response begins the next block. Those blocks form an ongoing storyboard while each remains explicitly closed.

The current guarded render seam does not receive lifecycle `runId`/`turnId`. It cannot reliably draw one outer rail across multiple turns in restored sessions, so it does not merge blocks or infer an agent-run boundary from adjacency.

## What Pi's native TUI flattens

`AssistantMessageComponent` renders visible thinking/text content and skips tool calls. `InteractiveMode` appends each corresponding `ToolExecutionComponent` separately afterward. The native component tree can therefore display all assistant content before all tool rows even when the message says:

```text
thinking → read → commentary → thinking → edit
```

The assistant message's `content` array remains authoritative. The extension validates the contiguous direct tool-row window by ID and replays native assistant children plus compact tool runs in that source order. It restores display sequence only; it does not infer that a thought or commentary caused a call.

## Visual conclusion

Native thinking is the visual header for the turn-shaped block:

```text
◉ native thinking                                      N actions
│
├─ compact action run
│  ● tool row
│
│ complete native commentary/thinking continuation
│
╰─ final compact action run
   ● tool row
```

- `◉` indicates a turn with tools; `○` indicates a thinking-only note.
- `├─` means another source child follows.
- `╰─` explicitly closes the final child before the next assistant response.
- `●` retains individual tool state.

The header and count are render-time projections of the validated response/tool batch. They are not new messages or session records. The hierarchy communicates turn membership, not causal ownership.

A tool-only response may contain an empty or absent visible thinking block. The renderer supplies a presentation-only `Thinking...` header so its action remains under a thinking block; no `Tool step` title is invented.

## Thinking runs

Pi may combine consecutive `thinking` blocks into one native Markdown child. The extension keeps that child intact rather than splitting paragraphs. The first native thinking child receives one turn marker, not one marker per wrapped line or paragraph. Later source-ordered thinking remains complete on the turn rail.

Thinking visibility remains controlled by Pi's native global toggle and per-run mouse behavior.

## Commentary and final answers

The canonical Pi AI types define:

```ts
interface TextSignatureV1 {
  v: 1;
  id: string;
  phase?: "commentary" | "final_answer";
}
```

The OpenAI Responses adapter stores this phase in `TextContent.textSignature`.

The 10:31 PM screenshot text beginning:

```text
I’ll separate what Pi’s documented schema proves from what it does not prove...
```

is validated commentary. Its transcript block has a valid V1 signature with `phase: "commentary"`, is followed by tool calls, and its message stops with `toolUse`.

Commentary is user-visible intermediate output, not thinking and not a short-label contract. A scan of local Pi sessions found commentary containing long paragraphs, headings, lists, and fenced code; the largest observed block was 1,748 characters over 65 lines. The complete native Markdown child must remain intact within the turn.

A validated `final_answer` remains complete native Pi output without storyboard decoration. When a no-tool response also contains thinking, the thinking paragraphs receive `○` start markers while the final text stays unprefixed native output. Missing, malformed, legacy, or provider-opaque text signatures remain unknown and fail open for the text itself. Position and `stopReason` are not used to classify an individual text block. Unknown in-progress text also remains native until its phase is validated.

## Width finding

Native content must be rendered after deducting its actual structural gutter. The implemented budgets are:

```text
" ◉" / " │" + Pi-native assistant content
" ├─" / " ╰─" + compact action group
```

At normal widths the assistant gutter is two cells and the branch gutter is three; Pi's own output padding supplies content separation. The renderer passes the reduced width into native thinking/Markdown and compact-group rendering before adding the prefix. This preserves Markdown wrapping, code blocks, tables, links, OSC behavior, and terminal width.

At narrow widths the leading margin is removed. At the smallest width, decoration yields to content.

## Supplied transcript tail

The earlier tail contains these separate assistant messages/turn-shaped batches:

| JSONL entry | Assistant content | Following call |
|---:|---|---|
| 496 | four thinking paragraphs | failed `bash` — `npm run check` |
| 498 | `Inspecting formatRow replacement failure` | settled `edit` |
| 500 | `Running test suite` | successful `bash` — `npm run check` |
| 502 | `Checking ripgrep em dash handling` | successful `bash` — `rg ...` |
| 504 | thinking followed by final text | none |

Entry 496's thinking paragraphs belong to one native thinking run, not separate master records. Its tool batch closes with `╰─`; entry 498 starts the next visual block. Entry 504 is a final-answer response: its final text stays completely native while its preceding thinking paragraphs receive only the safe `○` start markers.

## Fixed replay diagnostic

`/tool-groups-preview` includes **Transcript replay**, built from real Pi components:

- `AssistantMessageComponent` for recorded assistant responses;
- `ToolExecutionComponent` for recorded calls;
- real commentary and final-answer signatures;
- a commentary-before-tools fixture matching the 10:31 PM case;
- an interleaved thinking → read → commentary → thinking → edit fixture;
- deliberately reversed direct tool-row order to verify ID mapping.

The fixture is checked-in data only. The live extension never reads session files, executes tools, or maintains a second transcript.

The independent **Turn storyboard** preview is the fixed visual reference. It demonstrates thinking-led blocks, aggregate action counts, same-colored `│`/`├─`/`╰─` connectors, native commentary Markdown, presentation-only `Thinking...` headers for tool-only turns, compact pending edits with native previews reserved for expansion, bounded continuous-thinking display with a hidden-count line, mixed final-answer thinking markers, and native fallback cases.

## Conclusion

The preferred parent/child appearance is compatible with Pi's documented model when interpreted as a **visual turn projection**. Pi supplies a real assistant-response/tool-batch boundary; the extension supplies only the branch grammar. Each turn ends visibly before the next thinking block begins, while successive blocks can still read as one continuing storyboard. No persisted master record, causal claim, or cross-turn run identity is invented.
