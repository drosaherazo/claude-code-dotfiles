// Settings from the layers (ADR 0001, ADR 0004): base, profile and local layer each declare
// settings, merged into the machine's settings.json with local > profile > base > machine.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createWorld } from "./harness.mjs";

let world;
beforeEach(() => {
  world = createWorld();
});
afterEach(() => {
  world.cleanup();
});

test("settings from the base, the profile and the local layer all reach the machine", () => {
  world.writeLayer("base", "settings.json", { fromBase: true });
  world.writeLayer("profile", "settings.json", { fromProfile: true });
  world.writeLayer("local", "settings.json", { fromLocal: true });

  const result = world.install();

  assert.equal(result.code, 0, result.stderr);
  const settings = world.readSettings();
  assert.equal(settings.fromBase, true);
  assert.equal(settings.fromProfile, true);
  assert.equal(settings.fromLocal, true);
});

test("precedence is local layer over profile over base over the machine's existing keys", () => {
  world.writeMachineSettings({ a: "machine", b: "machine", c: "machine", d: "machine" });
  world.writeLayer("base", "settings.json", { a: "base", b: "base", c: "base" });
  world.writeLayer("profile", "settings.json", { a: "profile", b: "profile" });
  world.writeLayer("local", "settings.json", { a: "local" });

  assert.equal(world.install().code, 0);

  const { a, b, c, d } = world.readSettings();
  assert.deepEqual({ a, b, c, d }, { a: "local", b: "profile", c: "base", d: "machine" });
});

test("machine-only keys such as accepted permissions survive an install", () => {
  world.writeMachineSettings({ permissions: { allow: ["Bash(npm test)"] }, feedbackSurveyState: { seen: true } });
  world.writeLayer("profile", "settings.json", { permissions: { defaultMode: "auto" } });

  assert.equal(world.install().code, 0);

  const settings = world.readSettings();
  assert.deepEqual(settings.permissions, { allow: ["Bash(npm test)"], defaultMode: "auto" });
  assert.deepEqual(settings.feedbackSurveyState, { seen: true });
});

test("nested objects merge key by key across the layers", () => {
  world.writeMachineSettings({ enabledPlugins: { "machine@market": true } });
  world.writeLayer("base", "settings.json", { enabledPlugins: { "base@market": true }, modelSettings: { m: { effortLevel: "low", extra: 1 } } });
  world.writeLayer("profile", "settings.json", { enabledPlugins: { "profile@market": true }, modelSettings: { m: { effortLevel: "medium" } } });

  assert.equal(world.install().code, 0);

  const settings = world.readSettings();
  assert.deepEqual(settings.enabledPlugins, { "machine@market": true, "base@market": true, "profile@market": true });
  assert.deepEqual(settings.modelSettings, { m: { effortLevel: "medium", extra: 1 } });
});

test("a missing profile or local layer is not an error", () => {
  world.removeLayer("profile");
  world.removeLayer("local");
  world.writeLayer("base", "settings.json", { fromBase: true });

  const result = world.install();

  assert.equal(result.code, 0, result.stderr);
  assert.equal(world.readSettings().fromBase, true);
});

test("a dry run shows the settings that would change", () => {
  world.writeMachineSettings({ model: "sonnet", permissions: { defaultMode: "auto" } });
  world.writeLayer("profile", "settings.json", { model: "opus", permissions: { defaultMode: "auto" } });

  const result = world.install(["--dry-run"]);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /would merge\s+settings\.json \(model, statusLine\)/);
  assert.equal(world.readSettings().model, "sonnet");
});

test("a malformed layer settings file stops the install with a message naming it", () => {
  world.writeLayer("local", "settings.json", "{ nope");

  const result = world.install();

  assert.equal(result.code, 1);
  assert.match(result.stderr, /local[\\/]settings\.json is not valid JSON/);
});
