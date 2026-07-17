"use client";

import {
  Alert,
  Button,
  Card,
  Chip,
  Input,
  ProgressBar,
  Spinner,
} from "@heroui/react";
import {
  Activity,
  ArrowDownRight,
  BadgeDollarSign,
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Database,
  FileCheck2,
  HardHat,
  Layers3,
  Mail,
  MapPin,
  MessageSquareText,
  Mic,
  Phone,
  PhoneIncoming,
  Play,
  Radio,
  RefreshCcw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  ThermometerSun,
  UserRoundCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  BASE_TASKS,
  type ReplanEvent,
  type ReplanResponse,
  type ScheduleTask,
} from "../lib/project-data";
import type { FieldEvent } from "../lib/nexla-data-products";

type CommunicationState =
  | "idle"
  | "discovering"
  | "calling"
  | "connected"
  | "confirmed"
  | "declined"
  | "emailed";

type HotlineState = "ready" | "ringing" | "listening" | "normalizing" | "normalized";

type ZeroCandidate = {
  id: string;
  name: string;
  brand: string;
  price: string;
  rating: string;
  availability: string;
};

type ZeroDiscovery = {
  kind: "voice" | "email" | "sms" | "weather" | "transcription";
  query: string;
  discoveryStatus: "live" | "fallback";
  candidates: ZeroCandidate[];
  selected: ZeroCandidate | null;
  policy: "approval_required" | "eligible";
  receiptId: string;
  failedOver?: boolean;
};

const weekDays = [
  { day: "MON", date: "JUL 20" },
  { day: "TUE", date: "JUL 21" },
  { day: "WED", date: "JUL 22" },
  { day: "THU", date: "JUL 23" },
  { day: "FRI", date: "JUL 24" },
  { day: "SAT", date: "JUL 25" },
  { day: "SUN", date: "JUL 26" },
];

const fieldTranscript =
  "This is Luis at DS-02. We hit refusal at 34 feet and stopped drilling. The rig and inspector can move to cleared shaft DS-03 now.";

const initialFeed: ReplanResponse["feed"] = [
  {
    step: "NEXLA SYNCED",
    detail: "Weather, inspector calendar, shaft logs, and crew commitments are current.",
    tone: "success",
  },
  {
    step: "COMMITTED",
    detail: "Week plan v1 is active. Foundation release remains Sunday, July 26.",
    tone: "neutral",
  },
];

function applyShifts(tasks: ScheduleTask[], shifts: Record<string, number>): ScheduleTask[] {
  return tasks.map((task) => ({ ...task, start: task.start + (shifts[task.id] ?? 0) }));
}

function toneClass(tone: ReplanResponse["feed"][number]["tone"]) {
  if (tone === "danger") return "feed-dot danger";
  if (tone === "warning") return "feed-dot warning";
  if (tone === "success") return "feed-dot success";
  return "feed-dot";
}

