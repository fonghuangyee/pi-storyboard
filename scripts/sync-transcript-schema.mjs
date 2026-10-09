#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(projectRoot, "schema/pi-transcript-types.json");

const sourceDefinitions = [
  {
    id: "coding-agent/session-manager",
    packageName: "@earendil-works/pi-coding-agent",
    file: "dist/core/session-manager.d.ts",
    declarations: [
      "CURRENT_SESSION_VERSION", "SessionHeader", "SessionEntryBase", "SessionMessageEntry", "ThinkingLevelChangeEntry",
      "ModelChangeEntry", "CompactionEntry", "BranchSummaryEntry", "CustomEntry", "LabelEntry",
      "SessionInfoEntry", "CustomMessageEntry", "UsageEntry", "ContextEditEntry", "SessionEntry", "FileEntry",
    ],
  },
  {
    id: "coding-agent/messages",
    packageName: "@earendil-works/pi-coding-agent",
    file: "dist/core/messages.d.ts",
    declarations: ["BashExecutionMessage", "CustomMessage", "BranchSummaryMessage", "CompactionSummaryMessage"],
    modules: ["@earendil-works/pi-agent-core"],
  },
  {
    id: "pi-ai/transcript-types",
    packageName: "@earendil-works/pi-ai",
    file: "dist/types.d.ts",
    declarations: [
      "TextSignatureV1", "TextContent", "ThinkingContent", "ImageContent", "ToolCall", "Usage",
      "StopReason", "JsonValue", "DeferredHandle", "UserMessage", "SystemMessage", "AssistantMessage",
      "ToolResultMessage", "NestedToolCallRecord", "NestedToolCalls", "Tool", "ToolReference",
      "ConstrainedSamplingConfig", "GrammarFormat", "GrammarVariants", "Message",
    ],
  },
  {
    id: "pi-ai/diagnostics",
    packageName: "@earendil-works/pi-ai",
    file: "dist/utils/diagnostics.d.ts",
    declarations: ["DiagnosticErrorInfo", "AssistantMessageDiagnostic"],
  },
  {
    id: "pi-agent-core/messages",
    packageName: "@earendil-works/pi-agent-core",
    file: "dist/types.d.ts",
    declarations: ["CustomAgentMessages", "AgentMessage"],
  },
];

function findPackageRoot(packageName, searchRoots) {
  for (const searchRoot of searchRoots) {
    const candidate = path.join(searchRoot, "node_modules", ...packageName.split("/"));
    try {
      const manifest = JSON.parse(readFileSync(path.join(candidate, "package.json"), "utf8"));
      if (manifest.name === packageName && typeof manifest.version === "string") {
        return { root: candidate, version: manifest.version };
      }
    } catch {
      // Try the next normal npm installation location.
    }
  }
  throw new Error(`Cannot find installed package ${packageName}. Install the project's pinned development dependencies first.`);
}

function declarationAt(line) {
  const typeDeclaration = line.match(/^export\s+(?:declare\s+)?(interface|type|class|enum|const)\s+([A-Za-z_$][\w$]*)\b/u);
  if (typeDeclaration) return { kind: typeDeclaration[1] === "interface" || typeDeclaration[1] === "class" || typeDeclaration[1] === "enum" ? "interface" : "type", name: typeDeclaration[2] };
  const moduleDeclaration = line.match(/^declare\s+module\s+["']([^"']+)["']/u);
  if (moduleDeclaration) return { kind: "module", name: moduleDeclaration[1] };
  return undefined;
}

function declarationEnd(sourceText, start, kind) {
  let braces = 0;
  let brackets = 0;
  let parentheses = 0;
  let quote;
  let lineComment = false;
  let blockComment = false;

  for (let index = start; index < sourceText.length; index++) {
    const char = sourceText[index];
    const next = sourceText[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index++;
      }
      continue;
    }
    if (quote) {
      if (char.charCodeAt(0) === 92) index++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index++;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index++;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") braces++;
    else if (char === "}") {
      braces--;
      if ((kind === "interface" || kind === "module") && braces === 0) return index + 1;
    } else if (char === "[") brackets++;
    else if (char === "]") brackets--;
    else if (char === "(") parentheses++;
    else if (char === ")") parentheses--;
    else if (kind === "type" && char === ";" && braces === 0 && brackets === 0 && parentheses === 0) return index + 1;
  }
  return sourceText.length;
}

