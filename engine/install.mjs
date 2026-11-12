#!/usr/bin/env node
// The engine's installer: brings this machine's ~/.claude in line with the repo.
// No third-party dependencies and no personal values: everything personal comes from
// the profile or the local layer.
//
// It first plans every step by looking at the machine, then applies the plan, so a run
// that has nothing to do changes nothing.
import { spawnSync } from "node:child_process";
import { isDeepStrictEqual } from "node:util";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const claudeDir = process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");

// Files linked into ~/.claude: [path in the repo, name in ~/.claude].
const LINKED_FILES = [["base/statusline.mjs", "statusline.mjs"]];

// One timestamped folder per run, created only when something is actually replaced.
let backupDir = null;
const backupFolder = () => {
  if (!backupDir) {
    const stamp = new Date().toISOString().replace(/\.\d+Z$/, "").replaceAll(":", "-");
    backupDir = join(claudeDir, "backups", stamp);
    for (let n = 2; existsSync(backupDir); n++) backupDir = join(claudeDir, "backups", `${stamp}-${n}`);
    mkdirSync(backupDir, { recursive: true });
  }
  return backupDir;
};

const lstatOrNull = (path) => {
  try {
    return lstatSync(path);
  } catch {
    return null;
  }
};

const isLinkedTo = (target, source) => {
  try {
    return lstatSync(target).isSymbolicLink() && realpathSync(target) === realpathSync(source);
  } catch {
    return false;
  }
};

const sameContent = (a, b) => readFileSync(a).equals(readFileSync(b));

