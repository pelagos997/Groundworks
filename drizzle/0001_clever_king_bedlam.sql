CREATE TABLE `procurement_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`conversation_id` text,
	`requested_by_contact_id` text NOT NULL,
	`source_webhook_id` text NOT NULL,
	`change_order_ref` text,
	`material` text NOT NULL,
	`section` text NOT NULL,
	`quantity` integer NOT NULL,
	`piece_length_ft` integer NOT NULL,
	`total_length_ft` integer NOT NULL,
	`total_weight_lbs` integer NOT NULL,
	`grade` text NOT NULL,
	`domestic_requirement` text NOT NULL,
	`mtr_required` integer DEFAULT true NOT NULL,
	`coating` text DEFAULT 'bare' NOT NULL,
	`delivery_address` text NOT NULL,
	`required_on_site_at` text NOT NULL,
	`unload_notes` text,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `procurement_requests_source_webhook_id_unique` ON `procurement_requests` (`source_webhook_id`);--> statement-breakpoint
CREATE INDEX `procurement_project_idx` ON `procurement_requests` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `procurement_status_idx` ON `procurement_requests` (`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`request_id` text NOT NULL,
	`quote_id` text NOT NULL,
	`po_number` text NOT NULL,
	`approved_by_contact_id` text NOT NULL,
	`approved_at` text NOT NULL,
	`approval_limit_cents` integer NOT NULL,
	`delivered_total_cents` integer NOT NULL,
	`delivery_address` text NOT NULL,
	`status` text DEFAULT 'approved' NOT NULL,
	`release_channel` text,
	`external_reference` text,
	`released_at` text,
	`vendor_acknowledged_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_orders_po_number_unique` ON `purchase_orders` (`po_number`);--> statement-breakpoint
CREATE INDEX `po_request_idx` ON `purchase_orders` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `po_status_idx` ON `purchase_orders` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `vendor_quotes` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`request_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`vendor_name` text NOT NULL,
	`vendor_email` text NOT NULL,
	`vendor_phone` text NOT NULL,
	`vendor_quote_ref` text NOT NULL,
	`material_cents` integer,
	`freight_cents` integer,
	`tax_cents` integer,
	`delivered_total_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`earliest_delivery_at` text NOT NULL,
	`valid_until` text NOT NULL,
	`grade` text NOT NULL,
	`domestic_compliance` text NOT NULL,
	`mtr_included` integer NOT NULL,
	`written_quote_received` integer NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'qualified' NOT NULL,
	`raw_json` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `quotes_request_idx` ON `vendor_quotes` (`request_id`,`delivered_total_cents`);--> statement-breakpoint
CREATE INDEX `quotes_vendor_ref_idx` ON `vendor_quotes` (`vendor_id`,`vendor_quote_ref`);--> statement-breakpoint
CREATE TABLE `vendor_rfq_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`request_id` text NOT NULL,
	`vendor_id` text NOT NULL,
	`vendor_name` text NOT NULL,
	`vendor_phone` text NOT NULL,
	`provider` text NOT NULL,
	`capability_id` text,
	`run_id` text,
	`external_call_id` text,
	`status` text NOT NULL,
	`max_pay_micros` integer NOT NULL,
	`paid_micros` integer,
	`transcript` text,
	`response_json` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rfq_request_idx` ON `vendor_rfq_calls` (`request_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `rfq_external_call_idx` ON `vendor_rfq_calls` (`external_call_id`);--> statement-breakpoint
ALTER TABLE `contact_conversations` ADD `pending_procurement_json` text;