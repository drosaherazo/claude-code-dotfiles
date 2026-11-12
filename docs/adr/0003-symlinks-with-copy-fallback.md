# Link files into ~/.claude, copying only where links are not allowed

The repo is the single source of truth, so the installer symlinks files into `~/.claude`: tweaking the status line or the theme edits the repo and is ready to commit. Windows only allows symlinks with Developer Mode or an elevated shell, so where linking fails the installer copies the file instead and warns that on that machine changes need the installer run again.

## Considered Options

- **Copy everything:** works everywhere, but edits in `~/.claude` never reach the repo and machines drift silently.
- **Symlink only:** blocks installation on locked-down machines, such as many work laptops.
