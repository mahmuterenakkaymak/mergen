# MERGEN's workspace files

Templates of the identity files OpenClaw reads at the start of every session:

- `IDENTITY.md` - name (MERGEN, the Turkic god of wisdom and reason), vibe, emoji 🏹
- `SOUL.md` - voice and the questioning style (push back, separate known from guessed)
- `AGENTS.md` - red lines (confirm before delete/move, data stays home, secrets in env vars, read-only DBs, numbers
  computed in code, never switch GPU modes), the software-pipeline rule, environment, messaging and automation rules

`scripts/03-configure-openclaw.ps1` fills in `{{USER_NAME}}`, `{{OPENCLAW_WORKSPACE}}`, `{{PROJECTS_DIR}}`,
`{{MERGEN_HOME}}` and `{{USERPROFILE}}` and writes them to `~\.openclaw\workspace` - only when a file is missing, so an
existing workspace is never overwritten. Set `$UserName` at the top of that script to the name MERGEN should call you.

Add your own `USER.md` there (your role, skills, preferences, projects): it is personal and does not belong in a repo.
Then delete `BOOTSTRAP.md` and run
`openclaw agents set-identity --workspace "<workspace>" --name MERGEN --theme "<vibe>" --emoji "🏹"`.

The persona speaks the language chosen in `03-configure-openclaw.ps1` (`{{LANGUAGE}}` in `SOUL.md` and the
skills); identity files that already exist are kept, so edit the "Speak ..." line in `SOUL.md` to change it later.
