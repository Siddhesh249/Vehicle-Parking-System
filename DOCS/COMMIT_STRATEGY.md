# Commit strategy for contributors

Contributors must commit only the work that belongs to their change. Do not use
`git add .`, `git add -A`, or another broad staging command: those commands can
include unrelated files, generated output, local configuration, or another
contributor's unfinished work.

## Safe workflow

1. Review the working tree:

   ```bash
   git status --short
   git diff
   ```

2. Stage only exact paths:

   ```bash
   git add server/app.js server/tests/app.test.js
   ```

3. Inspect the staged patch:

   ```bash
   git diff --cached --check
   git diff --cached
   git status --short
   ```

4. Commit one focused change:

   ```bash
   git commit -m "Describe one focused change"
   ```

## Rules

- Keep commits focused and logically complete.
- Never stage `node_modules`, `.env` files, logs, coverage, build output, or
  unrelated edits.
- Do not use `git commit -a` as a shortcut; review files deliberately.
- If another contributor's changes are present, leave them unstaged.
- For mixed work, use `git add -p` or separate the edits before committing.
- Before handoff, report the commit hash and exact files included.
