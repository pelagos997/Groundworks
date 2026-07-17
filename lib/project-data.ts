export type ReplanEvent =
  | "hot_weather"
  | "inspector_cancelled"
  | "crew_declined"
  | "shaft_obstruction";

export type ScheduleTask = {
  id: string;
  name: string;
  description: string;
  meta: string;
  start: number;
  duration: number;
  status: "critical" | "parallel" | "complete";
  newTime?: string;
};

export type ReplanResponse = {
  event: ReplanEvent;
  trigger: string;
  recommendation: string;
  rationale: string;
  shifts: Record<string, number>;
  deltaDays: number;
  commitId: string;
  tests: Array<{ name: string; passed: boolean }>;
  feed: Array<{
    step: string;
    detail: string;
    tone: "neutral" | "warning" | "danger" | "success";
  }>;
};

export const BASE_TASKS: ScheduleTask[] = [
  {
    id: "DS01",
    name: "Accept working platform",
    description: "Geotechnical user verifies platform elevation, drainage, and rig bearing condition before mobilization.",
    meta: "Mon · Geotech hold point",
    start: 0,
    duration: 0.35,
    status: "complete",
  },
  {
    id: "DS02",
    name: "Layout + utility clearance",
    description: "Survey controls shaft centers and confirms the cleared drilling envelope against current utility marks.",
    meta: "Mon · Survey + GC",
    start: 0.35,
    duration: 0.4,
    status: "complete",
  },
  {
    id: "DS03",
    name: "Mobilize drill rig + casing",
    description: "Walk the rotary rig onto the accepted platform and stage temporary casing, tooling, and slurry plant.",
    meta: "Mon · Rig + operator",
    start: 0.75,
    duration: 0.45,
    status: "complete",
  },
  {
    id: "P01",
    name: "Fabricate cages + CSL tubes",
    description: "Complete reinforcing cages, centralizers, lifting points, and crosshole sonic logging tubes off the critical path.",
    meta: "Mon–Tue · Rebar fabricator",
    start: 0.2,
    duration: 1.6,
    status: "parallel",
  },
  {
    id: "DS04",
    name: "Excavate test shaft DS-01",
    description: "Advance the 72-inch shaft through fill and dense sand to the design tip while logging strata and tooling response.",
    meta: "Tue · 72-in shaft · Inspector",
    start: 1.2,
    duration: 0.75,
    status: "critical",
  },
  {
    id: "DS05",
    name: "Clean base + inspect shaft",
    description: "Clean sediment, verify tip elevation and verticality, and obtain special-inspector acceptance before cage placement.",
    meta: "Tue · Inspector hold point",
    start: 1.95,
    duration: 0.35,
    status: "critical",
  },
  {
    id: "DS06",
    name: "Set cage + instrumentation",
    description: "Lift the reinforcing cage, secure CSL tubes, confirm cover, and record final top-of-cage elevation.",
    meta: "Wed · Crane + ironworkers",
    start: 2.3,
    duration: 0.45,
    status: "critical",
  },
  {
    id: "DS07",
    name: "Tremie concrete DS-01",
    description: "Place concrete continuously from the shaft base, track theoretical versus actual volume, and maintain tremie embedment.",
    meta: "Wed · 180 CY · Batch slot",
    start: 2.75,
    duration: 0.45,
    status: "critical",
  },
  {
    id: "P02",
    name: "Spoil haul + slurry management",
    description: "Cycle sealed spoil boxes, manage slurry properties, and keep the work zone clear for continuous drilling operations.",
    meta: "Tue–Sat · Environmental",
    start: 1.2,
    duration: 4.6,
    status: "parallel",
  },
  {
    id: "DS08",
    name: "Excavate production shaft DS-02",
    description: "Drill the first production shaft using the accepted test-shaft means, logging groundwater and any obstructions.",
    meta: "Thu · Rig crew + inspector",
    start: 3.15,
    duration: 0.85,
    status: "critical",
  },
  {
    id: "DS09",
    name: "Excavate production shaft DS-03",
    description: "Advance the second production shaft and keep it available as the approved resequencing target if DS-02 is blocked.",
    meta: "Fri · Rig crew + inspector",
    start: 4.05,
    duration: 0.85,
    status: "critical",
  },
  {
    id: "DS10",
    name: "Inspect, cage + concrete DS-02/03",
    description: "Complete bottom acceptance, cage placement, and continuous tremie pours for both released production shafts.",
    meta: "Fri–Sat · Inspector + batch",
    start: 4.9,
    duration: 1.05,
    status: "critical",
  },
  {
    id: "DS11",
    name: "Cure monitoring + CSL baseline",
    description: "Monitor early concrete strength and establish the crosshole sonic logging baseline without releasing acceptance early.",
    meta: "Thu–Sun · Testing lab",
    start: 3.2,
    duration: 3.3,
    status: "parallel",
  },
  {
    id: "DS12",
    name: "Cutoff + foundation release",
    description: "Survey cutoff elevations, remove contaminated concrete, and issue the controlled release for pile-cap work.",
    meta: "Sun · Survey + EOR release",
    start: 6.5,
    duration: 0.5,
    status: "critical",
  },
];
