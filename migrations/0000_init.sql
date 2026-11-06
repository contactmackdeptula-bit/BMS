CREATE TABLE `ai_call` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`building_id` text,
	`purpose` text NOT NULL,
	`model` text NOT NULL,
	`prompt_version` text NOT NULL,
	`input_tokens` integer NOT NULL,
	`output_tokens` integer NOT NULL,
	`cost_pence` integer NOT NULL,
	`ok` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text,
	`user_id` text,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`action` text NOT NULL,
	`summary` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_org_idx` ON `audit_event` (`org_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_token` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`email` text NOT NULL,
	`user_id` text,
	`org_id` text,
	`role` text,
	`building_id` text,
	`invited_by` text,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `building` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'church' NOT NULL,
	`listing` text,
	`diocese` text,
	`address` text,
	`postcode` text,
	`has_lift` integer DEFAULT false NOT NULL,
	`has_water_systems` integer DEFAULT false NOT NULL,
	`inspector_name` text,
	`insurer` text,
	`architect` text,
	`key_contacts` text DEFAULT '[]' NOT NULL,
	`fittings` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `building_org_idx` ON `building` (`org_id`);--> statement-breakpoint
CREATE TABLE `compliance_item` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`building_id` text NOT NULL,
	`name` text NOT NULL,
	`frequency_months` integer NOT NULL,
	`anchor` text DEFAULT 'none' NOT NULL,
	`done_by` text,
	`note` text,
	`next_due_override` text,
	`self_check` integer DEFAULT false NOT NULL,
	`fitting_kind` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `building`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `compliance_item_building_idx` ON `compliance_item` (`building_id`);--> statement-breakpoint
CREATE TABLE `compliance_occurrence` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`compliance_item_id` text NOT NULL,
	`done_on` text NOT NULL,
	`done_by_user_id` text,
	`done_by_text` text,
	`document_id` text,
	`checklist` text,
	`notes` text,
	`status` text DEFAULT 'complete' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`compliance_item_id`) REFERENCES `compliance_item`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `occurrence_item_idx` ON `compliance_occurrence` (`compliance_item_id`,`done_on`);--> statement-breakpoint
CREATE TABLE `contractor` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`trade` text,
	`contact_name` text,
	`phone` text,
	`email` text,
	`website` text,
	`accreditation` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organisation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contractor_org_idx` ON `contractor` (`org_id`);--> statement-breakpoint
CREATE TABLE `document` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`building_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`r2_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`document_date` text,
	`expires_on` text,
	`contractor_id` text,
	`amount_pence` integer,
	`uploaded_by` text NOT NULL,
	`extracted` text,
	`extraction_confirmed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `building`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `document_building_idx` ON `document` (`building_id`);--> statement-breakpoint
CREATE TABLE `estates_note` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`building_id` text NOT NULL,
	`body` text NOT NULL,
	`author_id` text NOT NULL,
	`shared_with_parish` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `building`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `estates_note_building_idx` ON `estates_note` (`building_id`);--> statement-breakpoint
CREATE TABLE `fabric_report` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`building_id` text NOT NULL,
	`year` integer NOT NULL,
	`inspection_date` text,
	`inspected_by` text,
	`accompanied_by` text,
	`condition_text` text,
	`matters` text DEFAULT '[]' NOT NULL,
	`terrier_confirmed` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`exported_document_ids` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `building`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fabric_report_year` ON `fabric_report` (`building_id`,`year`);--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`building_id` text NOT NULL,
	`title` text NOT NULL,
	`done_on` text,
	`contractor_id` text,
	`cost_pence` integer,
	`status` text DEFAULT 'done' NOT NULL,
	`task_id` text,
	`compliance_occurrence_id` text,
	`instructed_by_org_id` text,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `building`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_building_idx` ON `job` (`building_id`,`done_on`);--> statement-breakpoint
CREATE TABLE `job_document` (
	`job_id` text NOT NULL,
	`document_id` text NOT NULL,
	PRIMARY KEY(`job_id`, `document_id`),
	FOREIGN KEY (`job_id`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`document_id`) REFERENCES `document`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `logbook_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`building_id` text NOT NULL,
	`job_id` text,
	`entry_date` text NOT NULL,
	`work` text NOT NULL,
	`who` text,
	`cost_pence` integer,
	`permission_ref` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`approved_by` text,
	`approved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `building`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `logbook_building_idx` ON `logbook_entry` (`building_id`,`entry_date`);--> statement-breakpoint
CREATE TABLE `login_attempt` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`attempted_at` text NOT NULL,
	`ok` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `login_attempt_email_idx` ON `login_attempt` (`email`,`attempted_at`);--> statement-breakpoint
CREATE TABLE `membership` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`org_id` text NOT NULL,
	`role` text NOT NULL,
	`building_id` text,
	`receives_reminders` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`org_id`) REFERENCES `organisation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `membership_user_idx` ON `membership` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `membership_unique` ON `membership` (`user_id`,`org_id`,`role`,`building_id`);--> statement-breakpoint
CREATE TABLE `organisation` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`parent_id` text,
	`apcm_date` text,
	`timezone` text DEFAULT 'Europe/London' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `organisation_parent_idx` ON `organisation` (`parent_id`);--> statement-breakpoint
CREATE TABLE `programme` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`window_start` text,
	`window_end` text,
	`building_ids` text DEFAULT '[]' NOT NULL,
	`estimate_low_pence` integer,
	`estimate_high_pence` integer,
	`status` text DEFAULT 'suggested' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `qi_report` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`building_id` text NOT NULL,
	`document_id` text NOT NULL,
	`inspected_on` text,
	`inspector_name` text,
	`page_count` integer,
	`next_due_on` text,
	`status` text DEFAULT 'reading' NOT NULL,
	`raw_extraction` text,
	`model_version` text,
	`prompt_version` text,
	`read_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `building`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `qi_report_building_idx` ON `qi_report` (`building_id`);--> statement-breakpoint
CREATE TABLE `reminder_log` (
	`id` text PRIMARY KEY NOT NULL,
	`building_id` text NOT NULL,
	`sent_on` text NOT NULL,
	`recipients` text NOT NULL,
	`item_ids` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reminder_once_per_day` ON `reminder_log` (`building_id`,`sent_on`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` text NOT NULL,
	`last_seen_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `task` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`building_id` text NOT NULL,
	`qi_report_id` text NOT NULL,
	`ref` text NOT NULL,
	`text` text NOT NULL,
	`original_text` text NOT NULL,
	`location` text,
	`trade` text,
	`band` text NOT NULL,
	`estimate_low_pence` integer,
	`estimate_high_pence` integer,
	`page_number` integer,
	`permission` text DEFAULT 'tbc' NOT NULL,
	`confidence` text,
	`status` text DEFAULT 'not_started' NOT NULL,
	`waiting_on_task_id` text,
	`job_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`building_id`) REFERENCES `building`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`qi_report_id`) REFERENCES `qi_report`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_building_idx` ON `task` (`building_id`,`band`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`phone` text,
	`password_hash` text,
	`password_changed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);