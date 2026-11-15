# Git workflow

This project uses a sprint branch to collect the work for each sprint while
keeping `main` stable.

## Branch and pull request flow

1. Keep `main` as the stable branch. Start each sprint branch from `main`, for
   example, `sprint1`.
2. Add that sprint's test cases to its sprint branch so the acceptance checks
   are available while the sprint work is developed.
3. Each developer creates a feature branch from the current sprint branch,
   implements their assigned work, and opens a pull request targeting that
   sprint branch. Review and merge the pull requests there.
4. Validate the integrated work on the sprint branch. When the sprint branch
   is stable, merge it into `main`.
5. Create the next sprint branch from the updated `main` and repeat the flow.

In short:

```text
main → sprint branch → developer feature branches → PRs into sprint branch
    → validate sprint branch → merge sprint branch into main
```

This keeps in-progress sprint work and its integration fixes off `main` until
the sprint is ready to be accepted as a stable project state.
