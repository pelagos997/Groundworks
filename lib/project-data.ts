export type ReplanEvent =
  | "hot_weather"
  | "inspector_cancelled"
  | "crew_declined";

export type ScheduleTask = {
  id: string;
  name: string;
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
  { id: "G01", name: "Mobilize rig + platform", meta: "Crew · rig", start: 0, duration: 1, status: "complete" },
  { id: "G02", name: "Pothole utilities + layout", meta: "Survey · utility clearance", start: 1, duration: 1, status: "complete" },
  { id: "G03", name: "Verification pile MP-01", meta: "Inspector · grout", start: 2, duration: 0.75, status: "critical" },
  { id: "G04", name: "Cure to test strength", meta: "Cylinder break ≥ 3,000 psi", start: 2.75, duration: 3, status: "critical" },
  { id: "G05", name: "Verification load test", meta: "Lab · reaction frame", start: 5.75, duration: 0.75, status: "critical" },
  { id: "G06", name: "Engineer acceptance", meta: "EOR hold point", start: 6.5, duration: 0.5, status: "critical" },
  { id: "G07", name: "Production piles · Zone A", meta: "12 elements · inspector", start: 7, duration: 2.5, status: "critical" },
  { id: "G08", name: "Production piles · Zone B", meta: "12 elements · inspector", start: 9.5, duration: 2.5, status: "critical" },
  { id: "P01", name: "Stage cages + spoil boxes", meta: "Parallel prep", start: 6.75, duration: 2, status: "parallel" },
  { id: "G09", name: "Trim piles + bearing plates", meta: "Survey hold point", start: 12, duration: 1.5, status: "critical" },
  { id: "G10", name: "Form + reinforce caps", meta: "Cap CP-01 through CP-04", start: 13.5, duration: 2, status: "critical" },
  { id: "G11", name: "Cap reinforcement inspection", meta: "Special inspector", start: 15.5, duration: 0.5, status: "critical" },
  { id: "G12", name: "Place cap concrete", meta: "Batch slot · weather", start: 16, duration: 0.75, status: "critical" },
  { id: "G13", name: "Cure + release excavation", meta: "Strength · EOR release", start: 16.75, duration: 2.25, status: "critical" },
];
