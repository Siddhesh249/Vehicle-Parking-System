# Contributing

## Branch strategy

Keep the sprint branches as integration targets:

- `sprint1` — Sprint 1 work
- `sprint2` — Sprint 2 work
- `sprint3` — Sprint 3 work
- `sprint4` — Sprint 4 and final integration

Do not commit directly to a sprint integration branch when working on an individual task. Create a short-lived branch from the relevant sprint branch, using one of these prefixes:

- `feature/<short-task-name>` for new functionality
- `fix/<short-task-name>` for bug fixes
- `test/<short-task-name>` for test-only changes

Open a pull request back to the same sprint branch. Include the sprint/task ID in the PR title, explain the behavior changed, and list the commands/tests run. Do not merge a PR while required checks are failing. Keep unrelated task-owner changes out of the PR.

## Local setup

The repository has independent root, server and client npm packages. Install dependencies from the repository root:

```bash
npm ci
npm ci --prefix server
npm ci --prefix client
```

Copy `server/.env.example` to `server/.env` and set local MongoDB credentials and a long random `JWT_SECRET`. Never commit `.env` files or real credentials. The server example file documents the supported environment variables.

Run the checks from the repository root:

```bash
npm test
npm run lint
npm run format:check
```

Start the backend and frontend in separate terminals using the commands documented in the root README and `client/README.md`.

## Pull request checklist

- [ ] PR targets the correct sprint integration branch.
- [ ] Only the assigned task scope is included.
- [ ] Input validation and error cases are covered.
- [ ] Relevant unit/integration tests are added or updated.
- [ ] Tests, lint and formatting checks have been run.
- [ ] No secrets, local environment files or generated dependencies are committed.
- [ ] CI checks pass, or known unrelated failures are documented with their owning task.
