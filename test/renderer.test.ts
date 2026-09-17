import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setCapabilityOverrides, stripTerminalSequences, visibleWidth } from "@earendil-works/pi-tui";
import {
  formatToolRow,
  renderToolGroup,
  sanitizeDisplay,
  type GroupSnapshot,
  type ThemeLike,
  type ToolRowSnapshot,
} from "../src/renderer.ts";
import { normalizePresentationSettings } from "../src/presentation-settings.ts";

const theme: ThemeLike = {
  fg: (color, text) => `<${color}>${text}</${color}>`,
  bold: (text) => `*${text}*`,
};
const plainTheme: ThemeLike = {
  fg: (_color, text) => text,
  bold: (text) => text,
};

beforeAll(() => setCapabilityOverrides({ hyperlinks: false }));
afterAll(() => setCapabilityOverrides({}));

function row(
  toolName: ToolRowSnapshot["toolName"],
  args: unknown,
  result: ToolRowSnapshot["result"] = {
    content: [{ type: "text", text: "this must not be displayed" }],
    isError: false,
  },
  isPartial = false,
): ToolRowSnapshot {
  return { toolName, args, result, isPartial, expanded: false };
}

describe("renderToolGroup", () => {
  it("renders deterministic headings, labels, and state markers", () => {
    const group: GroupSnapshot = {
      kind: "read",
      rows: [
        row("read", { path: "src/a.ts" }),
        row("read", { path: "src/b.ts", offset: 80, limit: 40 }),
        row("read", { path: "src/c.ts" }, undefined, true),
      ],
    };

    expect(renderToolGroup(group, 200, theme).map(stripTerminalSequences)).toEqual([
      "",
      " <toolTitle>*Read 3 files*</toolTitle>",
      "<success>  ● </success><text>src/a.ts</text>",
      "<success>  ● </success><text>src/b.ts</text><muted> (offset=80, limit=40)</muted>",
      "<syntaxKeyword>  ● </syntaxKeyword><text>src/c.ts</text>",
    ]);
  });

  it("renders failed rows inside their group with an error marker and color", () => {
    const failed: ToolRowSnapshot = {
      ...row("bash", { command: "npm run check" }, { content: [], isError: true }),
      errorSummary: "Command exited with code 1",
    };
    expect(renderToolGroup({ kind: "command", rows: [failed] }, 200, theme).map(stripTerminalSequences)).toContain(
      "<error>  ● </error><text>npm run check</text><error> - Command exited with code 1</error>",
    );
    expect(formatToolRow(failed)).toBe("npm run check - Command exited with code 1");
    expect(formatToolRow({ ...failed, errorSummary: undefined })).toBe("npm run check - Failed");
  });

  it("keeps a recognizable path when a failed edit has a long diagnostic", () => {
    const line = renderToolGroup(
      {
        kind: "edit",
        rows: [
          {
            ...row("edit", {
              path: "/Users/fong/Documents/FHY/pi-storyboard/test/renderer.test.ts",
              replacementCount: 2,
            }, { content: [], isError: true }),
            errorSummary: "Could not find edits[0] in /Users/fong/Documents/FHY/pi-storyboard/test/renderer.test.ts",
          },
        ],
      },
      80,
      plainTheme,
    )[2];

    expect(line).not.toContain("<text>.</text>");
    expect(line).toContain("renderer.test.ts");

    for (let width = 1; width <= 200; width++) {
      for (const renderedLine of renderToolGroup(
        {
          kind: "edit",
          rows: [
            {
              ...row("edit", {
                path: "/Users/fong/Documents/FHY/pi-storyboard/test/renderer.test.ts",
                replacementCount: 2,
              }, { content: [], isError: true }),
              errorSummary: "Could not find edits[0] in /Users/fong/Documents/FHY/pi-storyboard/test/renderer.test.ts",
            },
          ],
        },
        width,
        plainTheme,
      )) {
        expect(visibleWidth(renderedLine)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("shows Pi-provided command timing as a native-style suffix", () => {
    const finished: ToolRowSnapshot = {
      ...row("bash", { command: "npm test" }),
      elapsedMs: 1488,
    };
    const running: ToolRowSnapshot = {
      ...row("bash", { command: "npm test" }, undefined, true),
      elapsedMs: 240,
    };

    expect(renderToolGroup({ kind: "command", rows: [finished, running] }, 200, theme).map(stripTerminalSequences)).toContain(
      "<success>  ● </success><text>npm test</text><muted> (took 1.5s)</muted>",
    );
    expect(renderToolGroup({ kind: "command", rows: [finished, running] }, 200, theme).map(stripTerminalSequences)).toContain(
      "<syntaxKeyword>  ● </syntaxKeyword><text>npm test</text><muted> (elapsed 0.2s)</muted>",
    );
    expect(formatToolRow(finished)).toBe("npm test (took 1.5s)");
    expect(formatToolRow(running)).toBe("npm test (elapsed 0.2s)");
  });

  it("formats search and list arguments", () => {
    expect(
      formatToolRow(row("grep", { pattern: "UserService", path: "src/", glob: "*.ts", limit: 10 })),
    ).toBe('grep "UserService" in src/ (glob "*.ts", limit 10)');
    expect(formatToolRow(row("read", { path: "src/app.ts", offset: 930, limit: 170 }))).toBe(
      "src/app.ts (offset=930, limit=170)",
    );
    expect(formatToolRow(row("grep", { pattern: "x", path: "" }))).toBe('grep "x" in .');
    expect(formatToolRow(row("find", { pattern: "*Repository.java", path: "src/" }))).toBe(
      'find "*Repository.java" in src/',
    );
    expect(formatToolRow(row("find", { pattern: "x", path: "" }))).toBe('find "x" in .');
    expect(formatToolRow(row("ls", {}))).toBe(".");
    expect(formatToolRow(row("ls", { path: "" }))).toBe(".");
    expect(formatToolRow(row("ls", { path: "src/", limit: 4 }))).toBe("src/ (limit 4)");
    expect(formatToolRow(row("write", { path: "src/app.ts", content: "secret" }))).toBe("src/app.ts");
    expect(formatToolRow(row("edit", { path: "src/app.ts", replacementCount: 2 }))).toBe(
      "src/app.ts (2 replacements)",
    );
    expect(formatToolRow({
      toolName: "edit",
      args: undefined,
      isPartial: true,
      expanded: false,
    })).toBe("edit");
    expect(formatToolRow(row("bash", { command: "npm test" }))).toBe("npm test");
    expect(formatToolRow(row("powershell", { command: "Get-ChildItem", cwd: "src" }))).toBe(
      "Get-ChildItem (cwd src)",
    );
    expect(formatToolRow(row("custom-tool", { target: "src" }))).toBe(
      'custom-tool {"target":"src"}',
    );
    expect(renderToolGroup({ kind: "write", rows: [row("write", { path: "a", content: "x" })] }, 200, theme)[1]).toBe(
      " <toolTitle>*Write 1 file*</toolTitle>",
    );
    expect(renderToolGroup({ kind: "edit", rows: [row("edit", { path: "a", replacementCount: 1 })] }, 200, theme)[1]).toBe(
      " <toolTitle>*Edit 1 time*</toolTitle>",
    );
    expect(renderToolGroup({ kind: "command", rows: [row("bash", { command: "npm test" })] }, 200, theme)[1]).toBe(
      " <toolTitle>*Run 1 command*</toolTitle>",
    );
    expect(renderToolGroup({ kind: "tool", rows: [row("custom-tool", { target: "src" })] }, 200, theme)[1]).toBe(
      " <toolTitle>*Run 1 tool*</toolTitle>",
    );
  });

  it("truncates long paths in the middle while keeping their beginning and filename", () => {
    const [line] = renderToolGroup(
      {
        kind: "read",
        rows: [
          row("read", {
            path: "/Users/fong/.nvm/versions/node/v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.ts",
          }),
        ],
      },
      100,
      theme,
    ).slice(2);

    const visibleLine = stripTerminalSequences(line);
    expect(visibleLine).toContain("...");
    expect(visibleLine).toContain("/Users/fong");
    expect(visibleLine).toContain("index.ts");
    expect(visibleLine).not.toContain("v24.14.0/lib/node_modules/@earendil-works/pi-coding-agent");
    expect(visibleWidth(line)).toBeLessThanOrEqual(100);
  });

  it("uses singular labels when called independently with one row", () => {
    expect(renderToolGroup({ kind: "search", rows: [row("grep", { pattern: "x" })] }, 200, theme)[1]).toBe(
      " <toolTitle>*Search 1 time*</toolTitle>",
    );
    expect(renderToolGroup({ kind: "list", rows: [row("ls", {})] }, 200, theme)[1]).toBe(
      " <toolTitle>*List 1 directory*</toolTitle>",
    );
  });


  it("falls back to compact JSON for malformed recognized arguments", () => {
    expect(formatToolRow(row("read", { path: 42, extra: "x" }))).toBe(
      'read {"path":42,"extra":"x"}',
    );
    expect(formatToolRow(row("grep", { pattern: "x", limit: "many" }))).toBe(
      'grep {"pattern":"x","limit":"many"}',
    );
    expect(formatToolRow(row("write", { path: 42 }))).toBe('write {"path":42}');
    expect(formatToolRow(row("edit", { path: "a", replacementCount: "many" }))).toBe(
      'edit {"path":"a","replacementCount":"many"}',
    );
    expect(formatToolRow(row("bash", { command: 42 }))).toBe('bash {"command":42}');
  });

  it("sanitizes terminal escapes and control bytes", () => {
    expect(sanitizeDisplay("\u001b[31mhello\u001b[0m\nworld\t\u001b]8;;https://bad\u0007link\u001b\\")).toBe(
      "hello world link",
    );
    expect(formatToolRow(row("read", { path: "a\u0000\u001b[2J\nb" }))).toBe("a b");
  });

  it("does not render result contents", () => {
    const lines = renderToolGroup(
      {
        kind: "search",
        rows: [row("grep", { pattern: "secret" }), row("find", { pattern: "x" })],
      },
      200,
      theme,
    );
    expect(lines.join("\n")).not.toContain("this must not be displayed");
    expect(lines.join("\n")).not.toContain("secret result");
  });

  it("does not expose write content, command output, or generic results", () => {
    const lines = renderToolGroup(
      {
        kind: "tool",
        rows: [
          row("write", { path: "secret.txt", content: "do not show this" }),
          row("bash", { command: "cat secret.txt" }, {
            content: [{ type: "text", text: "command output must stay hidden" }],
            isError: false,
          }),
          row("custom-tool", { value: "argument is okay" }, {
            content: [{ type: "text", text: "custom result must stay hidden" }],
            isError: false,
          }),
        ],
      },
      200,
      theme,
    ).join("\n");
    expect(lines).toContain("secret.txt");
    expect(lines).toContain("cat secret.txt");
    expect(lines).toContain("argument is okay");
    expect(lines).not.toContain("do not show this");
    expect(lines).not.toContain("command output must stay hidden");
    expect(lines).not.toContain("custom result must stay hidden");
  });

  it("renders only the safe edit summary metadata", () => {
    const lines = renderToolGroup(
      {
        kind: "edit",
        rows: [
          row("edit", { path: "src/a.ts", replacementCount: 2 }),
          row("edit", { path: "src/b.ts", replacementCount: 1 }),
        ],
      },
      200,
      theme,
    ).join("\n");
    const plainLines = stripTerminalSequences(lines).replace(/<[^>]+>/gu, "");
    expect(plainLines).toContain("src/a.ts (2 replacements)");
    expect(plainLines).toContain("src/b.ts (1 replacement)");
    expect(lines).not.toContain("oldText");
    expect(lines).not.toContain("newText");
    expect(lines).not.toContain("diff");
    expect(lines).not.toContain("patch");
  });

  it("keeps every custom line within widths 1 through 200", () => {
    const group: GroupSnapshot = {
      kind: "read",
      rows: [
        row("read", { path: "界界界界界/very-long-file-name.ts\nwith-newline" }),
        row("read", { path: "another-long-file-name.ts" }, undefined, true),
      ],
    };
    for (let width = 1; width <= 200; width++) {
      for (const line of renderToolGroup(group, width, theme)) {
        expect(visibleWidth(line)).toBeLessThanOrEqual(width);
      }
    }
  });

  it("trims file names and commands independently", () => {
    const path = "/Users/fong/Documents/FHY/pi-storyboard/src/components/very-long-file-name.ts";
    const command = "npm run test -- --reporter verbose --coverage --project storyboard";
    const defaults = normalizePresentationSettings(undefined);
    const noFileTrim = normalizePresentationSettings({
      "pi-storyboard": { trimming: { fileNames: false, commands: true } },
    });
    const noCommandTrim = normalizePresentationSettings({
      "pi-storyboard": { trimming: { fileNames: true, commands: false } },
    });

    const defaultPath = renderToolGroup({ kind: "read", rows: [row("read", { path })] }, 48, plainTheme, defaults)[2]!;
    const untrimmedPath = renderToolGroup({ kind: "read", rows: [row("read", { path })] }, 48, plainTheme, noFileTrim)[2]!;
    const defaultCommand = renderToolGroup({ kind: "command", rows: [row("bash", { command })] }, 48, plainTheme, defaults)[2]!;
    const untrimmedCommand = renderToolGroup({ kind: "command", rows: [row("bash", { command })] }, 48, plainTheme, noCommandTrim)[2]!;

    expect(defaultPath).toContain("file-name.ts");
    expect(untrimmedPath).not.toContain("very-long-file-name.ts");
    expect(defaultCommand).toContain("storyboard");
    expect(untrimmedCommand).not.toContain("storyboard");
  });
});
