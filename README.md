# Groundwork MVP

Groundwork is a self-rescheduling superintendent demo for schedule-critical
geotechnical work. The MVP models a micropile and underpinning package at an
urban infill site and makes every replan visible, testable, and approval-gated.

## Demo flow

1. Initialize a package-scoped superintendent from the setup studio.
2. Inject a 91°F grout window or inspector cancellation.
3. Review the CPM cascade, recommendation, and nine deterministic checks.
4. Approve the candidate schedule.
5. Ask Zero to discover a voice or email capability at runtime.
6. Simulate a crew confirmation or decline; a decline starts a new replan.

Communication actions are sandboxed by default. Runtime Zero discovery is
live when available, but the MVP does not call an external recipient or spend
from a wallet. See `.env.example` for the production adapter boundary.

## Harness

- **Agent graph:** LangGraph state machine with explicit normalize, assess,
  propose, and validate nodes.
- **Schedule engine:** Deterministic CPM fixture and typed recovery patches.
- **Merge gate:** Nine executable safety and resource checks on every replan.
- **Capability plane:** Zero SDK runtime discovery for voice and email actions.
- **Data-plane seam:** Nexla status is represented in the UI and ready for a
  production data-product adapter.
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
executes the three replan scenarios through the built worker.
