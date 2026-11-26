# Hospigo docs: where things are

Start with the four living files in this folder. Everything else is grouped by what it is for.

## Living files (read these first, every session)

| File                                             | What it is                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| [handoff-phase2.md](handoff-phase2.md)           | **CURRENT STATE** at the top: what is done, what is next, open questions |
| [engineering-tracker.md](engineering-tracker.md) | Step table and status of every step                                      |
| [project-context.md](project-context.md)         | What Hospigo is and every decision behind it                             |
| [CHANGELOG.md](CHANGELOG.md)                     | One entry per step: what was added, changed, tested                      |
| [exit-report-phase2.md](exit-report-phase2.md)   | Phase 2 exit report: built, deferred, known limits, go-live blockers     |

## Folders

| Folder                   | What it holds                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| [decisions/](decisions/) | One file per step (`decisions-7d.md`, ...): what was decided and built, the self-review, "Not done"                    |
| [reference/](reference/) | How the system is built: API references, schema, architecture, env variables, CI, folder guide                         |
| [guides/](guides/)       | How to work with it: dev commands, demo accounts, new hospital runbook, manual regression checklist, staging checklist |
| [design/](design/)       | How screens look: `ui-design.md` (current rules), concept screens (history), the concept PDF                           |
| [audit/](audit/)         | Audits: `phase2-audit.md` (plan vs built, proof, security and money, decisions needed)                                 |
| [plans/](plans/)         | What is planned: the OPD first-flow plan, use cases, the future Lab and Pharmacy notes                                 |

## Where do I add new things?

- A new step: `decisions/decisions-<step>.md`, then update the four living files.
- A new API route or schema change: the matching section in `reference/api-opd.md`, `reference/api-auth.md` or `reference/schema-opd.md`.
- A new screen rule: `design/ui-design.md`.
- A new env variable (names only): `reference/env-reference.md`.
- A new command or demo login: `guides/dev-commands.md` or `guides/dev-accounts.md`.
- A new idea for later: `plans/`.
