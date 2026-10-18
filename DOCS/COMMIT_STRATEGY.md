# Commit strategy for contributors

Contributors must commit only the work that belongs to their change. Do not use
`git add .`, `git add -A`, or another broad staging command: those commands can
include unrelated files, generated output, local configuration, or another
contributor's unfinished work.

## Safe workflow

1. Review the working tree before editing:

   ```bash
   git status --short
   git diff
   ```

2. Stage only the exact files changed for the task. Use explicit paths:

   ```bash
   git add server/app.js server/tests/app.test.js
   ```

   For a new file, name that file explicitly:

   ```bash
   git add DOCS/COMMIT_STRATEGY.md
   ```

3. Inspect the staged patch before committing:

   ```bash
   git diff --cached --check
   git diff --cached
   git status --short
   ```

4. Commit only after confirming that every staged file belongs to the task:

   ```bash
   git commit -m "Describe one focused change"
   ```

## Rules

- Keep commits focused and logically complete.
- Do not stage `node_modules`, `.env` files, logs, coverage, build output, or
  unrelated edits.
- Do not use `git commit -a` as a shortcut; it stages tracked changes without
  giving the contributor a deliberate file-by-file review.
- If another contributor's changes are already present, leave them unstaged.
- If a file contains mixed work, stage only selected hunks with `git add -p` or
  edit the file so the commit contains only the intended change.
- Before handing off, report the commit hash and the exact files included.