// Windows allows symlinks only with Developer Mode or an elevated shell (ADR 0003). The probe
// runs in the system temp folder so that a dry run never touches the home folder.
// DOTFILES_FORCE_COPY makes the copy fallback testable on any machine.
const symlinksAllowed = () => {
  if (process.env.DOTFILES_FORCE_COPY) return false;
  const dir = mkdtempSync(join(tmpdir(), "claude-dotfiles-"));
  try {
    writeFileSync(join(dir, "target"), "");
    symlinkSync(join(dir, "target"), join(dir, "link"), "file");
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
const canLink = symlinksAllowed();

function planLinkedFile(repoPath, name) {
  const source = join(repo, repoPath);
  const target = join(claudeDir, name);
  const existing = lstatOrNull(target);
  if (isLinkedTo(target, source)) return { action: null, name };
  // Where links are not allowed, an up-to-date copy is as good as it gets.
  if (!canLink && existing?.isFile() && sameContent(target, source)) return { action: null, name };
  return {
    action: canLink ? "link" : "copy",
    done: canLink ? "linked" : "copied",
    name,
    apply() {
      mkdirSync(claudeDir, { recursive: true });
      if (existing) renameSync(target, join(backupFolder(), name));
      if (canLink) {
        try {
          symlinkSync(source, target, "file");
          return;
        } catch (error) {
          if (error.code !== "EPERM") throw error;
        }
      }
      copyFileSync(source, target);
      this.done = "copied";
    },
  };
}

// A JSON file's contents, or `fallback` when the file does not exist.
const readJson = (path, fallback) => {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} is not valid JSON (${error.message}). Fix or remove it, then run the installer again.`);
  }
};

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

// The items of `under` followed by those of `over` it lacks.
const combineLists = (under, over) =>
  over.reduce((list, item) => (list.some((kept) => isDeepStrictEqual(kept, item)) ? list : [...list, item]), [...under]);

// `over` wins over `under`: objects merge key by key and lists are combined without repeats,
// so a machine keeps what it accepted (such as permissions); any other value is replaced.
const mergeSettings = (under, over) => {
  const merged = { ...under };
  for (const [key, value] of Object.entries(over)) {
    if (isPlainObject(value) && isPlainObject(under[key])) merged[key] = mergeSettings(under[key], value);
    else if (Array.isArray(value) && Array.isArray(under[key])) merged[key] = combineLists(under[key], value);
    else merged[key] = value;
  }
  return merged;
};

// The dotted paths of every setting whose value differs between `before` and `after`.
const changedKeys = (before, after, prefix = "") =>
  Object.keys(after).flatMap((key) => {
    const path = `${prefix}${key}`;
    if (isPlainObject(before?.[key]) && isPlainObject(after[key])) return changedKeys(before[key], after[key], `${path}.`);
    return isDeepStrictEqual(before?.[key], after[key]) ? [] : [path];
  });

function planSettings() {
  const name = "settings.json";
  const path = join(claudeDir, name);
  const machine = readJson(path, null);
  // The base also carries the status line command, which holds this machine's absolute path.
  const base = mergeSettings(readJson(join(repo, "base", name), {}), {
    statusLine: { type: "command", command: `node "${join(claudeDir, "statusline.mjs").replaceAll("\\", "/")}"` },
  });
  // Precedence, lowest first (ADR 0004): machine < base < profile < local layer.
  const layers = [base, readJson(join(repo, "profile", name), {}), readJson(join(repo, "local", name), {})];
  const settings = layers.reduce(mergeSettings, machine ?? {});
  const changed = changedKeys(machine ?? {}, settings);
  if (changed.length === 0) return { action: null, name };
  return {
    action: "merge",
    done: "merged",
    name,
    detail: changed.join(", "),
    apply() {
      mkdirSync(claudeDir, { recursive: true });
      if (machine) copyFileSync(path, join(backupFolder(), basename(path)));
      writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
    },
  };
}

const USAGE = "Usage: node engine/install.mjs [--dry-run]";
const args = process.argv.slice(2);
const unknown = args.filter((arg) => arg !== "--dry-run");
if (unknown.length > 0) {
  console.error(`error: unknown option ${unknown.join(", ")}\n${USAGE}`);
  process.exit(1);
}
const dryRun = args.includes("--dry-run");

const fail = (message) => {
  console.error(`error: ${message}`);
  process.exit(1);
};

// git fetches and syncs the repo; Node runs the status line through `node` on the PATH.
const REQUIRED_TOOLS = ["git", "node"];
const missing = REQUIRED_TOOLS.filter((tool) => spawnSync(tool, ["--version"], { stdio: "ignore" }).error);
if (missing.length > 0) {
  fail(`${missing.join(" and ")} not found on the PATH. Install ${missing.join(" and ")}, then run the installer again.`);
}

process.on("uncaughtException", (error) => fail(error.message));

const steps = [...LINKED_FILES.map(([repoPath, name]) => planLinkedFile(repoPath, name)), planSettings()];
const changes = steps.filter((step) => step.action);
const describe = (step) => (step.detail ? `${step.name} (${step.detail})` : step.name);

if (dryRun) {
  console.log(`Claude Code dotfiles (dry run, nothing will be changed): ${claudeDir}`);
  for (const step of changes) console.log(`  would ${step.action.padEnd(6)} ${describe(step)}`);
} else {
  for (const step of changes) step.apply();
  console.log(`Claude Code dotfiles: ${claudeDir}`);
  for (const step of changes) console.log(`  ${step.done.padEnd(7)} ${describe(step)}`);
  if (backupDir) console.log(`Backed up replaced files to ${backupDir}`);
}
if (changes.length === 0) {
  console.log("Nothing to change: this machine already matches the repo.");
} else if (!dryRun) {
  const count = (done) => changes.filter((step) => step.done === done).length;
  const copied = count("copied");
  console.log(
    `Summary: ${count("linked")} linked, ${copied} copied, ${count("merged")} merged, ${steps.length - changes.length} unchanged.`,
  );
  if (copied > 0) {
    console.log(
      "Warning: symlinks are not allowed on this machine, so files were copied instead of linked.\n" +
        "Edits in ~/.claude will not reach the repo, and after changing the repo you need to run the installer again.\n" +
        "On Windows, turning on Developer Mode allows links.",
    );
  }
}
