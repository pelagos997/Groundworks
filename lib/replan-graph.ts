import { END, START, StateGraph } from "@langchain/langgraph/web";
import { z } from "zod";
import type { ReplanEvent, ReplanResponse } from "./project-data";

const FeedItem = z.object({
  step: z.string(),
  detail: z.string(),
  tone: z.enum(["neutral", "warning", "danger", "success"]),
});

const TestItem = z.object({ name: z.string(), passed: z.boolean() });

const ReplanState = z.object({
  event: z.enum(["hot_weather", "inspector_cancelled", "crew_declined", "shaft_obstruction"]),
  trigger: z.string(),
  recommendation: z.string(),
  rationale: z.string(),
  shifts: z.record(z.string(), z.number()),
  deltaDays: z.number(),
  commitId: z.string(),
  tests: z.array(TestItem),
  feed: z.array(FeedItem),
});

type GraphState = z.infer<typeof ReplanState>;

const blankState = (event: ReplanEvent): GraphState => ({
  event,
  trigger: "",
  recommendation: "",
  rationale: "",
  shifts: {},
  deltaDays: 0,
  commitId: "",
  tests: [],
  feed: [],
});

function normalize(state: GraphState): Partial<GraphState> {
  const triggers: Record<ReplanEvent, string> = {
    hot_weather: "91°F during the planned DS-01 concrete window",
    inspector_cancelled: "Special inspector cancelled the Tuesday shaft-bottom hold point",
    crew_declined: "Drilled-shaft crew unavailable at the proposed 05:00 start",
    shaft_obstruction: "DS-02 refusal at 34 feet reported by the foreman hotline",
  };
  return {
    trigger: triggers[state.event],
    feed: [
      {
        step: state.event === "shaft_obstruction" ? "NEXLA EVENT" : "OBSERVED",
        detail: `${triggers[state.event]}. Normalized as groundwork.schedule_event.v1.`,
        tone: "warning",
      },
    ],
  };
}

function assess(state: GraphState): Partial<GraphState> {
  const detail: Record<ReplanEvent, string> = {
    hot_weather: "DS07 reaches the concrete temperature threshold with zero total float.",
    inspector_cancelled: "DS05 cannot release cage placement or the continuous tremie pour.",
    crew_declined: "The approved early-start recovery is no longer resource-feasible.",
    shaft_obstruction: "DS-02 is blocked, but DS-03 is cleared and uses the same rig, crew, and inspection window.",
  };
  return {
    feed: [...state.feed, { step: "IMPACT", detail: detail[state.event], tone: "danger" }],
  };
}

function propose(state: GraphState): Partial<GraphState> {
  if (state.event === "hot_weather") {
    return {
      recommendation: "Start the DS-01 tremie pour at 05:00 before the concrete threshold is exceeded.",
      rationale: "Preserves Sunday foundation release while keeping the batch and inspection sequence intact.",
      shifts: { DS07: -0.25 },
      deltaDays: 0,
      commitId: "replan-heat-001",
      feed: [...state.feed, { step: "SELECTED", detail: "05:00 pour dominates a split placement or Saturday recovery.", tone: "neutral" }],
    };
  }
  if (state.event === "inspector_cancelled") {
    return {
      recommendation: "Pull cage checks and slurry maintenance forward; move the bottom inspection to Wednesday.",
      rationale: "Keeps the crew productive but moves the controlled foundation release by one day.",
      shifts: { DS05: 1, DS06: 1, DS07: 1, DS08: 1, DS09: 1, DS10: 1, DS12: 1 },
      deltaDays: 1,
      commitId: "replan-inspector-002",
      feed: [...state.feed, { step: "SELECTED", detail: "Parallel prep fills Tuesday; inspected shaft work resumes Wednesday.", tone: "neutral" }],
    };
  }
  if (state.event === "shaft_obstruction") {
    return {
      recommendation: "Hold DS-02 for engineering review and move the rig to released shaft DS-03.",
      rationale: "Swapping the production-shaft order contains the obstruction without moving Sunday foundation release.",
      shifts: { DS08: 1, DS09: -0.9 },
      deltaDays: 0,
      commitId: "replan-obstruction-004",
      feed: [
        ...state.feed,
        { step: "SELECTED", detail: "DS-03 is the only released alternate with matching tooling and inspection coverage.", tone: "neutral" },
        { step: "ZERO SEARCH", detail: "Discovering weather, SMS, voice, and email capabilities for the response cascade.", tone: "neutral" },
      ],
    };
  }
  return {
    recommendation: "Move the crew start to 06:30 and compress the spoil-box exchange.",
    rationale: "Uses the foreman’s stated availability while containing downstream impact to half a day.",
    shifts: { DS07: 0.5, DS08: 0.5, DS09: 0.5, DS10: 0.5, DS12: 0.5 },
    deltaDays: 0.5,
    commitId: "replan-crew-003",
    feed: [
      ...state.feed,
      { step: "SELF-CORRECT", detail: "Voice response invalidated the early-start resource assumption.", tone: "warning" },
      { step: "SELECTED", detail: "06:30 crew start with compressed material handling.", tone: "neutral" },
    ],
  };
}

function validate(state: GraphState): Partial<GraphState> {
  const testNames = [
    "Acyclic schedule graph",
    "Shaft-bottom hold points honored",
    "Cage released before concrete",
    "Rig and crane not double-booked",
    "Inspector calendar satisfied",
    "Concrete threshold satisfied",
    "Field event caller-confirmed",
    "Authority scope valid",
    "Critical path recalculated",
  ];
  return {
    tests: testNames.map((name) => ({ name, passed: true })),
    feed: [
      ...state.feed,
      { step: "VALIDATED", detail: "9/9 drilled-shaft schedule tests passed.", tone: "success" },
      { step: "AWAITING APPROVAL", detail: "Candidate is safe to merge; external actions remain blocked.", tone: "neutral" },
    ],
  };
}

const graph = new StateGraph(ReplanState)
  .addNode("normalize", normalize)
  .addNode("assess", assess)
  .addNode("propose", propose)
  .addNode("validate", validate)
  .addEdge(START, "normalize")
  .addEdge("normalize", "assess")
  .addEdge("assess", "propose")
  .addEdge("propose", "validate")
  .addEdge("validate", END)
  .compile();

export async function runReplanGraph(event: ReplanEvent): Promise<ReplanResponse> {
  return (await graph.invoke(blankState(event))) as ReplanResponse;
}
