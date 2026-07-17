import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: text("id").primaryKey(),
  provider: text("provider").notNull(),
  eventType: text("event_type").notNull(),
  channel: text("channel").notNull(),
  caller: text("caller"),
  status: text("status").notNull(),
  payloadHash: text("payload_hash").notNull(),
  payloadJson: text("payload_json").notNull(),
  responseJson: text("response_json"),
  receivedAt: text("received_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("webhook_received_idx").on(table.receivedAt),
  index("webhook_caller_idx").on(table.caller),
]);

export const contactConversations = sqliteTable("contact_conversations", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull().unique(),
  caller: text("caller").notNull(),
  state: text("state").notNull().default("collecting"),
  pendingObservationJson: text("pending_observation_json"),
  disclosureAccepted: integer("disclosure_accepted", { mode: "boolean" }).notNull().default(false),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("conversation_project_idx").on(table.projectId, table.updatedAt),
  index("conversation_caller_idx").on(table.caller),
]);

export const fieldEvents = sqliteTable("field_events", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  provider: text("provider").notNull(),
  providerEventId: text("provider_event_id").notNull().unique(),
  conversationId: text("conversation_id"),
  caller: text("caller").notNull(),
  eventType: text("event_type").notNull(),
  elementId: text("element_id"),
  depthFt: integer("depth_ft"),
  condition: text("condition"),
  alternateElement: text("alternate_element"),
  transcript: text("transcript").notNull(),
  confidence: integer("confidence_basis_points").notNull().default(10000),
  confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
  nexlaStatus: text("nexla_status").notNull().default("pending"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("field_events_project_idx").on(table.projectId, table.createdAt),
  index("field_events_element_idx").on(table.elementId),
]);

export const fieldMedia = sqliteTable("field_media", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  fieldEventId: text("field_event_id"),
  conversationId: text("conversation_id"),
  caller: text("caller").notNull(),
  elementId: text("element_id"),
  caption: text("caption"),
  storageKey: text("storage_key").notNull().unique(),
  sourceUrlHash: text("source_url_hash").notNull(),
  contentType: text("content_type").notNull(),
  bytes: integer("bytes").notNull(),
  status: text("status").notNull().default("stored_private"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("field_media_project_idx").on(table.projectId, table.createdAt),
  index("field_media_event_idx").on(table.fieldEventId),
]);

export const approvedReplans = sqliteTable("approved_replans", {
  commitId: text("commit_id").primaryKey(),
  projectId: text("project_id").notNull(),
  event: text("event").notNull(),
  approvedBy: text("approved_by").notNull(),
  approvedAt: text("approved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  expiresAt: text("expires_at").notNull(),
});

export const scheduleCandidates = sqliteTable("schedule_candidates", {
  commitId: text("commit_id").primaryKey(),
  projectId: text("project_id").notNull(),
  triggerEventId: text("trigger_event_id").notNull(),
  event: text("event").notNull(),
  resultJson: text("result_json").notNull(),
  status: text("status").notNull().default("proposed"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("schedule_candidate_project_idx").on(table.projectId, table.createdAt),
  index("schedule_candidate_event_idx").on(table.triggerEventId),
]);

export const policyDecisions = sqliteTable("policy_decisions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  subject: text("subject").notNull(),
  action: text("action").notNull(),
  decision: text("decision").notNull(),
  reasonsJson: text("reasons_json").notNull(),
  policyVersion: text("policy_version").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("policy_project_idx").on(table.projectId, table.createdAt)]);

export const actionReceipts = sqliteTable("action_receipts", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  commitId: text("commit_id").notNull(),
  recipientId: text("recipient_id").notNull(),
  action: text("action").notNull(),
  provider: text("provider").notNull(),
  capabilityId: text("capability_id"),
  runId: text("run_id"),
  externalId: text("external_id"),
  maxPayMicros: integer("max_pay_micros").notNull(),
  paidMicros: integer("paid_micros"),
  outcome: text("outcome").notNull(),
  responseJson: text("response_json"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("action_receipts_project_idx").on(table.projectId, table.createdAt),
  index("action_receipts_commit_idx").on(table.commitId),
]);
