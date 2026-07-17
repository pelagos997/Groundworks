# Groundwork MVP

Team ownership and parallel build contracts are defined in
[`TEAM_PLAN.md`](./TEAM_PLAN.md).

Groundwork is a phone-first, self-rescheduling superintendent for
schedule-critical geotechnical work. It models a six-element drilled-shaft
package and accepts signed voice, SMS, and MMS field updates while keeping every
replan and external action visible, testable, and approval-gated.

## Demo flow

1. Initialize a package-scoped superintendent from the setup studio.
2. Review a seven-day schedule with a field description for every activity.
3. Have an allowlisted foreman call or text the AgentPhone project line with
   DS-02 refusal at 34 feet, or replay the same offline fixture.
4. Accept the AI/transcription disclosure, confirm the agent read-back, and
   normalize the call into a Nexla field event.
5. Watch DS-03 move ahead of DS-02 and review nine deterministic checks.
6. Inspect Zero's live weather, SMS, voice, and email capability ledger.
7. Approve the candidate plan, then simulate the bounded coordination actions.

Communication actions default to denied. Runtime Zero discovery is live without
credentials. Paid calls require a server signing wallet, `ZERO_LIVE_ACTIONS`, a
current approved plan, an explicitly consented directory contact, and the hard
$0.60 per-action ceiling. The API never accepts an arbitrary destination number
from the browser.

## Harness

- **Agent graph:** LangGraph state machine with explicit normalize, assess,
  propose, and validate nodes.
- **Schedule engine:** Deterministic CPM fixture and typed recovery patches.
- **Merge gate:** Nine executable safety and resource checks on every replan.
- **Capability plane:** Zero SDK runtime discovery for weather, SMS, voice, and
  email actions, plus schema inspection, payment, review, and durable receipts
  for approved voice calls.
- **Data plane:** Caller-confirmed transcripts are normalized to
  `groundwork.field_event.v1` and delivered to a configured Nexla webhook. The
  demo safely replays the data product when no webhook is configured.
- **Client:** React 19, vinext, and HeroUI v3.
- **Inbound contact:** AgentPhone unified voice/SMS/MMS webhooks with HMAC
  verification, five-minute replay protection, and delivery idempotency.
- **Persistence:** D1 stores conversations, events, approvals, policy decisions,
  candidates, and Zero receipts. Private R2 stores validated field images.
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

## Live contact configuration

Groundwork uses the official AgentPhone webhook contract at
`/api/webhooks/agentphone`. Inbound voice has a three-step protocol: explicit
AI/transcription consent, factual report, and exact read-back confirmation. SMS
and MMS use the same allowlist and confirmation rules. Images are limited to
JPEG, PNG, or WebP under 8 MB and are never public.

1. Provision an AgentPhone account, agent, and voice/SMS number.
2. Add the server-only values documented in `.env.example`.
3. Set `GROUNDWORK_CONTACTS_JSON` to real, consented test contacts. Keep outbound
   consent `false` until each person opts in.
4. Deploy the webhook on a public, HTTPS-reachable API surface. Do not expose the
   operator dashboard or private media merely to make the webhook reachable.
5. Run `npm run agentphone:configure`. It registers the webhook, runs the
   provider test, and saves the returned signing secret to the ignored
   `.agentphone-webhook-secret` file.
6. Store that value as the hosted `AGENTPHONE_WEBHOOK_SECRET` secret and deploy
   the new environment revision.

## Agent authority

The machine-readable policy is returned by `GET /api/policies` and enforced in
the webhook, plan-approval, media, and Zero-action routes. Groundwork may record
observed facts, ask for confirmation, store private evidence, create candidate
plans, and discover Zero capabilities. It may not approve its own plan, contact
unlisted people, exceed the Zero ceiling, publish field images, or give
engineering, safety, commercial, or means-and-methods direction.
