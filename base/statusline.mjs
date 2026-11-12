// Claude Code status line: model · tokens in context · % of the context window used.
// Reads the session JSON from stdin. Uses the context_window fields when Claude Code sends them,
// otherwise falls back to the usage of the last assistant message in the transcript.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

let data = {};
try {
  data = JSON.parse(readFileSync(0, "utf8"));
} catch {}

const modelId = data.model?.id ?? "";
const modelName = data.model?.display_name ?? modelId ?? "Claude";
const cw = data.context_window ?? {};

const sumUsage = (u) =>
  (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);

let used = cw.current_usage ? sumUsage(cw.current_usage) : null;

if (used === null && data.transcript_path) {
  try {
    const lines = readFileSync(data.transcript_path, "utf8").trimEnd().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]);
        const usage = entry.message?.usage;
        if (entry.type === "assistant" && usage && !entry.isSidechain) {
          used = sumUsage(usage);
          break;
        }
      } catch {}
    }
  } catch {}
}

const size = cw.context_window_size ?? (/\[1m\]|1m/i.test(modelId) ? 1_000_000 : 200_000);
const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1)}k` : String(n));

// Git summary for the session's directory: "⎇ main ↑1 ↓0 · 3 changed". Read-only
// (--no-optional-locks never refreshes the index); empty outside a repo.
const gitSummary = () => {
  const cwd = data.workspace?.current_dir ?? data.cwd;
  if (!cwd) return "";
  try {
    const out = execFileSync(
      "git",
      ["--no-optional-locks", "status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
      { cwd, encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] },
    );
    let branch = "";
    let oid = "";
    let ab = "";
    const paths = new Set();
    const records = out.split("\0");
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.startsWith("# branch.oid ")) oid = r.slice(13);
      else if (r.startsWith("# branch.head ")) branch = r.slice(14);
      else if (r.startsWith("# branch.ab ")) {
        const [a, b] = r.slice(12).split(" ");
        ab = ` ↑${Math.abs(Number(a))} ↓${Math.abs(Number(b))}`;
      } else if (/^[12u?] /.test(r)) {
        paths.add(r);
        if (r[0] === "2") i++; // a rename's original path is the next record
      }
    }
    if (branch === "(detached)") branch = `detached @ ${oid.slice(0, 7)}`;
    const changed = paths.size === 0 ? "clean" : `${paths.size} changed`;
    return ` · \x1b[36m⎇ ${branch}${ab}\x1b[0m · ${changed}`;
  } catch {
    return "";
  }
};

if (used === null) {
  process.stdout.write(`${modelName} · context: –${gitSummary()}`);
} else {
  const pct = Math.min(100, (used / size) * 100);
  const color = pct >= 80 ? "\x1b[31m" : pct >= 60 ? "\x1b[33m" : "\x1b[32m";
  process.stdout.write(
    `${modelName} · ${fmt(used)} / ${fmt(size)} tokens · ${color}${pct.toFixed(0)}% context\x1b[0m${gitSummary()}`,
  );
}