function extractDeclarations(sourceText, sourceName, wantedNames, wantedModules = []) {
  const wanted = new Set(wantedNames);
  const wantedModuleNames = new Set(wantedModules);
  const declarations = {};
  const declarationHeader = /^(?:export\s|declare\s+module\b)[^\n]*/gmu;

  for (const match of sourceText.matchAll(declarationHeader)) {
    const found = declarationAt(match[0]);
    if (!found) continue;
    const isModule = found.kind === "module";
    const isWanted = isModule ? wantedModuleNames.has(found.name) : wanted.has(found.name);
    if (!isWanted) continue;
    const key = isModule ? `module:${found.name}` : found.name;
    const end = declarationEnd(sourceText, match.index, found.kind);
    declarations[key] = sourceText.slice(match.index, end).trim();
  }

  return {
    declarations: Object.fromEntries(Object.entries(declarations).sort(([a], [b]) => a.localeCompare(b))),
    missingDeclarations: [
      ...wantedNames.filter((name) => declarations[name] === undefined),
      ...wantedModules.map((name) => `module:${name}`).filter((name) => declarations[name] === undefined),
    ].sort(),
    sourceName,
  };
}

export function collectSnapshot(root = projectRoot) {
  const codingAgent = findPackageRoot("@earendil-works/pi-coding-agent", [root]);
  const searchRoots = [root, codingAgent.root];
  const packages = {
    "@earendil-works/pi-coding-agent": codingAgent.version,
  };
  const packageRoots = new Map([["@earendil-works/pi-coding-agent", codingAgent.root]]);

  for (const packageName of ["@earendil-works/pi-ai", "@earendil-works/pi-agent-core"]) {
    const installed = findPackageRoot(packageName, searchRoots);
    packages[packageName] = installed.version;
    packageRoots.set(packageName, installed.root);
  }

  const sources = sourceDefinitions.map((definition) => {
    const packageRoot = packageRoots.get(definition.packageName);
    const absolutePath = path.join(packageRoot, definition.file);
    let sourceText;
    try {
      sourceText = readFileSync(absolutePath, "utf8");
    } catch {
      throw new Error(`Installed ${definition.packageName} no longer publishes ${definition.file}; review its package layout before syncing.`);
    }
    const extracted = extractDeclarations(sourceText, definition.file, definition.declarations, definition.modules);
    return {
      id: definition.id,
      packageName: definition.packageName,
      file: definition.file,
      declarations: extracted.declarations,
      missingDeclarations: extracted.missingDeclarations,
    };
  });

  return {
    formatVersion: 1,
    packages: Object.fromEntries(Object.entries(packages).sort(([a], [b]) => a.localeCompare(b))),
    sources,
  };
}

function declarationChanges(previous, current) {
  const before = previous?.declarations ?? {};
  const after = current?.declarations ?? {};
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return names.flatMap((name) => {
    if (before[name] === undefined) return [{ name, kind: "added", before: "", after: after[name] }];
    if (after[name] === undefined) return [{ name, kind: "removed", before: before[name], after: "" }];
    if (before[name] !== after[name]) return [{ name, kind: "changed", before: before[name], after: after[name] }];
    return [];
  });
}

