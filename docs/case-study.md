# Dental Ledger Studio Case Study

## Problem

Dental billing is operationally messy in ways that are easy to hide in software. Insurance can shift near the date of service, denied claims create rework, and balances often update without a clear explanation for staff or patients.

The product problem here is not just "billing software." It is trust. A user needs to understand what happened, why it happened, and what to do next.

## User

This workflow is built for three practical users:

- front desk staff closing the loop from appointment to intake
- billing staff reviewing denials, balances, and follow-up work
- practice leaders watching risk, backlog, and cash exposure

## Product Bet

The core bet is that a dental billing workflow becomes easier to trust when financial state is explainable by design.

That led to three product choices:

- use an append-only ledger instead of mutating balances in place
- make insurance selection date-of-service aware
- treat denials and exceptions as explicit review work, not hidden system behavior

## Solution

Dental Ledger Studio turns that product bet into a focused workflow:

- dashboard surfaces outstanding balances, flags, and operational risk
- patient detail combines visits, services, payments, insurance history, and review state
- claim review preserves submission context and makes decisions traceable
- analytics point to the next operational action instead of acting like static reporting

## Technical Decisions

- Next.js App Router provides a cohesive full-stack demo
- Prisma and SQLite keep setup lightweight and local-first
- `LedgerEvent` is append-only so balances can be derived instead of stored
- claim submissions and packets preserve historical context over time
- Vitest and Playwright provide validation and smoke-path confidence
- Windows-first launchers reduce setup friction during demos

## Explicit Tradeoffs

- Authentication is lightweight because this is a portfolio demo, not a production RBAC system.
- Payer integrations are intentionally out of scope to keep the workflow deterministic and reviewable.
- SQLite is used for portability, not as a statement about production-scale infrastructure.
- The seeded demo data is synthetic and curated around believable walkthrough states.

## Why This Is Relevant In PM Interviews

This repo supports strong discussion around:

- designing trust-heavy workflow products
- deciding where deterministic rules should replace hidden system behavior
- translating product principles into schema design and UI structure
- choosing scope intentionally so a product is demoable, credible, and well packaged
