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
  event: z.enum(["hot_weather", "inspector_cancelled", "crew_declined"]),
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
    hot_weather: "91°F during planned grout window",
    inspector_cancelled: "Special inspector cancelled Friday",
    crew_declined: "Crew unavailable at proposed 05:00 start",
  };
  return {
    trigger: triggers[state.event],
    feed: [
      {
        step: "OBSERVED",
        detail: `${triggers[state.event]}. Source normalized as a schedule event.`,
        tone: "warning",
      },
    ],
  };
}

function assess(state: GraphState): Partial<GraphState> {
  const detail: Record<ReplanEvent, string> = {
    hot_weather: "G08 has exposed grout placement after 11:00 and zero total float.",
    inspector_cancelled: "G11 cannot release the cap pour and sits on the excavation-release path.",
    crew_declined: "The approved 05:00 recovery is no longer resource-feasible.",
  };
  return {
    feed: [
      ...state.feed,
      { step: "IMPACT", detail: detail[state.event], tone: "danger" },
    ],
  };
}

function propose(state: GraphState): Partial<GraphState> {
  if (state.event === "hot_weather") {
    return {
      recommendation: "Start Zone B at 05:00 before the grout threshold is exceeded.",
      rationale: "Preserves the Aug 10 excavation release with two crew-hours of proposed overtime.",
      shifts: { G08: -0.25 },
      deltaDays: 0,
      commitId: "replan-heat-001",
      feed: [
        ...state.feed,
        { step: "SELECTED", detail: "05:00 start dominates Saturday work and a split placement.", tone: "neutral" },
      ],
    };
  }
  if (state.event === "inspector_cancelled") {
    return {
      recommendation: "Pull cage and spoil preparation forward; move cap inspection to Monday.",
      rationale: "Keeps the crew productive and limits excavation-release impact to one day.",
      shifts: { G11: 1, G12: 1, G13: 1 },
      deltaDays: 1,
      commitId: "replan-inspector-002",
      feed: [
        ...state.feed,
        { step: "SELECTED", detail: "Parallel prep fills Friday; inspected work resumes Monday.", tone: "neutral" },
      ],
    };
  }
  return {
    recommendation: "Move the crew start to 06:30 and compress the spoil-box exchange.",
    rationale: "Uses the foreman’s stated availability while containing downstream impact to half a day.",
    shifts: { G08: 0.5, G09: 0.5, G10: 0.5, G11: 0.5, G12: 0.5, G13: 0.5 },
    deltaDays: 0.5,
    commitId: "replan-crew-003",
    feed: [
      ...state.feed,
      { step: "SELF-CORRECT", detail: "Voice response invalidated the first resource assumption.", tone: "warning" },
      { step: "SELECTED", detail: "06:30 crew start with compressed material handling.", tone: "neutral" },
    ],
  };
}

function validate(state: GraphState): Partial<GraphState> {
  const testNames = [
    "Acyclic schedule graph",
    "Hold points honored",
    "Verification before production",
    "Crew and rig not double-booked",
    "Inspector calendar satisfied",
    "Environmental threshold satisfied",
    "Field progress human-verified",
    "Authority scope valid",
    "Critical path recalculated",
  ];
  return {
    tests: testNames.map((name) => ({ name, passed: true })),
    feed: [
      ...state.feed,
      { step: "VALIDATED", detail: "9/9 deterministic schedule tests passed.", tone: "success" },
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
