import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const forbidden = [
  "registerTool",
  "setActiveTools",
  "before_agent_start",
  "tool_call",
  "tool_result",
  "sendMessage",
  "sendUserMessage",
  "appendEntry",
  "fetch(",
  "child_process",
  "spawn(",
  "exec(",
];

describe("architecture guard", () => {
  it("keeps model, mutation, and process APIs out of src", () => {
    const source = ["index.ts", "grouping.ts", "renderer.ts", "pi-adapter.ts", "session-projection.ts", "storyboard.ts"]
      .map((file) => readFileSync(join(process.cwd(), "src", file), "utf8"))
      .join("\n");
    for (const term of forbidden) expect(source).not.toContain(term);
    expect(source).toContain('"session_start"');
    expect(source).toContain('"session_shutdown"');
  });
});
