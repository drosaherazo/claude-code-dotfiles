# Claude Code dotfiles

A portable Claude Code setup: clone it on any machine (Windows, macOS or Linux), run one command, and Claude Code works the same way everywhere, whatever the account or employer.

## Layers

**Engine**:
The machinery that installs, syncs and checks a setup; it holds nobody's preferences.
_Avoid_: core, framework, scripts

**Base**:
What every install gets by default because it improves Claude Code for anyone, beginner or expert.
_Avoid_: defaults, shared config, common

**Profile**:
One person's own preferences, kept in its own folder; each fork replaces it and never sends it back.
_Avoid_: user config, personal settings, overrides

**Local layer**:
What belongs to one machine only and never reaches GitHub, such as a paid theme or a work-only plugin.
_Avoid_: private config, secrets, machine profile

## Keeping machines alike

**Linked file**:
A file in `~/.claude` that points into the repo, so editing either edits both.
_Avoid_: symlinked config, managed file

**Pinned skill**:
A third-party skill listed by its source repository and a fixed commit, fetched at install time rather than copied into the repo.
_Avoid_: vendored skill, external skill

**Drift**:
Anything installed or set on a machine that neither the repo nor its local layer accounts for.
_Avoid_: diff, divergence, out of sync

**Sync**:
Bringing a machine up to date with the repo on GitHub: pull, then install what changed.
_Avoid_: update, refresh, pull
