# Split the repo into engine, base and profile

The repo is both one person's portable setup and a template others fork and improve. Mixing personal preferences with improvements would make every pull request drag someone's profile along, so the repo is split into three layers: the engine (install, sync, drift check), the base (what improves Claude Code for anyone) and the profile (one person's preferences, in `profile/`). Pull requests are welcome for the engine and base; a fork changes only `profile/`, so GitHub's "Sync fork" brings upstream improvements without conflicts.

## Considered Options

- **Two layers (engine and profile):** rejected because it leaves nowhere for shared defaults that benefit everyone, which is exactly what contributors should improve.
- **Two repositories (a generic engine and personal dotfiles on top):** cleaner in theory, but doubles the maintenance for a single maintainer.
