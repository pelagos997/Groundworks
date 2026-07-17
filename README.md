# Groundwork MVP

Team ownership and parallel build contracts are defined in
[`TEAM_PLAN.md`](./TEAM_PLAN.md).

Groundwork is a self-rescheduling superintendent demo for schedule-critical
geotechnical work. The MVP models a six-element drilled-shaft package at an
urban infill site and makes every field update, replan, and external action
visible, testable, and approval-gated.

## Demo flow

1. Initialize a package-scoped superintendent from the setup studio.
2. Review a seven-day schedule with a field description for every activity.
3. Simulate a foreman calling the project line with DS-02 refusal at 34 feet.
4. Confirm the agent read-back and normalize the call into a Nexla field event.
5. Watch DS-03 move ahead of DS-02 and review nine deterministic checks.
6. Inspect Zero's live weather, SMS, voice, and email capability ledger.
7. Approve the candidate plan, then simulate the bounded coordination actions.

Communication actions are sandboxed by default. Runtime Zero discovery is
live when available, but the public demo does not call an external recipient or
spend from a wallet. The displayed project line is a demo number. See
`.env.example` for the Zero, telephony, voice, and Nexla adapter boundaries.

## Harness

- **Agent graph:** LangGraph state machine with explicit normalize, assess,
  propose, and validate nodes.
- **Schedule engine:** Deterministic CPM fixture and typed recovery patches.
- **Merge gate:** Nine executable safety and resource checks on every replan.
- **Capability plane:** Zero SDK runtime discovery for weather, SMS, voice, and
  email actions, with ranked candidates and provider failover.
- **Data plane:** Caller-confirmed transcripts are normalized to
  `groundwork.field_event.v1` and delivered to a configured Nexla webhook. The
  demo safely replays the data product when no webhook is configured.
- **Client:** React 19, vinext, and HeroUI v3.
- **Deployment:** Cloudflare-compatible worker build; Akash remains an optional
  container target for the planner service.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Verify

```bash
npm run lint
npm test
```

The test command performs a production build, verifies server rendering, and
executes all four replan scenarios plus the field-event normalization route
through the built worker.
