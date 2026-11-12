// Plugins from the layers: the repo is registered as a local marketplace and every plugin the
// base, profile and local layer declare is installed through the Claude Code CLI, checked
// through the fake `claude` the harness puts on the PATH.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "./harness.mjs";

let world;
beforeEach(() => {
  world = createWorld();
  world.writeLayer("base", "plugins.json", { plugins: ["explorer@claude-code-dotfiles"] });
  world.writeLayer("profile", "plugins.json", {
    marketplaces: { "claude-plugins-official": "anthropics/claude-plugins-official" },
    plugins: ["mattpocock-skills@claude-plugins-official"],
  });
});
afterEach(() => {
  world.cleanup();
});

test("a fresh install adds the repo and the declared marketplaces, then installs each declared plugin", () => {
  const result = world.install();

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(world.claudeChanges(), [
    ["plugin", "marketplace", "add", world.repo],
    ["plugin", "marketplace", "add", "anthropics/claude-plugins-official"],
    ["plugin", "install", "explorer@claude-code-dotfiles"],
    ["plugin", "install", "mattpocock-skills@claude-plugins-official"],
  ]);
  assert.match(result.stdout, /installed\s+plugin explorer@claude-code-dotfiles/);
});

test("plugins declared in the local layer are installed too", () => {
  world.writeLayer("local", "plugins.json", { plugins: ["work-tools@claude-plugins-official"] });

  assert.equal(world.install().code, 0);

  assert.ok(
    world.claudeChanges().some((call) => call.join(" ") === "plugin install work-tools@claude-plugins-official"),
    JSON.stringify(world.claudeChanges()),
  );
});

test("a second run reinstalls nothing and adds no marketplace again", () => {
  assert.equal(world.install().code, 0);
  const changesAfterFirstRun = world.claudeChanges().length;

  const second = world.install();

  assert.equal(second.code, 0, second.stderr);
  assert.equal(world.claudeChanges().length, changesAfterFirstRun);
  assert.match(second.stdout, /nothing to change/i);
});

test("plugins already installed from the same source are left alone, while a marketplace from another folder is added", () => {
  world.setClaudeState({
    marketplaces: [
      { name: "claude-code-dotfiles", source: "directory", path: "/somewhere/else", installLocation: "/somewhere/else" },
      { name: "claude-plugins-official", source: "github", repo: "anthropics/claude-plugins-official" },
    ],
    plugins: [{ id: "mattpocock-skills@claude-plugins-official", scope: "user", enabled: true }],
  });

  assert.equal(world.install().code, 0);

  assert.deepEqual(world.claudeChanges(), [
    ["plugin", "marketplace", "add", world.repo],
    ["plugin", "install", "explorer@claude-code-dotfiles"],
  ]);
});

test("a dry run lists the marketplaces and plugins it would add and changes nothing", () => {
  const result = world.install(["--dry-run"]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /would add\s+marketplace claude-code-dotfiles/);
  assert.match(result.stdout, /would install plugin mattpocock-skills@claude-plugins-official/);
  assert.deepEqual(world.claudeChanges(), []);
});

test("a plugin that fails to install stops the install with a message naming it", () => {
  world.setClaudeState({ failInstall: ["explorer@claude-code-dotfiles"] });

  const result = world.install();

  assert.equal(result.code, 1);
  assert.match(result.stderr, /could not install plugin explorer@claude-code-dotfiles/);
});

test("the installer fails with a clear message when the Claude Code CLI is missing", () => {
  const result = world.install([], { path: world.toolsWithoutClaude() });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Claude Code CLI/);
  assert.deepEqual(world.claudeCalls(), []);
});
