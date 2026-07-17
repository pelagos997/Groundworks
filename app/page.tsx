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
  CalendarDays,
  Check,
  ChevronRight,
  CircleAlert,
  Clock3,
  Database,
  FileCheck2,
  HardHat,
  Layers3,
  Mail,
  MapPin,
  Phone,
  Play,
  Radio,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  ThermometerSun,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  BASE_TASKS,
  type ReplanEvent,
  type ReplanResponse,
  type ScheduleTask,
} from "../lib/project-data";

type CommunicationState =
  | "idle"
  | "discovering"
  | "calling"
  | "connected"
  | "confirmed"
  | "declined"
  | "emailed";

type CommunicationReceipt = {
  discoveryStatus: "live" | "fallback";
  capability: { name: string } | null;
  receiptId: string;
};

const dayLabels = [
  "Mon 20",
  "Tue 21",
  "Wed 22",
  "Thu 23",
  "Fri 24",
  "Sat 25",
  "Mon 27",
  "Tue 28",
  "Wed 29",
  "Thu 30",
  "Fri 31",
  "Sat 1",
  "Mon 3",
  "Tue 4",
  "Wed 5",
  "Thu 6",
  "Fri 7",
  "Sat 8",
  "Mon 10",
];

const initialFeed: ReplanResponse["feed"] = [
  {
    step: "SYNCED",
    detail: "Nexla refreshed weather, inspection, and field-observation products.",
    tone: "success",
  },
  {
    step: "COMMITTED",
    detail: "Baseline v1 is active. Excavation release remains Aug 10.",
    tone: "neutral",
  },
];

function applyShifts(
  tasks: ScheduleTask[],
  shifts: Record<string, number>,
): ScheduleTask[] {
  return tasks.map((task) => ({
    ...task,
    start: task.start + (shifts[task.id] ?? 0),
  }));
}

function toneClass(tone: ReplanResponse["feed"][number]["tone"]) {
  if (tone === "danger") return "feed-dot danger";
  if (tone === "warning") return "feed-dot warning";
  if (tone === "success") return "feed-dot success";
  return "feed-dot";
}

