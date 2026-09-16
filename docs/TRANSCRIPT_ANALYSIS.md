# Transcript analysis: missing leading symbols

## Input reviewed

- Session: `01a0a830-040b-7266-8b72-ba8c6581a269`
- Transcript: `/Users/fong/.pi/agent/sessions/--Users-fong-Documents-FHY-pi-tool-groups--/2026-09-16T03-08-34-187Z_01a0a830-040b-7266-8b72-ba8c6581a269.jsonl`
- Real output: `/Users/fong/Desktop/Screenshot 2026-09-16 at 5.14.10 PM.png`
- Approved reference: `/Users/fong/Desktop/Screenshot 2026-09-16 at 4.49.54 PM.png`

The transcript is JSONL. Its `message` entries contain assistant messages,
separate tool-result messages, and the tool-call IDs that connect them. Pi's
session format does not define persisted `master`/`node` entry types; those are
useful visual descriptions, not separate records. The transcript is also not a
list of one assistant message per visible italic line.

## What the screenshot is showing

The top visible scene corresponds to JSONL entry **496**. That one assistant
message contains four visible thinking paragraphs:

```text
Planning detailed width rendering tests
Analyzing user rendering issue with long lines
Confirming separator issue with ANSI widths
Fixing dash separator and rendering check
```

It contains one following Bash call, `npm run check`, whose result is failed.
The next scene boundaries are separate assistant messages:

| JSONL entry | Assistant content | Following call |
|---:|---|---|
| 496 | four thinking paragraphs | failed `bash` — `npm run check` |
| 498 | `Inspecting formatRow replacement failure` | settled `edit` |
| 500 | `Running test suite` | successful `bash` — `npm run check` |
| 502 | `Checking ripgrep em dash handling` | successful `bash` — `rg ...` |
| 504 | two thinking paragraphs followed by final text | none |

The tool-result entries following these messages update the corresponding
`toolCallId`; they do not create another assistant/node header.

## Why some lines have no leading symbol

There are two different cases, and neither means that Pi lost a message.

### 1. Continuation lines inside one assistant message

Pi's `AssistantMessageComponent` renders consecutive `thinking` blocks inside
one component. In the supplied screenshot, the marker on
`Planning detailed width rendering tests` identifies the assistant scene. The
following thinking paragraphs are continuation content from that same
component, so they are indented continuation lines rather than new scene
headers.

The Story Spine renderer follows the approved preview: one `◉` identifies one
assistant message that owns tools. It does not put a new marker on every
wrapped line or every thinking paragraph.

### 2. A mixed thinking + final-text assistant message

Entry 504 has thinking content **and** a final text answer, but no tool calls.
It is not a thinking-only work-note scene. It remains Pi-native, which is why
its thinking and final answer do not receive a Story Spine marker in the real
output.

This is intentional. A final answer must retain Pi's native Markdown, padding,
OSC integration, and error handling. Making every assistant message into a
scene would require a broader visual policy and would decorate ordinary final
answers just to add a marker.

A thinking-only assistant message with no text and no tools is different: it is
a `○` note scene. An assistant message with matching tool calls is a `◉` scene.
A plain final answer remains native and unmarked.

## What the Pi documentation and source establish

The reviewed Pi documentation is:

- `@earendil-works/pi-coding-agent/docs/session-format.md`
- `@earendil-works/pi-coding-agent/docs/tui.md`
- `@earendil-works/pi-coding-agent/docs/extensions.md`

The relevant implementation facts in Pi 0.85.1 are:

1. Session entries form a JSONL tree through `id` and `parentId`. An assistant
   `message` stores an ordered `content` array; tool results refer to calls by
   `toolCallId`.
2. `AssistantMessageComponent` owns the visible assistant content. Its native
   `updateContent()` groups consecutive thinking blocks into a Markdown
   component and adds native spacer/padding rows.
3. `ToolExecutionComponent` is a separate transcript child. It owns the
   call/result display and its native leading spacer, expansion state, and
   renderer state.
4. Pi's public extension APIs support custom messages, custom entries, widgets,
   and individual tool renderers, but do not expose a public API for replacing
   the existing transcript's assistant-plus-following-tools composition.
5. The existing adapter therefore uses only its guarded render-time
   `Container.prototype.render` seam. It reads validated private fields and
   delegates native components; it does not subscribe to agent/message/tool
   events or alter the session.

The important consequence is that the correct ownership unit is the assistant
**message**, not an individual thinking paragraph. The assistant `content`
array is authoritative for presentation order: a thinking block between two
tool calls ends the first contiguous group, even when both calls have the same
semantic kind. The strongest state join key remains each tool-call ID matched
to its tool result/native tool component; it must not be inferred from a
thinking paragraph.

There is an important distinction between transcript order and Pi's default
visual tree. `AssistantMessageComponent` renders the assistant's thinking/text
content and skips `toolCall` blocks. `InteractiveMode` then appends each
`ToolExecutionComponent` to the chat container. Thus Pi's native tree can
flatten an ordered `thinking → tool → thinking → tool` message into assistant
content followed by tool rows, even though the session data retains the exact
order. An exact ordered Story Spine therefore needs a presentation-only
wrapper/projection; it does not require changing the agent, session, message,
or tool structures.

## Preview added for faithful testing

`/tool-groups-preview` now includes **Transcript replay**. It uses a checked-in
fixture of the supplied transcript tail and constructs real Pi components:

- `AssistantMessageComponent` for each recorded assistant message;
- `ToolExecutionComponent` for each recorded tool call;
- a real `Container` holding them in transcript order;
- the installed Story Spine adapter to render that container.

The fixture covers the exact cases above: one assistant message with several
thinking paragraphs and one failed Bash call, separate edit/Bash scenes, and a
mixed thinking-plus-final-text message that stays native. It also includes a
small source-order seam fixture with `thinking → read → thinking → edit`; its
real tool components are deliberately inserted in the opposite direct-child
order to verify ID mapping. The replay has local keyboard scrolling and width
checks so it can be compared with the real terminal output.

The fixture is static by design. The extension does **not** read the session
file at runtime, use `sessionManager`, persist a parallel transcript, execute
tools, or change the approved independent `Storyboard / Spine` sample. The
static sample remains the visual authority; the transcript replay is a
component-fidelity diagnostic.

## Conclusion

The screenshot's unmarked lines are primarily native continuation content, plus
the deliberately native mixed final-answer message. They are not missing
`master/node` records. The transcript itself does provide enough information
to preserve the exact source order for a Story Spine projection. The remaining
constraint is visual: doing that within Pi requires a presentation wrapper
that composes native assistant/tool renderers in content order, while retaining
native fallback for cases the projection cannot safely own. It does not
require changing Pi's harness or inventing causal ownership for thinking
paragraphs.
