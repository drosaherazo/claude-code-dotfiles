import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createWorld, pathSeparator, symlinksAllowed } from "./harness.mjs";

let world;
beforeEach(() => {
  world = createWorld();
});
afterEach(() => {
  world.cleanup();
});

const canLink = symlinksAllowed();

const forwardSlashes = (p) => p.replaceAll("\\", "/");

test("a fresh install links the status line and writes statusLine with this machine's absolute path", () => {
  const result = world.install();

  assert.equal(result.code, 0, result.stderr);
  const target = join(world.claudeDir, "statusline.mjs");
  const source = join(world.repo, "base", "statusline.mjs");
  if (canLink) {
    assert.ok(lstatSync(target).isSymbolicLink(), "status line should be a link");
    assert.equal(realpathSync(target), realpathSync(source));
  } else {
    assert.equal(readFileSync(target, "utf8"), readFileSync(source, "utf8"));
  }
  assert.deepEqual(world.readSettings().statusLine, {
    type: "command",
    command: `node "${forwardSlashes(target)}"`,
  });
});

test("existing settings keys are kept and an existing status line is backed up to a reported folder", () => {
  mkdirSync(world.claudeDir, { recursive: true });
  writeFileSync(join(world.claudeDir, "statusline.mjs"), "// my old status line\n");
  writeFileSync(
    join(world.claudeDir, "settings.json"),
    JSON.stringify({ cleanupPeriodDays: 30, permissions: { allow: ["Bash(ls)"] }, statusLine: { type: "command", command: "old" } }),
  );

  const result = world.install();

  assert.equal(result.code, 0, result.stderr);
  const settings = world.readSettings();
  assert.equal(settings.cleanupPeriodDays, 30);
  assert.deepEqual(settings.permissions.allow, ["Bash(ls)"]);
  assert.notEqual(settings.statusLine.command, "old");

  const reported = result.stdout.match(/Backed up .* to (.+)$/m);
  assert.ok(reported, `backup folder should be reported:\n${result.stdout}`);
  const backupDir = reported[1].trim();
  assert.ok(backupDir.startsWith(join(world.claudeDir, "backups")), backupDir);
  assert.equal(readFileSync(join(backupDir, "statusline.mjs"), "utf8"), "// my old status line\n");
  assert.equal(JSON.parse(readFileSync(join(backupDir, "settings.json"), "utf8")).statusLine.command, "old");
});

test("a second run changes nothing and says so", () => {
  assert.equal(world.install().code, 0);
  const settingsBefore = readFileSync(join(world.claudeDir, "settings.json"), "utf8");

  const second = world.install();

  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /nothing to change/i);
  assert.equal(readFileSync(join(world.claudeDir, "settings.json"), "utf8"), settingsBefore);
  assert.equal(existsSync(join(world.claudeDir, "backups")), false, "nothing should be backed up");
});

test("a dry run prints the planned changes and leaves the home folder untouched", () => {
  mkdirSync(world.claudeDir, { recursive: true });
  writeFileSync(join(world.claudeDir, "statusline.mjs"), "// my old status line\n");
  writeFileSync(join(world.claudeDir, "settings.json"), `{"model":"sonnet"}`);

  const result = world.install(["--dry-run"]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /dry run/i);
  assert.match(result.stdout, canLink ? /would link\s+statusline\.mjs/ : /would copy\s+statusline\.mjs/);
  assert.match(result.stdout, /would merge\s+settings\.json/);
  assert.equal(readFileSync(join(world.claudeDir, "statusline.mjs"), "utf8"), "// my old status line\n");
  assert.equal(readFileSync(join(world.claudeDir, "settings.json"), "utf8"), `{"model":"sonnet"}`);
  assert.equal(existsSync(join(world.claudeDir, "backups")), false);
});

test("a dry run on an empty home creates nothing", () => {
  const result = world.install(["--dry-run"]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(existsSync(world.claudeDir), false);
});

test("with the copy fallback forced, files are copied and the summary warns that changes need a re-run", () => {
  const result = world.install([], { env: { DOTFILES_FORCE_COPY: "1" } });

  assert.equal(result.code, 0, result.stderr);
  const target = join(world.claudeDir, "statusline.mjs");
  assert.equal(lstatSync(target).isSymbolicLink(), false);
  assert.equal(readFileSync(target, "utf8"), readFileSync(join(world.repo, "base", "statusline.mjs"), "utf8"));
  assert.match(result.stdout, /copied\s+statusline\.mjs/);
  assert.match(result.stdout, /Summary: 0 linked, 1 copied, 1 merged, 1 added, 1 installed, 0 unchanged/);
  assert.match(result.stdout, /run the installer again/i);
});

test("an identical copy is replaced by a link where symlinks are allowed", { skip: !canLink && "symlinks not allowed here" }, () => {
  assert.equal(world.install([], { env: { DOTFILES_FORCE_COPY: "1" } }).code, 0);

  const result = world.install();

  assert.equal(result.code, 0, result.stderr);
  assert.ok(lstatSync(join(world.claudeDir, "statusline.mjs")).isSymbolicLink());
  assert.match(result.stdout, /Summary: 1 linked, 0 copied, 0 merged, 0 added, 0 installed, 3 unchanged/);
});

test("the installer fails with a clear message when git or Node is missing", () => {
  const result = world.install([], { path: world.bin });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /git/);
  assert.match(result.stderr, /node/i);
  assert.match(result.stderr, /install/i);
  assert.equal(existsSync(world.claudeDir), false, "nothing should be installed");
});

test("other keys inside an existing statusLine setting are kept", () => {
  mkdirSync(world.claudeDir, { recursive: true });
  writeFileSync(join(world.claudeDir, "settings.json"), JSON.stringify({ statusLine: { type: "command", command: "old", padding: 2 } }));

  assert.equal(world.install().code, 0);

  const { statusLine } = world.readSettings();
  assert.equal(statusLine.padding, 2);
  assert.notEqual(statusLine.command, "old");
});

test("a malformed settings.json stops the install with a message naming the file", () => {
  mkdirSync(world.claudeDir, { recursive: true });
  writeFileSync(join(world.claudeDir, "settings.json"), "{ not json");

  const result = world.install();

  assert.equal(result.code, 1);
  assert.match(result.stderr, /settings\.json/);
  assert.equal(readFileSync(join(world.claudeDir, "settings.json"), "utf8"), "{ not json");
  assert.equal(existsSync(join(world.claudeDir, "statusline.mjs")), false, "nothing should be installed");
});

test("the fake claude on the PATH records the arguments it is called with", () => {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toUpperCase() === "PATH") delete env[key];
  env.PATH = `${world.bin}${pathSeparator()}${process.env.PATH ?? process.env.Path ?? ""}`;

  spawnSync("claude", ["plugin", "install", "x"], { env, shell: true });

  assert.deepEqual(world.claudeCalls(), [["plugin", "install", "x"]]);
});
