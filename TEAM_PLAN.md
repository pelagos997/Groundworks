# Groundwork three-person build plan

This plan takes the committed drilled-shaft MVP from controlled simulation to a
credible live demo. Each owner has one primary surface and one integration
contract, so the team can work in parallel without editing the same files.

## Shared demo contract

The golden-path event is fixed:

1. Luis calls the project hotline and reports refusal at DS-02 at 34 ft.
2. The agent discloses that it is AI, verifies the project/caller, and reads the
   update back.
3. Nexla emits `groundwork.field_event.v1` and a schedule event.
4. Groundwork moves the rig to cleared shaft DS-03 and runs the nine-test gate.
5. A human approves the candidate week plan.
6. Zero discovers the best healthy voice, SMS, email, and weather capabilities.
7. The agent contacts only allowlisted demo recipients and records receipts.

The Sunday foundation release, DS-02/DS-03 IDs, 34-ft refusal depth, and event
schema are shared fixtures. Change them only through a coordinated PR.

## Owner 1 — Ronan: product, field realism, and winning demo

Branch: `ronan/demo-and-field-evidence`

### Deliverables

- Replace generic field evidence with 4–6 real, permission-cleared drilled-shaft
  photos: rig setup, casing, cleanout/inspection, cage, tremie, and completed
  shaft. Remove EXIF location data before committing.
- Write the 90-second judge script around “Call the Superintendent”: inbound
  call, confirmed read-back, visible replan, approval, Zero discovery, and
  outbound coordination.
- Define the agent authority manifest: actions that are automatic, actions that
  require approval, spending caps, allowlisted contacts, and prohibited safety
  or means-and-methods decisions.
- Own project initialization UX and ensure a new superintendent can be created
  from project, package, contacts, schedule, and authority inputs.
- Assemble the sponsor proof sheet showing where Zero and Nexla are structurally
  required, including a fallback plan for poor venue connectivity.

### Acceptance criteria

- Every field photo has source/permission notes and a corresponding shaft/event.
- The full demo can be performed in under 90 seconds from a reset state.
- No screen or narration implies that Groundwork makes engineering or safety
  decisions.
- A recorded backup demo and a one-page system diagram are ready before judging.

## Owner 2 — Teammate A: Zero voice and communications runtime

Branch: `teammate-a/zero-voice-runtime`

Primary files: `app/api/communications/`, new `app/api/calls/`, and provider
adapters under `lib/communications/`.

### Deliverables

- Provision a real demo hotline and inbound webhook using an allowlisted number.
- Implement AI disclosure, recording/transcription consent, caller/project
  verification, structured read-back, and explicit caller confirmation.
- Use Zero runtime search for outbound voice, SMS, email, and weather; inspect
  each capability schema before execution and store the selected capability ID.
- Add deterministic ranking: required method/schema, health, rating, price, and
  max-pay policy. Demonstrate failover when the first provider is unavailable.
- Execute only after candidate-plan approval and only against allowlisted demo
  recipients. Persist request, provider, price, policy decision, outcome, and
  external receipt ID.
- Add replay fixtures so the complete call flow works without paid calls or
  venue connectivity.

### Integration contract

Inbound calls must emit the exact `groundwork.field_event.v1` payload currently
defined in `lib/nexla-data-products.ts`. Outbound actions accept a committed
replan ID plus an approved recipient ID; they never accept arbitrary phone
numbers or email addresses from the browser.

### Acceptance criteria

- One real inbound call produces a caller-confirmed field event.
- One approved outbound call and one email/SMS reach controlled recipients.
- A simulated primary-provider failure selects the next qualified Zero result.
- No external action occurs before approval, consent, and allowlist checks pass.
- Paid actions have a hard per-action spend limit and visible receipt.

## Owner 3 — Teammate B: Nexla data plane and schedule intelligence

Branch: `teammate-b/nexla-schedule-plane`

Primary files: `lib/nexla-data-products.ts`, `app/api/field-events/`,
`lib/replan-graph.ts`, and new Nexla configuration/docs under `nexla/`.

### Deliverables

- Create versioned Nexla data products for raw voice events, confirmed field
  events, weather/air-quality observations, inspection status, crew responses,
  and schedule events.
- Configure the inbound webhook/data flow and connect its normalized output to
  the Groundwork field-event endpoint or event consumer.
- Add idempotency and event provenance so repeated webhooks cannot create two
  replans and every schedule change points back to its evidence.
- Extend the schedule engine from fixed patches to dependency/resource-aware
  calculations while retaining deterministic fixtures for the stage demo.
- Add drilled-shaft rules for inspection hold points, cage-before-concrete,
  continuous tremie placement, rig/crane conflicts, spoil/slurry capacity,
  concrete temperature, and weather/wind limits.
- Produce a replayable event bundle covering obstruction, inspector cancellation,
  hot concrete, crew decline, and provider failure.

### Integration contract

Nexla outputs immutable, versioned events. The schedule engine returns a
candidate plan, explanation, test results, and commit ID; it does not contact
crews. Only the communications runtime consumes an approved commit.

### Acceptance criteria

- A real Nexla webhook returns `delivered`, not `demo_replay`, in the UI.
- Replaying the same event ID does not create a second schedule commit.
- All five event fixtures pass the merge gate and preserve an audit trail.
- The engine reports critical-path and release-date impact for every candidate.

## Merge order and team checkpoints

1. Teammate B lands event contracts and idempotency first.
2. Teammate A integrates the voice runtime against those contracts.
3. Ronan lands the final field evidence, authority wording, and demo choreography.
4. All three run `npm run lint` and `npm test` before merging.
5. Freeze the golden path 12 hours before judging; after freeze, accept only
   blocker fixes and keep replay mode as the guaranteed fallback.

## First checkpoint

Each owner should open a draft PR containing their interface or fixture before
building the full implementation. Review only the contracts at that checkpoint:
event fields, route inputs/outputs, authority boundaries, and shared demo IDs.
