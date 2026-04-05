# Dental Ledger Studio

Ledger-first dental billing and claims review that makes every balance, insurance decision, and review flag explainable.

![Dashboard hero](docs/screenshots/01-dashboard.png)

## What This Product Does

Dental Ledger Studio is a ledger-first dental billing and claims review product. It helps teams understand balances, preserve claim context, and work denials and flags without reconstructing history.

- Trace every balance to ledger events.
- Preserve insurance context by date of service.
- Turn denials, flags, and analytics into explicit follow-up work.

## The Problem It Solves

Dental billing gets hard to trust when balances move without explanation, insurance changes near the visit date, and denied claims force staff to reconstruct what happened after the fact.

This product is built around three trust questions:

- What changed?
- Why did it change?
- What should the team do next?

## Why It Stands Out

- Append-only ledger: balances are derived from financial events instead of stored balance fields.
- Immutable claim history: submissions and decisions append context instead of overwriting earlier records.
- Action-oriented review: flags and analytics are designed to drive follow-up work, not just report status.

## Demo In 60 Seconds

`Sign in -> Dashboard -> Maria Chen 41 -> denied claim timeline -> Analytics`

1. Dashboard: show balances at risk, open flags, and insurance ambiguity.
2. `Maria Chen 41`: show the balance snapshot, patient activity, and open review flags.
3. Denied claim timeline: show the preserved insurance snapshot, submission history, and ledger-backed balance.
4. Analytics: show the priority queue and root causes driving follow-up work.

## Workflow At A Glance

<p align="center">
  <img src="docs/screenshots/02-patient-detail.png" alt="Patient detail" width="32%" />
  <img src="docs/screenshots/03-claim-review.png" alt="Claim review" width="32%" />
  <img src="docs/screenshots/04-analytics.png" alt="Analytics" width="32%" />
</p>
<p align="center"><sub>Patient detail</sub> | <sub>Claim review</sub> | <sub>Analytics</sub></p>

## Core Workflows

- Daily operations: move from appointment to intake without losing billing context.
- Patient account review: inspect visits, services, payments, insurance history, and flags in one place.
- Claim handling: record payer decisions, resubmissions, and patient payments without rewriting history.
- Review queue: focus the team on the highest-friction billing issues first.
- Analytics: surface revenue risk, denial patterns, and operational bottlenecks.

## Architecture And Data Model

Next.js App Router application backed by Prisma and SQLite.

Key domain objects:

- `Patient`: demographics, coverage, activity, and account ledger events
- `Visit`: date of service, appointment linkage, and procedures
- `Claim`: immutable insurance snapshot, status, submissions, decisions, and packets
- `LedgerEvent`: append-only charge, payment, adjustment, credit, and note events
- `Flag`: manual or system review issue with reason and status

Important product decisions:

- balances are derived dynamically from ledger events
- insurance is selected by date of service, not by "current insurance"
- resubmissions append history instead of rewriting earlier claim context
- review flags can reopen when later changes reintroduce risk

## Tech Stack

- Next.js + TypeScript: full-stack product shell and typed workflow logic.
- Prisma + SQLite: lightweight relational data layer for local setup and seeded demos.
- Tailwind CSS: card-based operational UI optimized for scanability.
- Zod: runtime validation at request and business-rule boundaries.
- Vitest + Playwright: regression coverage for domain logic and demo-path smoke tests.
- Windows launchers: one-click setup, validation, and local startup.

## Run Locally

### One-click Windows launch

Use one of these from the repo root:

- `One Click Run.bat`
- `One Click Reset and Run.bat`

The standard launcher uses a separate validation database, preserves the local dev database, runs Prisma setup, validates the app, starts the dev server, and opens the browser.

### Manual run

```bash
npm install
npm run prisma:generate
npm run prisma:push
npm run seed
npm run typecheck
npm run lint
npm run test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Seeded Demo Data

Synthetic demo data includes patients, insurers, paid claims, denied claims, flags, credits, adjustments, and resubmission scenarios.

Use the demo path above for the fastest walkthrough.

## Product Decisions And Tradeoffs

- Auth is intentionally lightweight for a local demo rather than production RBAC.
- Payer integrations are not implemented; claim decisions are entered locally.
- SQLite keeps local setup simple and portable.
- The seeded data is curated for demo clarity, not for exhaustive production realism.

## Supporting Docs

- Case study: [docs/case-study.md](docs/case-study.md)
- 60-second demo script: [docs/demo-script.md](docs/demo-script.md)
- Resume and interview framing: [docs/resume-bullets.md](docs/resume-bullets.md)
- Screenshot recapture notes: [docs/screenshot-shotlist.md](docs/screenshot-shotlist.md)
