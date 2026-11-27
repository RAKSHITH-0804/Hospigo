# Continue Hospigo on another laptop (and another Claude account)

Written 28 Nov 2026. Everything built so far is on GitHub. Secrets (`.env`) and databases are NOT in Git: you create them again on the new laptop (about 30 minutes, then 10 minutes for the demo data).

## 1. What to install first (Windows)

| Tool                             | Version                          | Note                                                                          |
| -------------------------------- | -------------------------------- | ----------------------------------------------------------------------------- |
| Git                              | any recent                       | with Git Bash (all commands below are for Git Bash)                           |
| Node.js                          | **22.14 or newer 22.x** (not 23) | `node -v` must say v22                                                        |
| PostgreSQL                       | **16**                           | remember the `postgres` superuser password you choose; pgAdmin is optional    |
| Memurai (Redis for Windows)      | any                              | it must listen on port 6379                                                   |
| Mailpit                          | optional                         | only to see staff emails (reset links, activation) on `http://127.0.0.1:8025` |
| Chrome                           | any                              | the browser tests use it                                                      |
| Claude Code (desktop app or CLI) | latest                           | sign in with the new account                                                  |

No Docker. npm only (never yarn or pnpm).

## 2. Get the code

```bash
git clone https://github.com/RAKSHITH-0804/Hospigo.git "Hospigo Code"
cd "Hospigo Code"
git checkout feature/step-2-3-feedback
git log --oneline -3
```

The branch `feature/step-2-3-feedback` holds ALL the work of Phase 2.1, 2.2 and 2.3 Part 1 (the older feature branches are inside it). `develop` on GitHub is older (it stops at Step 9). Do not start from `develop`. A zip download of that branch also works, but then `git` history is missing; prefer the clone.

```bash
npm install
```

(This also activates the Husky hooks: lint runs before every commit.)

## 3. Create `.env` (the part that is not in Git)

```bash
cp .env.example .env
```

Open `.env` in the editor and replace every `CHANGE_ME`. The names are all explained in `.env.example` and in `README.md` ("`.env` keys"). Short version:

- `POSTGRES_SUPERUSER_URL`: the `postgres` password you set when installing PostgreSQL.
- `HOSPIGO_OWNER_PASSWORD`, `HOSPIGO_APP_PASSWORD`, `HOSPIGO_HQ_PASSWORD`, `HOSPIGO_PATIENT_PASSWORD`: choose new random values: `openssl rand -hex 24` for each. Put the SAME value into the matching `DATABASE_URL...` lines (the user in the URL tells which: `hospigo_app`, `hospigo_owner`, `hospigo_hq`, `hospigo_patient`).
- `JWT_HOSPITAL_ACCESS_SECRET`, `JWT_HQ_ACCESS_SECRET`, `JWT_PATIENT_ACCESS_SECRET` (and the refresh secrets if the file lists them): three or more DIFFERENT random values, 32 characters or more.
- `STORAGE_ROOT_PATH`: an absolute folder that exists, for example `C:\hospigo-storage`.
- `SEED_SUPERADMIN_PASSWORD`, `SEED_BRANCH_ADMIN_PASSWORD`, `SEED_STAFF_PASSWORD`, `SEED_INDIGO_PASSWORD`: the passwords the demo people will have. Pick simple ones you can type (they are for the local demo only). The password rules need 10 or more characters with letters and digits.
- Also copy `.env.example`'s web lines into `apps/web/.env.local` if the README asks for it (`API_INTERNAL_URL=http://127.0.0.1:3000`).

Never commit `.env`, never paste a password into chat.

## 4. Databases

```bash
node scripts/db/create-roles.mjs        # creates the database roles and the databases hospigo and hospigo_test
npm run prisma:migrate -w @hospigo/api  # applies every migration to hospigo
npm run dev:reset                       # (several minutes) rebuilds hospigo with the two realistic hospitals and their history
```

For the test database (used by Jest, Newman and the browser tests) and its demo fixtures:

```bash
npm run e2e:fresh
```

## 5. Start everything (each in its own terminal)

```bash
npm run dev -w @hospigo/api     # API on port 3000
npm run dev -w @hospigo/web     # web on port 3001
```

Memurai must be running. Open `http://127.0.0.1:3001` (always `127.0.0.1`, never `localhost`).

Logins: `docs/guides/demo-script.md` and `docs/guides/dev-accounts.md` (emails and access codes; the passwords are the ones you put in `.env`).

## 6. Check that everything works

```bash
npm run lint
npm run format:check
npm test -w @hospigo/api      # about 1131 tests, 5 to 10 minutes
npm test -w @hospigo/web      # about 1867 tests
```

All green means the new laptop is exactly where the old one stopped.

## 7. Claude Code on the new laptop

1. Open the folder `Hospigo Code` in Claude Code. It reads `CLAUDE.md` by itself (the working rules).
2. The old account's memory does not move. Everything Claude needs is in the repo docs. Paste this as your FIRST message:

> Read CLAUDE.md, then docs/handoff-phase2.md (section CURRENT STATE) and docs/guides/new-laptop-setup.md. We are on branch feature/step-2-3-feedback. Phase 2.3 Part 1 is done. Start Phase 2.3 Part 2 exactly as written in docs/plans/phase-2-3-part2-performance.md. Give me the plan first and wait for my "approved".

## 8. What is done and what is next

- **Done (all built, not yet pushed to `develop`, not yet through the final test round):** Phase 2.1 (all steps), Phase 2.2 (HQ without entry, HQ console, UI redesign), Phase 2.3 Part 1 (Rakshith's change list). Details: `docs/handoff-phase2.md`, `docs/decisions/decisions-2-2.md`, `docs/decisions/decisions-2-3.md`.
- **Next: Phase 2.3 Part 2, speed and load.** The plan is `docs/plans/phase-2-3-part2-performance.md`.
- **Then, at the very end:** the one test round for Phase 2.1, 2.2 and 2.3 (`docs/guides/phase-2-2-testing.md`: manual checklist A to N, e2e on the isolated stack, Newman), and the pull requests into `develop`.

## 9. If something does not start

- API refuses to start and names a migration: run `npm run prisma:migrate -w @hospigo/api`.
- "too many login tries": wait one minute (limit about 20 a minute).
- Port in use: `docs/guides/dev-commands.md`, section 10.
- A page says `Rendering…` for long: that is the development server compiling; measure speed with the production build (`docs/guides/dev-commands.md`, section 9).
