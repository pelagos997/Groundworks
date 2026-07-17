CREATE TABLE `action_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`commit_id` text NOT NULL,
	`recipient_id` text NOT NULL,
	`action` text NOT NULL,
	`provider` text NOT NULL,
	`capability_id` text,
	`run_id` text,
	`external_id` text,
	`max_pay_micros` integer NOT NULL,
	`paid_micros` integer,
	`outcome` text NOT NULL,
	`response_json` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `action_receipts_project_idx` ON `action_receipts` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `action_receipts_commit_idx` ON `action_receipts` (`commit_id`);--> statement-breakpoint
CREATE TABLE `approved_replans` (
	`commit_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`event` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `contact_conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`caller` text NOT NULL,
	`state` text DEFAULT 'collecting' NOT NULL,
	`pending_observation_json` text,
	`disclosure_accepted` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_conversations_external_id_unique` ON `contact_conversations` (`external_id`);--> statement-breakpoint
CREATE INDEX `conversation_project_idx` ON `contact_conversations` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `conversation_caller_idx` ON `contact_conversations` (`caller`);--> statement-breakpoint
CREATE TABLE `field_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`conversation_id` text,
	`caller` text NOT NULL,
	`event_type` text NOT NULL,
	`element_id` text,
	`depth_ft` integer,
	`condition` text,
	`alternate_element` text,
	`transcript` text NOT NULL,
	`confidence_basis_points` integer DEFAULT 10000 NOT NULL,
	`confirmed` integer DEFAULT false NOT NULL,
	`nexla_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_events_provider_event_id_unique` ON `field_events` (`provider_event_id`);--> statement-breakpoint
CREATE INDEX `field_events_project_idx` ON `field_events` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `field_events_element_idx` ON `field_events` (`element_id`);--> statement-breakpoint
CREATE TABLE `field_media` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`field_event_id` text,
	`conversation_id` text,
	`caller` text NOT NULL,
	`element_id` text,
	`caption` text,
	`storage_key` text NOT NULL,
	`source_url_hash` text NOT NULL,
	`content_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`status` text DEFAULT 'stored_private' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_media_storage_key_unique` ON `field_media` (`storage_key`);--> statement-breakpoint
CREATE INDEX `field_media_project_idx` ON `field_media` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `field_media_event_idx` ON `field_media` (`field_event_id`);--> statement-breakpoint
CREATE TABLE `policy_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`subject` text NOT NULL,
	`action` text NOT NULL,
	`decision` text NOT NULL,
	`reasons_json` text NOT NULL,
	`policy_version` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `policy_project_idx` ON `policy_decisions` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `schedule_candidates` (
	`commit_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`trigger_event_id` text NOT NULL,
	`event` text NOT NULL,
	`result_json` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `schedule_candidate_project_idx` ON `schedule_candidates` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `schedule_candidate_event_idx` ON `schedule_candidates` (`trigger_event_id`);--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`event_type` text NOT NULL,
	`channel` text NOT NULL,
	`caller` text,
	`status` text NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`response_json` text,
	`received_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `webhook_received_idx` ON `webhook_deliveries` (`received_at`);--> statement-breakpoint
CREATE INDEX `webhook_caller_idx` ON `webhook_deliveries` (`caller`);