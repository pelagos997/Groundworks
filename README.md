# Groundwork MVP

Team ownership and parallel build contracts are defined in
[`TEAM_PLAN.md`](./TEAM_PLAN.md).

Groundwork is a phone-only procurement superintendent for schedule-critical
geotechnical work. A field crew reports a piling overrun to one project number;
the agent validates the material request, calls a verified vendor set through
Zero, compares written delivered quotes, and releases a PO only after a buyer
with sufficient authority repeats the exact quote and PO number.

## Demo flow

1. An allowlisted foreman calls the AgentPhone project line and reports a pile
   overrun: ten 20-foot pieces of HP12x53.
2. The agent asks for the ASTM grade, domestic/Buy America requirement,
   delivery address, and full required-on-site date and time.
3. The agent reads back 200 LF and 10,600 lb, then waits for `confirm RFQ`.
4. Zero discovers a healthy call capability and places disclosed, nonbinding
   RFQ calls to Nucor Skyline, PDM Stockton, and Farwest Stockton.
5. Nexla normalizes written quote emails into `POST /api/procurement/quotes`.
   Phone transcripts alone never qualify as an orderable quote.
6. The buyer calls and asks for `quote status`; the agent reports the best
   on-time delivered option.
7. The buyer says, for example, `release quote Q-419 at $12,850 delivered under
   PO-1042`. The agent verifies the written quote, authority limit, and exact
   total before emailing the PO through Zero and calling the vendor to confirm
   receipt. The order remains pending until written acknowledgement arrives.

External actions default to denied. RFQ calls require a server signing wallet,
`ZERO_LIVE_ACTIONS`, a fully specified request, an authorized caller, configured
buyer identity, vendor business hours, and the hard $0.60-per-call / $1.80-batch
ceilings. Binding releases also require `GROUNDWORK_PO_RELEASES_ENABLED`, a
qualified written quote, exact spoken total, valid PO number, and a buyer whose
purchase limit covers the delivered amount. Vendor phone numbers come only from
the verified server-side directory; inbound payloads cannot redirect a call.

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
- **Interface:** one inbound voice/SMS/MMS number; no client UI is required for
  the procurement demo.
- **Inbound contact:** AgentPhone unified voice/SMS/MMS webhooks with HMAC
  verification, five-minute replay protection, and delivery idempotency.
- **Persistence:** D1 stores conversations, events, approvals, policy decisions,
  candidates, and Zero receipts. Supabase stores the durable AgentPhone event,
  call, transcript-turn, message, and sync-run data products. Private R2 stores
  validated field images.
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
AI/transcription consent, complete material request, and exact RFQ read-back
confirmation. SMS and MMS use the same allowlist and confirmation rules.

1. Provision an AgentPhone account, agent, and voice/SMS number.
2. Add the server-only values documented in `.env.example`.
3. Set `GROUNDWORK_CONTACTS_JSON` to real, consented test contacts. Keep outbound
   consent `false` until each person opts in.
4. Deploy the webhook on a public, HTTPS-reachable API surface. Keep any existing
   operator page and private media authenticated.
5. Run `npm run agentphone:configure`. It registers the webhook, runs the
   provider test, and saves the returned signing secret to the ignored
   `.agentphone-webhook-secret` file.
6. Store that value as the hosted `AGENTPHONE_WEBHOOK_SECRET` secret and deploy
   the new environment revision.

## Supabase call-data store

The phone integration dual-writes verified AgentPhone events into Supabase while
retaining D1 as the transactional policy and procurement ledger. Supabase is
server-only: the migration enables RLS, grants no browser role access, removes
media and recording URLs from event payloads, and includes a 90-day purge
function.

The app also includes `@supabase/ssr` browser and server helpers for future
authenticated client workflows. `proxy.ts` validates claims and refreshes auth
cookies before rendering. Configure those clients with
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`; these
public values never authorize writes to the protected phone tables.

1. Create or select a Supabase project and apply
   `supabase/migrations/20260717220000_groundwork_phone_operations.sql` through
   the Supabase migration workflow.
2. Set `SUPABASE_URL` and either `SUPABASE_SECRET_KEY` or the legacy
   `SUPABASE_SERVICE_ROLE_KEY` as hosted secrets. Never use either secret in the
   browser.
3. Set a long random `GROUNDWORK_INTERNAL_API_TOKEN` hosted secret.
4. AgentPhone webhooks are upserted automatically. To backfill the most recent
   50 calls and messages, invoke `POST /api/sync/agentphone` with the internal
   token as a Bearer credential.
5. Schedule `select public.purge_expired_groundwork_phone_data();` according to
   the project's retention policy.

For private Sites deployments, `supabase/functions/agentphone-webhook` is the
public, HMAC-verified ingress. It stores the event first and can then forward the
original signed payload to Groundwork using a Sites bypass bearer token held as
a Supabase Edge secret. AgentPhone credentials are never sent to Supabase's Data
API or any non-AgentPhone host.

## Agent authority

The machine-readable policy is returned by `GET /api/policies`. Groundwork may
capture facts, calculate quantity extensions, solicit nonbinding quotes from the
verified directory, and rank exact written quotes. It cannot invent material
specifications or commercial authority, accept substitutions, treat a transcript
as a quote, exceed spend or buyer limits, or mark an order complete without
vendor acknowledgement.
