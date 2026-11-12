// Test harness (Seam 1 in the spec): every test builds a throwaway world and runs the
// installer as a real process inside it, then looks only at what ends up on disk and
// what the installer printed.
import { spawnSync, execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// What a fresh clone contains that the installer can use; tests never see the rest.
const CLONED_FOLDERS = ["engine", "base", "profile"];

export const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

export function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...GIT_IDENTITY },
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// A process environment with PATH replaced (Windows spells it "Path", so drop every casing).
export function envWithPath(base, path) {
  const env = {};
  for (const [key, value] of Object.entries(base)) {
    if (key.toUpperCase() !== "PATH") env[key] = value;
  }
  env.PATH = path;
  return env;
}

// Whether this machine lets an unprivileged process create a file symlink.
export function symlinksAllowed() {
  const dir = mkdtempSync(join(tmpdir(), "dotfiles-symlink-probe-"));
  try {
    writeFileSync(join(dir, "target"), "");
    symlinkSync(join(dir, "target"), join(dir, "link"), "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function createWorld() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dotfiles-test-")));
  const home = join(root, "home");
  const repo = join(root, "repo");
  const bin = join(root, "bin");
  const claudeCalls = join(root, "claude-calls.log");
  mkdirSync(home);
  mkdirSync(bin);

  // A throwaway clone: the repo's current files committed into a fresh git repository.
  mkdirSync(repo);
  for (const folder of CLONED_FOLDERS) {
    cpSync(join(REPO_ROOT, folder), join(repo, folder), { recursive: true });
  }
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "snapshot");

  // A fake `claude` on the PATH that records each call's arguments, one JSON array per line.
  const recorder = join(bin, "fake-claude.mjs");
  writeFileSync(
    recorder,
    `import { appendFileSync } from "node:fs";\n` +
      `appendFileSync(${JSON.stringify(claudeCalls)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`,
  );
  const node = JSON.stringify(process.execPath);
  writeFileSync(join(bin, "claude"), `#!/bin/sh\nexec ${node} "${recorder}" "$@"\n`, { mode: 0o755 });
  writeFileSync(join(bin, "claude.cmd"), `@echo off\r\n${node} "${recorder}" %*\r\n`);

  const claudeDir = join(home, ".claude");

  return {
    root,
    home,
    repo,
    bin,
    claudeDir,

    // Runs the installer from the throwaway clone with the throwaway home as the user's home.
    install(args = [], { env = {}, path } = {}) {
      const baseEnv = { ...process.env, HOME: home, USERPROFILE: home };
      delete baseEnv.CLAUDE_CONFIG_DIR;
      delete baseEnv.DOTFILES_FORCE_COPY;
      const result = spawnSync(process.execPath, [join(repo, "engine", "install.mjs"), ...args], {
        encoding: "utf8",
        env: { ...envWithPath(baseEnv, path ?? `${bin}${pathSeparator()}${process.env.PATH ?? process.env.Path ?? ""}`), ...env },
      });
      return { code: result.status, stdout: result.stdout, stderr: result.stderr };
    },

    claudeCalls() {
      try {
        return readFileSync(claudeCalls, "utf8").trimEnd().split("\n").filter(Boolean).map((l) => JSON.parse(l));
      } catch {
        return [];
      }
    },

    readSettings() {
      return JSON.parse(readFileSync(join(claudeDir, "settings.json"), "utf8"));
    },

    // Writes a JSON file into one layer of the throwaway clone: "base", "profile" or "local".
    writeLayer(layer, file, value) {
      mkdirSync(join(repo, layer), { recursive: true });
      writeFileSync(join(repo, layer, file), typeof value === "string" ? value : JSON.stringify(value, null, 2));
    },

    // Puts a settings.json on the machine as it was before the install.
    writeMachineSettings(value) {
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(value));
    },

    removeLayer(layer) {
      rmSync(join(repo, layer), { recursive: true, force: true });
    },

    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

export function pathSeparator() {
  return process.platform === "win32" ? ";" : ":";
}
