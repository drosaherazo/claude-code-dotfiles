// Guards for rules that hold across the engine, the base and the plugins (ADR 0001): they work on a
// fresh machine with nothing but Node, and they carry nobody's personal values.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const filesIn = (folder) =>
  readdirSync(join(root, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name));

const shared = [...filesIn("engine"), ...filesIn("base"), ...filesIn("plugins")];

test("the engine and the base scripts import only Node's built-in modules or their own files", () => {
  const offenders = [];
  for (const file of shared.filter((f) => f.endsWith(".mjs"))) {
    const source = readFileSync(file, "utf8");
    for (const [, specifier] of source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      if (!specifier.startsWith("node:") && !specifier.startsWith(".")) {
        offenders.push(`${relative(root, file)}: ${specifier}`);
      }
    }
  }
  assert.deepEqual(offenders, []);

  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
});

test("the engine, the base and the plugins contain no personal values such as home paths or email addresses", () => {
  const personal = [
    /[A-Za-z]:[\\/]Users[\\/]/, // Windows home folder
    /\/(?:Users|home)\/[a-z]/, // macOS or Linux home folder
    /[\w.+-]+@[\w-]+\.[a-z]{2,}/i, // email address
  ];
  const offenders = [];
  for (const file of shared) {
    const source = readFileSync(file, "utf8");
    for (const pattern of personal) {
      const match = source.match(pattern);
      if (match) offenders.push(`${relative(root, file)}: ${match[0]}`);
    }
  }
  assert.deepEqual(offenders, []);
});
