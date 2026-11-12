// The status line through its own CLI: session JSON on stdin, a throwaway git repository
// as the session's directory, and the printed line checked as Claude Code would show it.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { git } from "./harness.mjs";

const STATUSLINE = join(dirname(fileURLToPath(import.meta.url)), "..", "base", "statusline.mjs");

const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const RESET = "\x1b[0m";
// Opus with 50,000 of 200,000 tokens used: what every case below shows before the git part.
const CONTEXT = `Opus · 50.0k / 200k tokens · ${GREEN}25% context${RESET}`;

let root;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "statusline-test-")));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function statusLine(currentDir) {
  const session = {
    model: { id: "claude-opus-5-5", display_name: "Opus" },
    context_window: { current_usage: { input_tokens: 50_000 }, context_window_size: 200_000 },
    workspace: { current_dir: currentDir },
  };
  const result = spawnSync(process.execPath, [STATUSLINE], {
    input: JSON.stringify(session),
    encoding: "utf8",
    // Stop git from finding a repository above the throwaway folder.
    env: { ...process.env, GIT_CEILING_DIRECTORIES: root },
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function repoWithOneCommit(path) {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", "main");
  writeFileSync(join(path, "README.md"), "hello\n");
  git(path, "add", "-A");
  git(path, "commit", "-q", "-m", "first");
  return path;
}

test("a clean repository shows the branch and 'clean'", () => {
  const repo = repoWithOneCommit(join(root, "repo"));

  assert.equal(statusLine(repo), `${CONTEXT} · ${CYAN}⎇ main${RESET} · clean`);
});

test("changed files are counted, untracked ones included", () => {
  const repo = repoWithOneCommit(join(root, "repo"));
  writeFileSync(join(repo, "README.md"), "changed\n");
  writeFileSync(join(repo, "new.txt"), "new\n");

  assert.equal(statusLine(repo), `${CONTEXT} · ${CYAN}⎇ main${RESET} · 2 changed`);
});

test("commits ahead of and behind the upstream are shown", () => {
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const other = repoWithOneCommit(join(root, "other"));
  git(other, "remote", "add", "origin", origin);
  git(other, "push", "-q", "-u", "origin", "main");
  const repo = join(root, "repo");
  git(root, "clone", "-q", origin, repo);

  writeFileSync(join(other, "theirs.txt"), "theirs\n");
  git(other, "add", "-A");
  git(other, "commit", "-q", "-m", "theirs");
  git(other, "push", "-q");
  writeFileSync(join(repo, "mine.txt"), "mine\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "mine");
  git(repo, "fetch", "-q");

  assert.equal(statusLine(repo), `${CONTEXT} · ${CYAN}⎇ main ↑1 ↓1${RESET} · clean`);
});

test("a folder that is not a repository shows no git part", () => {
  const folder = join(root, "plain");
  mkdirSync(folder);

  assert.equal(statusLine(folder), CONTEXT);
});