function Gantt({
  tasks,
  baseline,
}: {
  tasks: ScheduleTask[];
  baseline: ScheduleTask[];
}) {
  return (
    <div className="gantt-scroll" aria-label="Micropile package schedule">
      <div className="gantt" data-testid="gantt">
        <div className="gantt-corner">
          <span>Activity</span>
          <span>18 day window</span>
        </div>
        <div className="gantt-dates">
          {dayLabels.map((day) => (
            <span key={day}>{day}</span>
          ))}
        </div>
        {tasks.map((task) => {
          const baselineTask = baseline.find((item) => item.id === task.id)!;
          const changed = baselineTask.start !== task.start;
          return (
            <div className="gantt-row" key={task.id}>
              <div className="task-label">
                <span className="task-id">{task.id}</span>
                <div>
                  <strong>{task.name}</strong>
                  <small>{task.meta}</small>
                </div>
              </div>
              <div className="gantt-track">
                <span
                  className="baseline-bar"
                  style={{
                    left: `${(baselineTask.start / 19) * 100}%`,
                    width: `${(baselineTask.duration / 19) * 100}%`,
                  }}
                />
                <span
                  className={`task-bar ${task.status} ${changed ? "changed" : ""}`}
                  style={{
                    left: `${(task.start / 19) * 100}%`,
                    width: `${(task.duration / 19) * 100}%`,
                  }}
                >
                  {changed && <span className="bar-time">{task.newTime ?? "moved"}</span>}
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
  const [committed, setCommitted] = useState("baseline-v1");
  const [activeEvent, setActiveEvent] = useState("No active collision");
  const [communication, setCommunication] =
    useState<CommunicationState>("idle");
  const [showSetup, setShowSetup] = useState(false);
  const [setupStep, setSetupStep] = useState(1);
  const [showEvidence, setShowEvidence] = useState(false);

  const releaseDelta = candidate?.deltaDays ?? 0;
  const releaseLabel =
    releaseDelta === 0
      ? "Aug 10"
      : releaseDelta < 1
        ? "Aug 10 · PM"
        : `Aug ${10 + releaseDelta}`;

  const validationCount = useMemo(
    () => candidate?.tests.filter((test) => test.passed).length ?? 9,
    [candidate],
  );

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
            result.event === "hot_weather" && task.id === "G08"
              ? "05:00"
              : result.shifts[task.id]
                ? `+${result.shifts[task.id]}d`
                : undefined,
        })),
      );
      setFeed(result.feed);
      setActiveEvent(result.trigger);
    } catch {
      setFeed([
        {
          step: "RECOVER",
          detail: "The planning service did not answer. Baseline remains committed.",
          tone: "danger",
        },
        ...feed,
      ]);
    } finally {
      setBusy(false);
    }
  }

  function approveCandidate() {
    if (!candidate) return;
    setCommitted(candidate.commitId);
    setFeed([
      {
        step: "COMMITTED",
        detail: `${candidate.commitId} merged into the live schedule. External actions are now eligible.`,
        tone: "success",
      },
      ...candidate.feed,
    ]);
  }

  function resetDemo() {
    setTasks(BASE_TASKS);
    setCandidate(null);
    setFeed(initialFeed);
    setCommitted("baseline-v1");
    setActiveEvent("No active collision");
    setCommunication("idle");
  }

  function rejectCandidate() {
    setCandidate(null);
    setTasks(BASE_TASKS);
    setActiveEvent("No active collision");
    setFeed([
      {
        step: "REJECTED",
        detail: "Candidate discarded. The committed schedule remains unchanged.",
        tone: "neutral",
      },
      ...initialFeed,
    ]);
  }

  async function discoverCommunication(kind: "voice" | "email") {
    const response = await fetch("/api/communications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        kind,
        approved: isApproved,
        replanId: committed,
      }),
    });
    if (!response.ok) throw new Error("Communication discovery failed");
    return (await response.json()) as CommunicationReceipt;
  }

  async function startCall() {
    setCommunication("discovering");
    try {
      const receipt = await discoverCommunication("voice");
      setFeed((current) => [
        {
          step: "DISCOVERED",
          detail: receipt.capability
            ? `Zero selected ${receipt.capability.name}. Receipt ${receipt.receiptId}.`
            : `Zero discovery fallback prepared the sandbox call. Receipt ${receipt.receiptId}.`,
          tone: receipt.discoveryStatus === "live" ? "success" : "neutral",
        },
        ...current,
      ]);
      setCommunication("calling");
      window.setTimeout(() => setCommunication("connected"), 850);
    } catch {
      setCommunication("idle");
      setFeed((current) => [
        { step: "BLOCKED", detail: "Communication discovery failed; no call was placed.", tone: "danger" },
        ...current,
      ]);
    }
  }

  function crewResponse(outcome: "confirmed" | "declined") {
    setCommunication(outcome);
    if (outcome === "confirmed") {
      setFeed((current) => [
        {
          step: "VERIFIED",
          detail: "Luis confirmed the 05:00 crew start by voice read-back. Action receipt retained.",
          tone: "success",
        },
        ...current,
      ]);
    } else {
      void runReplan("crew_declined");
    }
  }

  async function sendEmail() {
    setCommunication("discovering");
    try {
      const receipt = await discoverCommunication("email");
      setCommunication("emailed");
      setFeed((current) => [
        {
          step: "PREPARED",
          detail: `${receipt.capability ? `Zero selected ${receipt.capability.name}. ` : ""}Sandbox confirmation retained as ${receipt.receiptId}; no external email was sent.`,
          tone: "success",
        },
        ...current,
      ]);
    } catch {
      setCommunication("idle");
      setFeed((current) => [
        { step: "BLOCKED", detail: "Communication discovery failed; no email was sent.", tone: "danger" },
        ...current,
      ]);
    }
  }

  const isApproved = candidate ? committed === candidate.commitId : false;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">
            <Layers3 size={21} />
          </div>
          <div>
            <div className="brand-line">
              <strong>GROUNDWORK</strong>
              <Chip size="sm" color="success" variant="soft">
                <Chip.Label>LIVE DEMO</Chip.Label>
              </Chip>
            </div>
            <span>Geotechnical package control</span>
          </div>
        </div>
        <div className="project-context">
          <MapPin size={15} />
          <span>2nd & Howard · SoMa</span>
          <span className="context-divider" />
          <span>Micropiles + underpinning</span>
        </div>
        <div className="topbar-actions">
          <Button variant="tertiary" size="sm" onPress={() => setShowSetup(true)}>
            <Sparkles size={15} />
            Initialize agent
          </Button>
          <Button variant="outline" size="sm" onPress={resetDemo} aria-label="Reset demo">
            <RefreshCcw size={15} />
            Reset
          </Button>
          <div className="avatar">RJ</div>
        </div>
      </header>

      <section className="workspace">
        <div className="eyebrow-row">
          <div>
            <p className="eyebrow">SUPERINTENDENT CONTROL ROOM</p>
            <h1>Protect the excavation release.</h1>
          </div>
          <div className="source-health">
            <span><i className="pulse" /> Nexla stream current</span>
            <span><Database size={14} /> 4 data products</span>
            <span><Clock3 size={14} /> refreshed 12s ago</span>
          </div>
        </div>

        <div className="kpi-grid">
          <Card className="kpi-card">
            <Card.Content>
              <div className="kpi-top"><span>Excavation release</span><CalendarDays size={18} /></div>
              <div className="kpi-value">{releaseLabel}</div>
              <div className={`kpi-delta ${releaseDelta ? "negative" : "positive"}`}>
                {releaseDelta ? <ArrowDownRight size={14} /> : <Check size={14} />}
                {releaseDelta ? `+${releaseDelta} day from baseline` : "Holding baseline"}
              </div>
            </Card.Content>
          </Card>
          <Card className="kpi-card">
            <Card.Content>
              <div className="kpi-top"><span>Active constraint</span><CircleAlert size={18} /></div>
              <div className="kpi-event">{activeEvent}</div>
              <div className="kpi-sub">Critical path monitored continuously</div>
            </Card.Content>
          </Card>
          <Card className="kpi-card">
            <Card.Content>
              <div className="kpi-top"><span>Validation gate</span><ShieldCheck size={18} /></div>
              <div className="kpi-value">{validationCount}/9</div>
              <div className="kpi-sub">Deterministic constraints passing</div>
            </Card.Content>
          </Card>
          <Card className="kpi-card accent-card">
            <Card.Content>
              <div className="kpi-top"><span>Production</span><HardHat size={18} /></div>
              <div className="kpi-value">8 / 24</div>
              <ProgressBar aria-label="Production progress" value={33} color="accent" size="sm">
                <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
              </ProgressBar>
              <div className="kpi-sub">Zone A · field verified</div>
            </Card.Content>
          </Card>
        </div>

        <div className="control-grid">
          <Card className="schedule-card">
            <Card.Header className="card-heading schedule-heading">
              <div>
                <Card.Title>Micropile package · CPM</Card.Title>
                <Card.Description>
                  Baseline in outline · committed/proposed plan in color
                </Card.Description>
              </div>
              <Chip size="sm" color={candidate ? "warning" : "success"} variant="soft">
                <Chip.Label>{candidate ? "CANDIDATE PLAN" : committed.toUpperCase()}</Chip.Label>
              </Chip>
            </Card.Header>
            <Card.Content className="schedule-content">
              <div className="scenario-bar">
                <div className="scenario-copy">
                  <span className="scenario-label">Punch the schedule</span>
                  <span>Inject a live condition and watch Groundwork recover.</span>
                </div>
                <div className="scenario-actions">
                  <Button
                    size="sm"
                    variant="danger-soft"
                    onPress={() => void runReplan("hot_weather")}
                    isDisabled={busy}
                  >
                    <ThermometerSun size={15} /> 91°F grout window
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onPress={() => void runReplan("inspector_cancelled")}
                    isDisabled={busy}
                  >
                    <UserRoundCheck size={15} /> Inspector cancelled
                  </Button>
                </div>
              </div>
              {busy ? (
                <div className="planning-state">
                  <Spinner size="lg" color="accent" />
                  <div><strong>Replanning package</strong><span>Solving resources and testing constraints…</span></div>
                </div>
              ) : (
                <Gantt tasks={tasks} baseline={BASE_TASKS} />
              )}
              <div className="legend-row">
                <span><i className="legend critical" /> Critical path</span>
                <span><i className="legend complete" /> Complete</span>
                <span><i className="legend parallel" /> Parallel work</span>
                <span><i className="legend baseline" /> Baseline</span>
              </div>
            </Card.Content>
            {candidate && !busy && (
              <Card.Footer className="candidate-footer">
                <div>
                  <span className="candidate-label">Recommended recovery</span>
                  <strong>{candidate.recommendation}</strong>
                  <small>{candidate.rationale}</small>
                </div>
                <div className="candidate-actions">
                  <Button variant="tertiary" size="sm" onPress={rejectCandidate}>Reject</Button>
                  <Button variant="primary" size="sm" onPress={approveCandidate} isDisabled={isApproved}>
                    <FileCheck2 size={15} /> {isApproved ? "Committed" : "Approve & commit"}
                  </Button>
                </div>
              </Card.Footer>
            )}
          </Card>

          <Card className="feed-card">
            <Card.Header className="card-heading">
              <div>
                <Card.Title>Agent control loop</Card.Title>
                <Card.Description>Evidence and decisions, not hidden reasoning</Card.Description>
              </div>
              <span className="live-indicator"><i /> LIVE</span>
            </Card.Header>
            <Card.Content className="feed-content">
              {feed.map((item, index) => (
                <div className="feed-item" key={`${item.step}-${item.detail}-${index}`}>
                  <div className={toneClass(item.tone)} />
                  <div>
                    <span>{item.step}</span>
                    <p>{item.detail}</p>
                  </div>
                </div>
              ))}
            </Card.Content>
            <Card.Footer className="feed-footer">
              <Activity size={15} />
              Thread: supt_geo_soma_001
            </Card.Footer>
          </Card>
        </div>

        <div className="lower-grid">
          <Card className="evidence-card">
            <Card.Header className="card-heading">
              <div>
                <Card.Title>Field evidence</Card.Title>
                <Card.Description>Human-verified observations only</Card.Description>
              </div>
              <Button variant="tertiary" size="sm" onPress={() => setShowEvidence(!showEvidence)}>
                {showEvidence ? "Hide details" : "Review observation"}
                <ChevronRight size={15} />
              </Button>
            </Card.Header>
            <Card.Content>
              <div className="evidence-layout">
                <div className="site-photo" role="img" aria-label="Micropile drilling field observation">
                  <div className="photo-overlay">
                    <Chip size="sm" color="success" variant="primary"><Chip.Label>VERIFIED</Chip.Label></Chip>
                    <span>Today · 07:42 · Zone A</span>
                  </div>
                </div>
                <div className="observation-copy">
                  <span className="observation-label">FIELD OBSERVATION FO-018</span>
                  <h3>Production micropiles · Zone A</h3>
                  <p>MP-05 through MP-08 accepted by the field user. Installed quantity updated from 4 to 8.</p>
                  <div className="confidence-row"><span>Model confidence</span><strong>93%</strong></div>
                  {showEvidence && (
                    <Alert status="accent" className="evidence-alert">
                      <Alert.Indicator><ShieldCheck size={16} /></Alert.Indicator>
                      <Alert.Content>
                        <Alert.Title>Progress evidence only</Alert.Title>
                        <Alert.Description>Depth, bond length, grout quality, and acceptance remain tied to logs and tests.</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}
                </div>
              </div>
            </Card.Content>
          </Card>

          <Card className="communications-card">
            <Card.Header className="card-heading">
              <div>
                <Card.Title>Crew communications</Card.Title>
                <Card.Description>Zero-discovered call and email capabilities</Card.Description>
              </div>
              <Chip size="sm" color="accent" variant="soft"><Chip.Label>ZERO SANDBOX</Chip.Label></Chip>
            </Card.Header>
            <Card.Content>
              <div className="contact-row">
                <div className="contact-avatar">LM</div>
                <div><strong>Luis Martinez</strong><span>Micropile foreman · AI call consent on file</span></div>
                <span className="contact-status"><i /> Available</span>
              </div>

              {communication === "idle" && (
                <div className="communication-empty">
                  <Radio size={20} />
                  <div><strong>No communication in progress</strong><span>Commit a candidate plan to contact the field.</span></div>
                </div>
              )}
              {communication === "discovering" && (
                <div className="communication-live"><Spinner size="sm" color="accent" /><div><strong>Zero is discovering a voice capability</strong><span>Checking price, provider score, and schema…</span></div></div>
              )}
              {communication === "calling" && (
                <div className="communication-live"><span className="call-pulse"><Phone size={18} /></span><div><strong>Calling Luis…</strong><span>AI identity and recording disclosure queued</span></div></div>
              )}
              {communication === "connected" && (
                <div className="call-console">
                  <div className="call-header"><span className="call-pulse"><Phone size={17} /></span><div><strong>Connected · 00:18</strong><span>“Can the crew report at 05:00 Friday?”</span></div></div>
                  <div className="call-response-actions">
                    <Button size="sm" variant="secondary" onPress={() => crewResponse("confirmed")}><Check size={14} /> Crew confirms</Button>
                    <Button size="sm" variant="danger-soft" onPress={() => crewResponse("declined")}><X size={14} /> Cannot make 05:00</Button>
                  </div>
                </div>
              )}
              {communication === "confirmed" && <Alert status="success"><Alert.Indicator><Check size={16} /></Alert.Indicator><Alert.Content><Alert.Title>Crew confirmed</Alert.Title><Alert.Description>05:00 Friday start read back and accepted.</Alert.Description></Alert.Content></Alert>}
              {communication === "declined" && <Alert status="warning"><Alert.Indicator><CircleAlert size={16} /></Alert.Indicator><Alert.Content><Alert.Title>Crew declined</Alert.Title><Alert.Description>A new replan has started from the response.</Alert.Description></Alert.Content></Alert>}
              {communication === "emailed" && <Alert status="success"><Alert.Indicator><Mail size={16} /></Alert.Indicator><Alert.Content><Alert.Title>Confirmation sent</Alert.Title><Alert.Description>Crew, inspector, and supplier received replan {committed}.</Alert.Description></Alert.Content></Alert>}
            </Card.Content>
            <Card.Footer className="communication-actions">
              <Button size="sm" variant="primary" onPress={() => void startCall()} isDisabled={!isApproved || ["discovering", "calling", "connected"].includes(communication)}>
                <Phone size={15} /> Call foreman with Zero
              </Button>
              <Button size="sm" variant="outline" onPress={() => void sendEmail()} isDisabled={!isApproved}>
                <Mail size={15} /> Send confirmation email
              </Button>
            </Card.Footer>
          </Card>
        </div>

        <footer className="app-footer">
          <span><ShieldCheck size={14} /> Bounded autonomy · every side effect is policy-checked</span>
          <span>Akash deployment target · Nexla data plane · Zero capability plane</span>
        </footer>
      </section>

      {showSetup && (
        <div className="setup-backdrop" role="presentation">
          <Card className="setup-panel" role="dialog" aria-modal="true" aria-label="Initialize superintendent agent">
            <Card.Header className="setup-header">
              <div>
                <span className="setup-kicker">AGENT SETUP STUDIO</span>
                <Card.Title>Initialize a superintendent</Card.Title>
                <Card.Description>Micropile Superintendent v1 · shadow mode</Card.Description>
              </div>
              <Button isIconOnly variant="tertiary" onPress={() => setShowSetup(false)} aria-label="Close setup"><X size={18} /></Button>
            </Card.Header>
            <Card.Content className="setup-content">
              <div className="setup-progress">
                {["Project", "Package", "Authority", "Simulate"].map((label, index) => (
                  <Button
                    key={label}
                    size="sm"
                    variant="tertiary"
                    className={setupStep === index + 1 ? "active" : setupStep > index + 1 ? "complete" : ""}
                    onPress={() => setSetupStep(index + 1)}
                  >
                    <span>{setupStep > index + 1 ? <Check size={13} /> : index + 1}</span>{label}
                  </Button>
                ))}
              </div>

              {setupStep === 1 && (
                <div className="setup-form">
                  <div className="form-copy"><h3>Project context</h3><p>This creates the versioned operating boundary for one project package.</p></div>
                  <label>Project name<Input fullWidth defaultValue="2nd & Howard Infill" aria-label="Project name" /></label>
                  <div className="form-grid"><label>Location<Input fullWidth defaultValue="SoMa, San Francisco" aria-label="Location" /></label><label>Timezone<Input fullWidth defaultValue="America/Los_Angeles" aria-label="Timezone" /></label></div>
                </div>
              )}
              {setupStep === 2 && (
                <div className="setup-form">
                  <div className="form-copy"><h3>Package template</h3><p>Attach the schedule, elements, resources, and approved constraint set.</p></div>
                  <Alert status="accent"><Alert.Indicator><Layers3 size={16} /></Alert.Indicator><Alert.Content><Alert.Title>Micropiles + underpinning</Alert.Title><Alert.Description>24 elements · 13 activities · 9 validation rules · 1 release milestone</Alert.Description></Alert.Content></Alert>
                  <div className="connection-list"><span><FileCheck2 size={16} /> Baseline schedule.csv <Chip size="sm" color="success" variant="soft"><Chip.Label>MAPPED</Chip.Label></Chip></span><span><Database size={16} /> Nexla project flows <Chip size="sm" color="success" variant="soft"><Chip.Label>4 ACTIVE</Chip.Label></Chip></span></div>
                </div>
              )}
              {setupStep === 3 && (
                <div className="setup-form">
                  <div className="form-copy"><h3>Bounded authority</h3><p>Groundwork can observe freely; side effects require explicit scope.</p></div>
                  <div className="authority-list"><span><Check size={15} /> Auto-commit read-only observations</span><span><Check size={15} /> Draft crew calls and emails</span><span><Check size={15} /> Call consented demo recipients after approval</span><span className="blocked"><X size={15} /> Negotiate cost or authorize overtime</span><span className="blocked"><X size={15} /> Submit city or contractual commitments</span></div>
                </div>
              )}
              {setupStep === 4 && (
                <div className="setup-form setup-ready">
                  <div className="ready-icon"><ShieldCheck size={28} /></div>
                  <h3>Ready for shadow simulation</h3>
                  <p>Groundwork will replay heat, inspector cancellation, and crew-decline events without external side effects.</p>
                  <div className="simulation-summary"><span><strong>13</strong> activities</span><span><strong>9</strong> constraints</span><span><strong>3</strong> scenarios</span></div>
                </div>
              )}
            </Card.Content>
            <Card.Footer className="setup-footer">
              <span>Manifest: supt_geo_soma_001</span>
              <div>
                {setupStep > 1 && <Button variant="tertiary" size="sm" onPress={() => setSetupStep(setupStep - 1)}>Back</Button>}
                {setupStep < 4 ? (
                  <Button variant="primary" size="sm" onPress={() => setSetupStep(setupStep + 1)}>Continue <ChevronRight size={15} /></Button>
                ) : (
                  <Button variant="primary" size="sm" onPress={() => { setShowSetup(false); setFeed([{ step: "INITIALIZED", detail: "Superintendent manifest validated in shadow mode.", tone: "success" }, ...feed]); }}><Play size={15} /> Run simulation</Button>
                )}
              </div>
            </Card.Footer>
          </Card>
        </div>
      )}
    </main>
  );
}
