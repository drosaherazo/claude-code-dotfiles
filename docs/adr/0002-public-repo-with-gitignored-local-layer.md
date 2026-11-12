# Keep the repo public and put machine-only content in a gitignored local layer

The repo is public so it can be cloned anywhere without signing in and serve as a portfolio piece. Some things must never be published: a paid theme whose licence forbids redistribution (Dracula Pro, while the classic Dracula is MIT), or a plugin from an employer's internal marketplace. They live in `local/`, ignored by git: the installer applies what it finds there and the drift check ignores it, so one pattern covers every private case.

## Consequences

- A fresh clone always works with the public base alone; the local layer only adds to it.
- Whatever is in `local/` has to be copied to a new machine by hand.