export function compareSnapshots(previous, current) {
  const packageNames = [...new Set([...Object.keys(previous.packages ?? {}), ...Object.keys(current.packages ?? {})])].sort();
  const packageChanges = packageNames.flatMap((name) => {
    const before = previous.packages?.[name];
    const after = current.packages?.[name];
    return before === after ? [] : [{ name, before: before ?? "(not installed)", after: after ?? "(not installed)" }];
  });

  const previousSources = new Map((previous.sources ?? []).map((source) => [source.id, source]));
  const currentSources = new Map((current.sources ?? []).map((source) => [source.id, source]));
  const sourceIds = [...new Set([...previousSources.keys(), ...currentSources.keys()])].sort();
  const sourceChanges = sourceIds.flatMap((id) => {
    const before = previousSources.get(id);
    const after = currentSources.get(id);
    if (!before) return [{ id, kind: "added", declarations: declarationChanges(undefined, after) }];
    if (!after) return [{ id, kind: "removed", declarations: declarationChanges(before, undefined) }];
    const declarations = declarationChanges(before, after);
    const missingBefore = (before.missingDeclarations ?? []).join("\n");
    const missingAfter = (after.missingDeclarations ?? []).join("\n");
    const layoutChanged = before.file !== after.file || before.packageName !== after.packageName;
    if (declarations.length === 0 && missingBefore === missingAfter && !layoutChanged) return [];
    return [{ id, kind: "changed", declarations, missingBefore, missingAfter, layoutChanged }];
  });

  return {
    changed: packageChanges.length > 0 || sourceChanges.length > 0,
    packageChanges,
    sourceChanges,
  };
}

function diffLines(before, after) {
  const left = before.split("\n");
  const right = after.split("\n");
  const rows = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      rows[i][j] = left[i] === right[j] ? rows[i + 1][j + 1] + 1 : Math.max(rows[i + 1][j], rows[i][j + 1]);
    }
  }

  const output = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      output.push(`  ${left[i]}`);
      i++;
      j++;
    } else if (i < left.length && (j === right.length || rows[i + 1][j] >= rows[i][j + 1])) {
      output.push(`- ${left[i++]}`);
    } else {
      output.push(`+ ${right[j++]}`);
    }
  }
  return output;
}

function printReport(baseline, current, comparison) {
  if (!comparison.changed) {
    console.log("Installed Pi transcript declarations match the reviewed snapshot.");
    return;
  }

  console.log("Installed Pi transcript declarations differ from the reviewed snapshot.");
  if (comparison.packageChanges.length > 0) {
    console.log("\nPackage versions:");
    for (const change of comparison.packageChanges) console.log(`  ${change.name}: ${change.before} -> ${change.after}`);
  }

  for (const sourceChange of comparison.sourceChanges) {
    console.log(`\n${sourceChange.id} (${sourceChange.kind}):`);
    if (sourceChange.layoutChanged) console.log("  Published declaration file or owning package changed; inspect the updated target mapping.");
    for (const change of sourceChange.declarations) {
      console.log(`  ${change.kind}: ${change.name}`);
      if (change.before || change.after) {
        for (const line of diffLines(change.before, change.after)) console.log(`    ${line}`);
      }
    }
    if (sourceChange.missingAfter && sourceChange.missingAfter !== sourceChange.missingBefore) {
      console.log(`  declarations no longer found: ${sourceChange.missingAfter.replaceAll("\n", ", ")}`);
    }
  }
  console.log("\nReview these changes against schema/pi-session.schema.json and the projector/native fallback before updating the snapshot.");
}

function readBaseline(allowMissing = false) {
  try {
    return JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (error) {
    if (allowMissing && error.code === "ENOENT") return { formatVersion: 1, packages: {}, sources: [] };
    throw new Error(`Cannot read ${path.relative(projectRoot, baselinePath)}: ${error.message}`);
  }
}

function main(args) {
  if (args.includes("--help") || args.includes("-h")) {
    console.log("Usage: npm run transcript:schema [-- --update]\n\nCompare the installed Pi transcript-related TypeScript declarations with the reviewed snapshot.\nUse --update only after reviewing the reported changes. This command does not access the network.");
    return 0;
  }
  const unknownArgs = args.filter((arg) => arg !== "--update");
  if (unknownArgs.length > 0 || args.filter((arg) => arg === "--update").length > 1) {
    console.error(`Unknown arguments: ${unknownArgs.join(" ") || "--update"}`);
    return 2;
  }

  const shouldUpdate = args.includes("--update");
  const baseline = readBaseline(shouldUpdate);
  const current = collectSnapshot();
  const comparison = compareSnapshots(baseline, current);
  printReport(baseline, current, comparison);

  if (shouldUpdate) {
    writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`);
    console.log(`\nUpdated ${path.relative(projectRoot, baselinePath)}. Review and commit it with the related schema/documentation changes.`);
    return 0;
  }
  return comparison.changed ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
