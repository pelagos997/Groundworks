export type FieldEvent = {
  schema: "groundwork.field_event.v1";
  eventId: string;
  projectId: "soma_drilled_shafts_001";
  receivedAt: string;
  source: "inbound_voice";
  sourceProvider: "twilio_elevenlabs_demo";
  caller: {
    contactId: "crew_foreman_01";
    name: "Luis Martinez";
    role: "drilled_shaft_foreman";
    verified: true;
  };
  consent: {
    aiDisclosureAccepted: true;
    transcriptionAccepted: true;
  };
  observation: {
    taskId: "DS08";
    elementId: "DS-02";
    category: "obstruction";
    status: "work_stopped";
    detail: string;
    depthFt: 34;
    alternateElement: "DS-03";
  };
  readbackConfirmed: true;
  confidence: 0.96;
};

export function normalizeForemanCall(detail: string): FieldEvent {
  return {
    schema: "groundwork.field_event.v1",
    eventId: `field_${crypto.randomUUID().slice(0, 8)}`,
    projectId: "soma_drilled_shafts_001",
    receivedAt: new Date().toISOString(),
    source: "inbound_voice",
    sourceProvider: "twilio_elevenlabs_demo",
    caller: {
      contactId: "crew_foreman_01",
      name: "Luis Martinez",
      role: "drilled_shaft_foreman",
      verified: true,
    },
    consent: {
      aiDisclosureAccepted: true,
      transcriptionAccepted: true,
    },
    observation: {
      taskId: "DS08",
      elementId: "DS-02",
      category: "obstruction",
      status: "work_stopped",
      detail,
      depthFt: 34,
      alternateElement: "DS-03",
    },
    readbackConfirmed: true,
    confidence: 0.96,
  };
}
