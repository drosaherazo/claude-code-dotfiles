// A stand-in for the Claude Code CLI in tests. It records every call's arguments and plays
// the plugin commands the installer uses against a small state file, answering the list
// commands with the same JSON shapes the real CLI prints (checked against Claude Code 2.1.318).
//
// Usage (through the `claude` / `claude.cmd` wrappers the harness writes):
//   node fake-claude.mjs <world folder> <claude arguments...>
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [world, ...args] = process.argv.slice(2);
const statePath = join(world, "claude-state.json");
appendFileSync(join(world, "claude-calls.log"), `${JSON.stringify(args)}\n`);

const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { marketplaces: [], plugins: [], failInstall: [] };
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const is = (...words) => words.every((word, i) => args[i] === word);

if (is("--version")) {
  console.log("2.1.318 (Claude Code)");
} else if (is("plugin", "marketplace", "list")) {
  console.log(JSON.stringify(state.marketplaces, null, 2));
} else if (is("plugin", "list")) {
  console.log(JSON.stringify(state.plugins, null, 2));
} else if (is("plugin", "marketplace", "add")) {
  const source = args[3];
  const manifest = join(source, ".claude-plugin", "marketplace.json");
  if (existsSync(manifest)) {
    const { name } = JSON.parse(readFileSync(manifest, "utf8"));
    state.marketplaces.push({ name, source: "directory", path: source, installLocation: source });
  } else {
    state.marketplaces.push({ name: source.split("/").pop(), source: "github", repo: source });
  }
  save();
} else if (is("plugin", "install")) {
  const id = args[2];
  if (state.failInstall?.includes(id)) {
    console.error(`✘ Failed to install plugin "${id}": not found`);
    process.exit(1);
  }
  state.plugins.push({ id, scope: "user", enabled: true });
  save();
}