function Gantt({ tasks, baseline }: { tasks: ScheduleTask[]; baseline: ScheduleTask[] }) {
  return (
    <div className="gantt-scroll" aria-label="Drilled shaft weekly schedule">
      <div className="gantt weekly-gantt" data-testid="gantt">
        <div className="gantt-corner">
          <span>Activity + field description</span>
          <span>Week 1</span>
        </div>
        <div className="gantt-dates week-dates">
          {weekDays.map(({ day, date }) => (
            <span key={day}><strong>{day}</strong><small>{date}</small></span>
          ))}
        </div>
        {tasks.map((task) => {
          const baselineTask = baseline.find((item) => item.id === task.id)!;
          const changed = baselineTask.start !== task.start;
          return (
            <div className="gantt-row" key={task.id}>
              <div className="task-label described-task">
                <span className="task-id">{task.id}</span>
                <div>
                  <strong>{task.name}</strong>
                  <p>{task.description}</p>
                  <small>{task.meta}</small>
                </div>
              </div>
              <div className="gantt-track week-track">
                <span
                  className="baseline-bar"
                  style={{
                    left: `${(baselineTask.start / 7) * 100}%`,
                    width: `${(baselineTask.duration / 7) * 100}%`,
                  }}
                />
                <span
                  className={`task-bar ${task.status} ${changed ? "changed" : ""}`}
                  style={{
                    left: `${(task.start / 7) * 100}%`,
                    width: `${(task.duration / 7) * 100}%`,
                  }}
                >
                  {changed && <span className="bar-time">{task.newTime ?? "resequenced"}</span>}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function GroundworkDashboard() {
  const [tasks, setTasks] = useState(BASE_TASKS);
  const [candidate, setCandidate] = useState<ReplanResponse | null>(null);
  const [feed, setFeed] = useState(initialFeed);
  const [busy, setBusy] = useState(false);
  const [committed, setCommitted] = useState("week-plan-v1");
  const [activeEvent, setActiveEvent] = useState("No active collision");
  const [communication, setCommunication] = useState<CommunicationState>("idle");
  const [hotline, setHotline] = useState<HotlineState>("ready");
  const [fieldEvent, setFieldEvent] = useState<FieldEvent | null>(null);
  const [zeroActions, setZeroActions] = useState<ZeroDiscovery[]>([]);
  const [zeroBusy, setZeroBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [setupStep, setSetupStep] = useState(1);
  const [showEvidence, setShowEvidence] = useState(false);

  const releaseDelta = candidate?.deltaDays ?? 0;
  const releaseLabel =
    releaseDelta === 0 ? "Sun · Jul 26" : releaseDelta < 1 ? "Mon · Jul 27 AM" : "Mon · Jul 27";
  const validationCount = useMemo(
    () => candidate?.tests.filter((test) => test.passed).length ?? 9,
    [candidate],
  );
  const isApproved = candidate ? committed === candidate.commitId : false;

  async function runReplan(event: ReplanEvent) {
    setBusy(true);
    setCommunication("idle");
    try {
      const response = await fetch("/api/replan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
      });
      if (!response.ok) throw new Error("Replan failed");
      const result = (await response.json()) as ReplanResponse;
      setCandidate(result);
      setTasks(
        applyShifts(BASE_TASKS, result.shifts).map((task) => ({
          ...task,
          newTime:
            result.event === "hot_weather" && task.id === "DS07"
              ? "05:00"
              : result.event === "shaft_obstruction" && task.id === "DS09"
                ? "RIG MOVES HERE"
                : result.shifts[task.id]
                  ? `${result.shifts[task.id] > 0 ? "+" : ""}${result.shifts[task.id]}d`
                  : undefined,
        })),
      );
      setFeed(result.feed);
      setActiveEvent(result.trigger);
      return result;
    } catch {
      setFeed((current) => [
        { step: "RECOVER", detail: "Planning service did not answer. The committed week plan remains active.", tone: "danger" },
        ...current,
      ]);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function discoverCapability(kind: ZeroDiscovery["kind"], approved = isApproved) {
    const response = await fetch("/api/communications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind, approved, replanId: committed }),
    });
    if (!response.ok) throw new Error("Capability discovery failed");
    return (await response.json()) as ZeroDiscovery;
  }

  async function discoverZeroCascade() {
    setZeroBusy(true);
    try {
      const discoveries = await Promise.all(
        (["weather", "sms", "voice", "email"] as const).map((kind) => discoverCapability(kind, false)),
      );
      setZeroActions(discoveries);
      setFeed((current) => [
        {
          step: "ZERO DISCOVERED",
          detail: `${discoveries.filter((item) => item.discoveryStatus === "live").length}/4 capability searches returned live providers; side effects await approval.`,
          tone: "success",
        },
        ...current,
      ]);
    } catch {
      setFeed((current) => [
        { step: "ZERO RETRY", detail: "Capability search was interrupted; the schedule candidate remains valid.", tone: "warning" },
        ...current,
      ]);
    } finally {
      setZeroBusy(false);
    }
  }

  function simulateIncomingCall() {
    setHotline("ringing");
    window.setTimeout(() => setHotline("listening"), 900);
  }

  async function confirmFieldUpdate() {
    setHotline("normalizing");
    try {
      const response = await fetch("/api/field-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcript: fieldTranscript }),
      });
      if (!response.ok) throw new Error("Field event failed");
      const result = (await response.json()) as { event: FieldEvent; nexla: { status: string } };
      setFieldEvent(result.event);
      await runReplan("shaft_obstruction");
      await discoverZeroCascade();
      setHotline("normalized");
      setFeed((current) => [
        {
          step: "CALL CONFIRMED",
          detail: `Luis read back DS-02 refusal at 34 ft. Nexla status: ${result.nexla.status.replaceAll("_", " ")}.`,
          tone: "success",
        },
        ...current,
      ]);
    } catch {
      setHotline("listening");
      setFeed((current) => [
        { step: "NOT COMMITTED", detail: "The field update was not normalized; no schedule event was created.", tone: "danger" },
        ...current,
      ]);
    }
  }

  function approveCandidate() {
    if (!candidate) return;
    setCommitted(candidate.commitId);
    setZeroActions((current) => current.map((item) => ({ ...item, policy: "eligible" })));
    setFeed([
      {
        step: "COMMITTED",
        detail: `${candidate.commitId} merged. Zero side effects are now eligible within the approved scope.`,
        tone: "success",
      },
      ...candidate.feed,
    ]);
  }

  function rejectCandidate() {
    setCandidate(null);
    setTasks(BASE_TASKS);
    setActiveEvent("No active collision");
    setZeroActions([]);
    setFeed([{ step: "REJECTED", detail: "Candidate discarded; week plan v1 remains active.", tone: "neutral" }, ...initialFeed]);
  }

  function simulateFailover() {
    setZeroActions((current) =>
      current.map((item) =>
        item.kind === "voice" && item.candidates[1]
          ? { ...item, selected: item.candidates[1], failedOver: true }
          : item,
      ),
    );
    setFeed((current) => [
      {
        step: "PROVIDER FAILOVER",
        detail: "Primary voice provider failed health policy; Zero selected the next qualified capability.",
        tone: "warning",
      },
      ...current,
    ]);
  }

  function resetDemo() {
    setTasks(BASE_TASKS);
    setCandidate(null);
    setFeed(initialFeed);
    setCommitted("week-plan-v1");
    setActiveEvent("No active collision");
    setCommunication("idle");
    setHotline("ready");
    setFieldEvent(null);
    setZeroActions([]);
  }

  async function startCall() {
    setCommunication("discovering");
    try {
      const receipt = await discoverCapability("voice", true);
      setCommunication("calling");
      setFeed((current) => [
        {
          step: "ZERO VOICE",
          detail: receipt.selected
            ? `${receipt.selected.name} selected at ${receipt.selected.price}; controlled demo call prepared.`
            : "Voice discovery fallback prepared a controlled demo call.",
          tone: "success",
        },
        ...current,
      ]);
      window.setTimeout(() => setCommunication("connected"), 850);
    } catch {
      setCommunication("idle");
    }
  }

  function inspectorResponse(outcome: "confirmed" | "declined") {
    setCommunication(outcome);
    if (outcome === "confirmed") {
      setFeed((current) => [
        { step: "VERIFIED", detail: "Inspector confirmed DS-03 coverage by voice read-back.", tone: "success" },
        ...current,
      ]);
    } else {
      void runReplan("crew_declined");
    }
  }

  async function sendEmail() {
    setCommunication("discovering");
    try {
      const receipt = await discoverCapability("email", true);
      setCommunication("emailed");
      setFeed((current) => [
        {
          step: "ZERO EMAIL",
          detail: `${receipt.selected?.name ?? "Email capability"} prepared the controlled confirmation for ${committed}.`,
          tone: "success",
        },
        ...current,
      ]);
    } catch {
      setCommunication("idle");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true"><Layers3 size={21} /></div>
          <div>
            <div className="brand-line">
              <strong>GROUNDWORK</strong>
              <Chip size="sm" color="success" variant="soft"><Chip.Label>LIVE DEMO</Chip.Label></Chip>
            </div>
            <span>Agentic drilled-shaft operations</span>
          </div>
        </div>
        <div className="project-context">
          <MapPin size={15} />
          <span>2nd &amp; Howard · SoMa</span>
          <span className="context-divider" />
          <span>6 × 72-in drilled shafts</span>
        </div>
        <div className="topbar-actions">
          <Button variant="tertiary" size="sm" onPress={() => setShowSetup(true)}><Sparkles size={15} /> Initialize agent</Button>
          <Button variant="outline" size="sm" onPress={resetDemo} aria-label="Reset demo"><RefreshCcw size={15} /> Reset</Button>
          <div className="avatar">RJ</div>
        </div>
      </header>

      <section className="workspace">
        <div className="eyebrow-row">
          <div>
            <p className="eyebrow">DRILLED SHAFT SUPERINTENDENT · WEEK 1</p>
            <h1>One week. Six shafts. One release.</h1>
          </div>
          <div className="source-health">
            <span><i className="pulse" /> Nexla products current</span>
            <span><Database size={14} /> 5 normalized streams</span>
            <span><PhoneIncoming size={14} /> hotline standing by</span>
          </div>
        </div>

        <div className="kpi-grid">
          <Card className="kpi-card"><Card.Content>
            <div className="kpi-top"><span>Foundation release</span><CalendarDays size={18} /></div>
            <div className="kpi-value release-value">{releaseLabel}</div>
            <div className={`kpi-delta ${releaseDelta ? "negative" : "positive"}`}>
              {releaseDelta ? <ArrowDownRight size={14} /> : <Check size={14} />}
              {releaseDelta ? `+${releaseDelta} day from baseline` : "Holding week plan"}
            </div>
          </Card.Content></Card>
          <Card className="kpi-card"><Card.Content>
            <div className="kpi-top"><span>Active field condition</span><CircleAlert size={18} /></div>
            <div className="kpi-event">{activeEvent}</div>
            <div className="kpi-sub">Critical path recalculated on every confirmed event</div>
          </Card.Content></Card>
          <Card className="kpi-card"><Card.Content>
            <div className="kpi-top"><span>Merge gate</span><ShieldCheck size={18} /></div>
            <div className="kpi-value">{validationCount}/9</div>
            <div className="kpi-sub">Drilled-shaft constraints passing</div>
          </Card.Content></Card>
          <Card className="kpi-card accent-card"><Card.Content>
            <div className="kpi-top"><span>Production</span><HardHat size={18} /></div>
            <div className="kpi-value">1 / 6</div>
            <ProgressBar aria-label="Drilled shaft progress" value={17} color="accent" size="sm"><ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track></ProgressBar>
            <div className="kpi-sub">DS-01 placed · 180 CY</div>
          </Card.Content></Card>
        </div>

        <div className="control-grid">
          <Card className="schedule-card">
            <Card.Header className="card-heading schedule-heading">
              <div>
                <Card.Title>Drilled shaft installation · weekly CPM</Card.Title>
                <Card.Description>Every activity includes its field purpose, resource, and hold-point context</Card.Description>
              </div>
              <Chip size="sm" color={candidate ? "warning" : "success"} variant="soft"><Chip.Label>{candidate ? "CANDIDATE PLAN" : committed.toUpperCase()}</Chip.Label></Chip>
            </Card.Header>
            <Card.Content className="schedule-content">
              <div className="scenario-bar">
                <div className="scenario-copy"><span className="scenario-label">Punch the week plan</span><span>Inject a condition or let the foreman call it in.</span></div>
                <div className="scenario-actions">
                  <Button size="sm" variant="danger-soft" onPress={() => void runReplan("hot_weather")} isDisabled={busy}><ThermometerSun size={15} /> 91°F pour window</Button>
                  <Button size="sm" variant="outline" onPress={() => void runReplan("inspector_cancelled")} isDisabled={busy}><UserRoundCheck size={15} /> Inspector cancelled</Button>
                  <Button size="sm" variant="primary" onPress={simulateIncomingCall} isDisabled={busy || hotline !== "ready"}><PhoneIncoming size={15} /> Simulate crew call</Button>
                </div>
              </div>
              {busy ? (
                <div className="planning-state"><Spinner size="lg" color="accent" /><div><strong>Replanning the shaft package</strong><span>Solving resources and testing hold points…</span></div></div>
              ) : <Gantt tasks={tasks} baseline={BASE_TASKS} />}
              <div className="legend-row">
                <span><i className="legend critical" /> Critical path</span>
                <span><i className="legend complete" /> Complete</span>
                <span><i className="legend parallel" /> Parallel work</span>
                <span><i className="legend baseline" /> Baseline</span>
              </div>
            </Card.Content>
            {candidate && !busy && (
              <Card.Footer className="candidate-footer">
                <div><span className="candidate-label">Recommended recovery</span><strong>{candidate.recommendation}</strong><small>{candidate.rationale}</small></div>
                <div className="candidate-actions">
                  <Button variant="tertiary" size="sm" onPress={rejectCandidate}>Reject</Button>
                  <Button variant="primary" size="sm" onPress={approveCandidate} isDisabled={isApproved}><FileCheck2 size={15} /> {isApproved ? "Committed" : "Approve & commit"}</Button>
                </div>
              </Card.Footer>
            )}
          </Card>

          <Card className="feed-card">
            <Card.Header className="card-heading"><div><Card.Title>Agent control loop</Card.Title><Card.Description>Evidence and decisions, not hidden reasoning</Card.Description></div><span className="live-indicator"><i /> LIVE</span></Card.Header>
            <Card.Content className="feed-content">
              {feed.map((item, index) => (
                <div className="feed-item" key={`${item.step}-${index}`}><div className={toneClass(item.tone)} /><div><span>{item.step}</span><p>{item.detail}</p></div></div>
              ))}
            </Card.Content>
            <Card.Footer className="feed-footer"><Activity size={15} /> Thread: supt_shafts_soma_001</Card.Footer>
          </Card>
        </div>

        <div className="voice-grid">
          <Card className="hotline-card">
            <Card.Header className="card-heading">
              <div><Card.Title>Groundwork project hotline</Card.Title><Card.Description>Inbound field context becomes a caller-confirmed Nexla event</Card.Description></div>
              <Chip size="sm" color={hotline === "ready" ? "success" : "accent"} variant="soft"><Chip.Label>{hotline === "ready" ? "STANDING BY" : "CALL ACTIVE"}</Chip.Label></Chip>
            </Card.Header>
            <Card.Content className="hotline-content">
              <div className="hotline-number"><span><PhoneIncoming size={17} /> PROJECT LINE · DEMO</span><strong>(415) 555-0148</strong></div>
              {hotline === "ready" && (
                <div className="hotline-empty"><div className="ready-ring"><Phone size={22} /></div><div><strong>Crews call a normal phone number</strong><p>Report production, delays, deliveries, inspection status, or equipment problems without opening an app.</p></div><Button variant="primary" size="sm" onPress={simulateIncomingCall}>Simulate inbound call</Button></div>
              )}
              {hotline === "ringing" && (
                <div className="hotline-live"><span className="call-pulse"><PhoneIncoming size={18} /></span><div><strong>Incoming · Luis Martinez</strong><span>Caller matched crew_foreman_01 · project code verified</span></div><Spinner size="sm" color="accent" /></div>
              )}
              {hotline === "listening" && (
                <div className="transcript-console">
                  <div className="call-header"><span className="call-pulse"><Mic size={17} /></span><div><strong>AI disclosure accepted · 00:31</strong><span>Transcription consent recorded</span></div></div>
                  <blockquote>“{fieldTranscript}”</blockquote>
                  <div className="readback"><Check size={15} /><span><strong>Read-back confirmed</strong> DS-02 refusal · 34 ft · work stopped · DS-03 available</span></div>
                  <Button variant="primary" size="sm" onPress={() => void confirmFieldUpdate()}><Database size={15} /> Commit confirmed field event</Button>
                </div>
              )}
              {hotline === "normalizing" && <div className="hotline-live"><Spinner size="sm" color="accent" /><div><strong>Nexla is normalizing the call</strong><span>Mapping transcript → field_event → schedule_event</span></div></div>}
              {hotline === "normalized" && fieldEvent && (
                <div className="normalized-event">
                  <div className="normalized-head"><span><Database size={16} /> NEXLA · groundwork.field_event.v1</span><Chip size="sm" color="success" variant="soft"><Chip.Label>CONFIRMED</Chip.Label></Chip></div>
                  <div className="event-grid"><span>ELEMENT<strong>{fieldEvent.observation.elementId}</strong></span><span>CONDITION<strong>Refusal at {fieldEvent.observation.depthFt} ft</strong></span><span>ALTERNATE<strong>{fieldEvent.observation.alternateElement}</strong></span><span>CONFIDENCE<strong>{Math.round(fieldEvent.confidence * 100)}%</strong></span></div>
                </div>
              )}
            </Card.Content>
          </Card>

          <Card className="zero-ledger-card">
            <Card.Header className="card-heading">
              <div><Card.Title>Zero capability ledger</Card.Title><Card.Description>Search → rank → policy → action receipt</Card.Description></div>
              <Chip size="sm" color="accent" variant="soft"><Chip.Label>RUNTIME DISCOVERY</Chip.Label></Chip>
            </Card.Header>
            <Card.Content className="zero-ledger-content">
              {zeroBusy && <div className="ledger-empty"><Spinner size="md" color="accent" /><strong>Zero is searching the live capability market…</strong></div>}
              {!zeroBusy && zeroActions.length === 0 && <div className="ledger-empty"><WalletCards size={24} /><strong>No capabilities requested yet</strong><span>A confirmed field call starts the discovery cascade.</span></div>}
              {!zeroBusy && zeroActions.map((action) => (
                <div className="ledger-row" key={action.receiptId}>
                  <div className={`ledger-icon ${action.kind}`}>{action.kind === "weather" ? <ThermometerSun size={15} /> : action.kind === "sms" ? <MessageSquareText size={15} /> : action.kind === "voice" ? <Phone size={15} /> : <Mail size={15} />}</div>
                  <div className="ledger-main"><span>{action.kind.toUpperCase()} · {action.discoveryStatus}</span><strong>{action.selected?.name ?? "Deterministic fallback"}</strong><small>{action.failedOver ? "Primary rejected · fallback selected" : action.query}</small></div>
                  <div className="ledger-metrics"><strong>{action.selected?.price ?? "—"}</strong><span>★ {action.selected?.rating ?? "—"}</span></div>
                  <Chip size="sm" color={action.policy === "eligible" ? "success" : "warning"} variant="soft"><Chip.Label>{action.policy === "eligible" ? "ELIGIBLE" : "APPROVAL"}</Chip.Label></Chip>
                </div>
              ))}
            </Card.Content>
            <Card.Footer className="ledger-footer">
              <span><BadgeDollarSign size={14} /> Per-action maxPay policy enforced</span>
              <div><Button size="sm" variant="tertiary" onPress={() => void discoverZeroCascade()} isDisabled={zeroBusy}><RefreshCcw size={14} /> Discover again</Button><Button size="sm" variant="outline" onPress={simulateFailover} isDisabled={!zeroActions.some((item) => item.kind === "voice" && item.candidates.length > 1)}><RotateCcw size={14} /> Test failover</Button></div>
            </Card.Footer>
          </Card>
        </div>

        <div className="lower-grid">
          <Card className="evidence-card">
            <Card.Header className="card-heading"><div><Card.Title>Field evidence · DS-01</Card.Title><Card.Description>Progress observations require human verification</Card.Description></div><Button variant="tertiary" size="sm" onPress={() => setShowEvidence(!showEvidence)}>{showEvidence ? "Hide details" : "Review observation"}<ChevronRight size={15} /></Button></Card.Header>
            <Card.Content><div className="evidence-layout">
              <div className="site-photo" role="img" aria-label="Large drilled shaft rig and crew"><div className="photo-overlay"><Chip size="sm" color="success" variant="primary"><Chip.Label>VERIFIED</Chip.Label></Chip><span>Wed · 14:18 · DS-01</span></div></div>
              <div className="observation-copy"><span className="observation-label">FIELD OBSERVATION FO-021</span><h3>DS-01 tremie placement complete</h3><p>Concrete placed continuously to cutoff. Inspector accepted volume reconciliation and top elevation; CSL tubes remain protected.</p><div className="confidence-row"><span>Model confidence</span><strong>94%</strong></div>{showEvidence && <Alert status="accent" className="evidence-alert"><Alert.Indicator><ShieldCheck size={16} /></Alert.Indicator><Alert.Content><Alert.Title>Progress evidence only</Alert.Title><Alert.Description>Bottom cleanliness, concrete acceptance, CSL results, and structural release remain tied to signed records.</Alert.Description></Alert.Content></Alert>}</div>
            </div></Card.Content>
          </Card>

          <Card className="communications-card">
            <Card.Header className="card-heading"><div><Card.Title>Outbound response</Card.Title><Card.Description>Zero-discovered voice and email after plan approval</Card.Description></div><Chip size="sm" color="accent" variant="soft"><Chip.Label>BOUNDED ACTION</Chip.Label></Chip></Card.Header>
            <Card.Content>
              <div className="contact-row"><div className="contact-avatar">MC</div><div><strong>Maya Chen</strong><span>Special inspector · controlled demo contact</span></div><span className="contact-status"><i /> Available</span></div>
              {communication === "idle" && <div className="communication-empty"><Radio size={20} /><div><strong>No communication in progress</strong><span>Commit the candidate plan to unlock approved actions.</span></div></div>}
              {communication === "discovering" && <div className="communication-live"><Spinner size="sm" color="accent" /><div><strong>Zero is discovering a capability</strong><span>Checking provider health, rating, price, and schema…</span></div></div>}
              {communication === "calling" && <div className="communication-live"><span className="call-pulse"><Phone size={18} /></span><div><strong>Calling inspector…</strong><span>AI identity and recording disclosure queued</span></div></div>}
              {communication === "connected" && <div className="call-console"><div className="call-header"><span className="call-pulse"><Phone size={17} /></span><div><strong>Connected · 00:18</strong><span>“Can you cover the resequenced DS-03 inspection?”</span></div></div><div className="call-response-actions"><Button size="sm" variant="secondary" onPress={() => inspectorResponse("confirmed")}><Check size={14} /> Inspector confirms</Button><Button size="sm" variant="danger-soft" onPress={() => inspectorResponse("declined")}><X size={14} /> Inspector declines</Button></div></div>}
              {communication === "confirmed" && <Alert status="success"><Alert.Indicator><Check size={16} /></Alert.Indicator><Alert.Content><Alert.Title>Coverage confirmed</Alert.Title><Alert.Description>DS-03 inspection window read back and accepted.</Alert.Description></Alert.Content></Alert>}
              {communication === "declined" && <Alert status="warning"><Alert.Indicator><CircleAlert size={16} /></Alert.Indicator><Alert.Content><Alert.Title>Coverage declined</Alert.Title><Alert.Description>The response started another resource replan.</Alert.Description></Alert.Content></Alert>}
              {communication === "emailed" && <Alert status="success"><Alert.Indicator><Mail size={16} /></Alert.Indicator><Alert.Content><Alert.Title>Confirmation prepared</Alert.Title><Alert.Description>Controlled recipients received the {committed} summary.</Alert.Description></Alert.Content></Alert>}
            </Card.Content>
            <Card.Footer className="communication-actions"><Button size="sm" variant="primary" onPress={() => void startCall()} isDisabled={!isApproved || ["discovering", "calling", "connected"].includes(communication)}><Phone size={15} /> Call inspector with Zero</Button><Button size="sm" variant="outline" onPress={() => void sendEmail()} isDisabled={!isApproved}><Mail size={15} /> Send team confirmation</Button></Card.Footer>
          </Card>
        </div>

        <footer className="app-footer"><span><ShieldCheck size={14} /> Bounded autonomy · field read-back · deterministic merge gate</span><span>Nexla data plane · Zero capability market · Akash compute target</span></footer>
      </section>

      {showSetup && (
        <div className="setup-backdrop" role="presentation">
          <Card className="setup-panel" role="dialog" aria-modal="true" aria-label="Initialize drilled shaft superintendent">
            <Card.Header className="setup-header"><div><span className="setup-kicker">AGENT SETUP STUDIO</span><Card.Title>Initialize a superintendent</Card.Title><Card.Description>Drilled Shaft Superintendent v1 · shadow mode</Card.Description></div><Button isIconOnly variant="tertiary" onPress={() => setShowSetup(false)} aria-label="Close setup"><X size={18} /></Button></Card.Header>
            <Card.Content className="setup-content">
              <div className="setup-progress">{["Project", "Package", "Authority", "Simulate"].map((label, index) => <Button key={label} size="sm" variant="tertiary" className={setupStep === index + 1 ? "active" : setupStep > index + 1 ? "complete" : ""} onPress={() => setSetupStep(index + 1)}><span>{setupStep > index + 1 ? <Check size={13} /> : index + 1}</span>{label}</Button>)}</div>
              {setupStep === 1 && <div className="setup-form"><div className="form-copy"><h3>Project context</h3><p>Create the versioned operating boundary for one drilled-shaft package.</p></div><label>Project name<Input fullWidth defaultValue="2nd & Howard Infill" aria-label="Project name" /></label><div className="form-grid"><label>Location<Input fullWidth defaultValue="SoMa, San Francisco" aria-label="Location" /></label><label>Project hotline<Input fullWidth defaultValue="(415) 555-0148 · demo" aria-label="Project hotline" /></label></div></div>}
              {setupStep === 2 && <div className="setup-form"><div className="form-copy"><h3>Package + data products</h3><p>Attach the week plan, shaft elements, resources, and Nexla product contracts.</p></div><Alert status="accent"><Alert.Indicator><Layers3 size={16} /></Alert.Indicator><Alert.Content><Alert.Title>Six 72-inch drilled shafts</Alert.Title><Alert.Description>14 activities · 9 validation rules · 5 Nexla streams · 1 release milestone</Alert.Description></Alert.Content></Alert><div className="connection-list"><span><FileCheck2 size={16} /> Drilled shaft week plan <Chip size="sm" color="success" variant="soft"><Chip.Label>MAPPED</Chip.Label></Chip></span><span><Database size={16} /> Nexla field_events → schedule_events <Chip size="sm" color="success" variant="soft"><Chip.Label>ACTIVE</Chip.Label></Chip></span></div></div>}
              {setupStep === 3 && <div className="setup-form"><div className="form-copy"><h3>Bounded authority</h3><p>Groundwork can observe and discover freely; external actions require explicit scope.</p></div><div className="authority-list"><span><Check size={15} /> Normalize caller-confirmed field events</span><span><Check size={15} /> Search Zero capability providers</span><span><Check size={15} /> Contact consented demo recipients after approval</span><span className="blocked"><X size={15} /> Direct safety or engineered means and methods</span><span className="blocked"><X size={15} /> Negotiate cost or authorize change orders</span></div></div>}
              {setupStep === 4 && <div className="setup-form setup-ready"><div className="ready-icon"><ShieldCheck size={28} /></div><h3>Ready for shadow simulation</h3><p>The agent will replay the DS-02 obstruction call, normalize it through Nexla, discover Zero capabilities, and block every side effect until approval.</p><div className="simulation-summary"><span><strong>14</strong> activities</span><span><strong>9</strong> constraints</span><span><strong>4</strong> Zero searches</span></div></div>}
            </Card.Content>
            <Card.Footer className="setup-footer"><span>Manifest: supt_shafts_soma_001</span><div>{setupStep > 1 && <Button variant="tertiary" size="sm" onPress={() => setSetupStep(setupStep - 1)}>Back</Button>}{setupStep < 4 ? <Button variant="primary" size="sm" onPress={() => setSetupStep(setupStep + 1)}>Continue <ChevronRight size={15} /></Button> : <Button variant="primary" size="sm" onPress={() => { setShowSetup(false); setFeed((current) => [{ step: "INITIALIZED", detail: "Drilled-shaft superintendent validated in shadow mode.", tone: "success" }, ...current]); }}><Play size={15} /> Run simulation</Button>}</div></Card.Footer>
          </Card>
        </div>
      )}
    </main>
  );
}
