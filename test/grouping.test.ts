import { describe, expect, it } from "vitest";
import { hasGroups, segmentChildren, type ChildClassification, type GroupKind } from "../src/grouping.ts";

const candidate = (kind: GroupKind, row: string): ChildClassification => ({
  type: "candidate",
  kind,
  row,
});
const native = (row: string): ChildClassification => ({ type: "native", row });
const invisible = (row: string): ChildClassification => ({ type: "invisible", row });

function shape(input: readonly ChildClassification[]): unknown[] {
  return segmentChildren(input).map((segment) =>
    segment.type === "group"
      ? ["group", segment.kind, segment.rows]
      : ["native", segment.row],
  );
}

describe("segmentChildren", () => {
  it.each([
    [[candidate("read", "a")], [["group", "read", ["a"]]]],
    [
      [candidate("read", "a"), candidate("read", "b")],
      [["group", "read", ["a", "b"]]],
    ],
    [
      [candidate("read", "a"), candidate("read", "b"), candidate("search", "c")],
      [["group", "read", ["a", "b"]], ["group", "search", ["c"]]],
    ],
    [
      [candidate("search", "a"), candidate("search", "b"), candidate("search", "c")],
      [["group", "search", ["a", "b", "c"]]],
    ],
    [
      [candidate("list", "a"), candidate("list", "b")],
      [["group", "list", ["a", "b"]]],
    ],
    [
      [candidate("read", "a"), native("edit"), candidate("read", "b")],
      [["group", "read", ["a"]], ["native", "edit"], ["group", "read", ["b"]]],
    ],
    [
      [candidate("read", "a"), candidate("read", "b"), native("text"), candidate("read", "c")],
      [["group", "read", ["a", "b"]], ["native", "text"], ["group", "read", ["c"]]],
    ],
    [
      [candidate("read", "a"), candidate("read", "failed"), candidate("read", "b")],
      [["group", "read", ["a", "failed", "b"]]],
    ],
    [
      [native("image"), candidate("read", "a")],
      [["native", "image"], ["group", "read", ["a"]]],
    ],
    [
      [candidate("read", "a"), candidate("list", "b")],
      [["group", "read", ["a"]], ["group", "list", ["b"]]],
    ],
    [
      [candidate("write", "a"), candidate("write", "b")],
      [["group", "write", ["a", "b"]]],
    ],
    [
      [candidate("edit", "a"), candidate("edit", "b")],
      [["group", "edit", ["a", "b"]]],
    ],
    [
      [candidate("command", "bash"), candidate("command", "powershell")],
      [["group", "command", ["bash", "powershell"]]],
    ],
    [
      [candidate("tool", "custom"), candidate("tool", "mcp"), candidate("tool", "subagent")],
      [["group", "tool", ["custom", "mcp", "subagent"]]],
    ],
    [
      [candidate("read", "a"), candidate("command", "b")],
      [["group", "read", ["a"]], ["group", "command", ["b"]]],
    ],
  ] as const)("segments boundary matrix", (input, expected) => {
    expect(shape(input)).toEqual(expected);
  });

  it("allows an invisible assistant component between visual tool rows", () => {
    expect(
      shape([candidate("read", "a"), invisible("assistant"), candidate("read", "b")]),
    ).toEqual([["group", "read", ["a", "b"]]]);
  });

  it("reports a group for an eligible singleton but not native rows", () => {
    expect(hasGroups(segmentChildren([candidate("read", "single")]))).toBe(true);
    expect(hasGroups(segmentChildren([native("expanded"), native("single")]))).toBe(false);
  });

});
