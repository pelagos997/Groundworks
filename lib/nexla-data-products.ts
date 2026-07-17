import type { FieldObservation } from "./agentphone";

export type FieldEvent = {
  schema: "groundwork.field_event.v1";
  eventId: string;
  projectId: string;
  receivedAt: string;
  source: "inbound_voice" | "inbound_message";
  sourceProvider: "agentphone" | "controlled_demo";
  caller: {
    contactId: string;
    name: string;
    role: string;
    verified: true;
  };
  consent: {
    aiDisclosureAccepted: boolean;
    transcriptionAccepted: boolean;
  };
  observation: {
    taskId: string | null;
    elementId: string;
    category: string;
    status: "work_stopped" | "reported";
    detail: string;
    depthFt: number | null;
    alternateElement: string | null;
  };
  readbackConfirmed: true;
  confidence: number;
};

export function createFieldEvent(input: {
  eventId?: string;
  projectId: string;
  source: FieldEvent["source"];
  provider: FieldEvent["sourceProvider"];
  contact: FieldEvent["caller"];
  observation: FieldObservation;
  disclosureAccepted: boolean;
  confidence?: number;
}): FieldEvent {
  if (!input.observation.elementId || !input.observation.condition) {
    throw new Error("A confirmed element and condition are required.");
  }
  return {
    schema: "groundwork.field_event.v1",
    eventId: input.eventId ?? `field_${crypto.randomUUID().slice(0, 12)}`,
    projectId: input.projectId,
    receivedAt: new Date().toISOString(),
    source: input.source,
    sourceProvider: input.provider,
    caller: input.contact,
    consent: {
      aiDisclosureAccepted: input.disclosureAccepted,
      transcriptionAccepted: input.source === "inbound_voice",
    },
    observation: {
      taskId: taskForElement(input.observation.elementId),
      elementId: input.observation.elementId,
      category: input.observation.condition,
      status: input.observation.workStopped ? "work_stopped" : "reported",
      detail: input.observation.rawText,
      depthFt: input.observation.depthFt,
      alternateElement: input.observation.alternateElement,
    },
    readbackConfirmed: true,
    confidence: input.confidence ?? 0.94,
  };
}

export function normalizeForemanCall(detail: string): FieldEvent {
  return createFieldEvent({
    projectId: "soma_drilled_shafts_001",
    source: "inbound_voice",
    provider: "controlled_demo",
    contact: {
      contactId: "crew_foreman_01",
      name: "Luis Martinez",
      role: "drilled_shaft_foreman",
      verified: true,
    },
    disclosureAccepted: true,
    confidence: 0.96,
    observation: {
      elementId: "DS-02",
      condition: "obstruction",
      depthFt: 34,
      alternateElement: "DS-03",
      workStopped: true,
      rawText: detail,
    },
  });
}

function taskForElement(elementId: string): string | null {
  if (elementId === "DS-02") return "DS08";
  if (elementId === "DS-03") return "DS09";
  return null;
}
