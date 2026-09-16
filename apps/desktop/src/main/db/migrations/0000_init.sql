CREATE TABLE `a2a_tasks` (
	`agent_id` text NOT NULL,
	`task_id` text NOT NULL,
	`context_id` text NOT NULL,
	`state` text,
	`task_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `task_id`)
);
--> statement-breakpoint
CREATE INDEX `a2a_tasks_context_idx` ON `a2a_tasks` (`agent_id`,`context_id`);--> statement-breakpoint
CREATE INDEX `a2a_tasks_state_idx` ON `a2a_tasks` (`state`);--> statement-breakpoint
CREATE TABLE `delegations` (
	`id` text PRIMARY KEY NOT NULL,
	`orchestrator_context_id` text NOT NULL,
	`persona_agent_id` text NOT NULL,
	`task_id` text,
	`context_id` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`request` text NOT NULL,
	`result` text,
	`timeout_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `delegations_orchestrator_idx` ON `delegations` (`orchestrator_context_id`);--> statement-breakpoint
CREATE INDEX `delegations_task_idx` ON `delegations` (`persona_agent_id`,`task_id`);--> statement-breakpoint
CREATE INDEX `delegations_state_idx` ON `delegations` (`state`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`context_id` text NOT NULL,
	`seq` integer NOT NULL,
	`item_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `messages_thread_seq_idx` ON `messages` (`agent_id`,`context_id`,`seq`);--> statement-breakpoint
CREATE INDEX `messages_created_idx` ON `messages` (`created_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`severity` text NOT NULL,
	`source` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`actions_json` text DEFAULT '[]' NOT NULL,
	`agent_id` text,
	`task_id` text,
	`read_at` integer,
	`handled_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notifications_created_idx` ON `notifications` (`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_pending_idx` ON `notifications` (`severity`,`handled_at`);--> statement-breakpoint
CREATE INDEX `notifications_task_idx` ON `notifications` (`agent_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `personas` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`config_json` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `provider_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `run_states` (
	`agent_id` text NOT NULL,
	`task_id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `task_id`)
);
--> statement-breakpoint
CREATE TABLE `secrets` (
	`ref` text PRIMARY KEY NOT NULL,
	`ciphertext` blob NOT NULL,
	`last4` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `threads` (
	`agent_id` text NOT NULL,
	`context_id` text NOT NULL,
	`source` text,
	`title` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `context_id`)
);
--> statement-breakpoint
CREATE INDEX `threads_recent_idx` ON `threads` (`agent_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `trace_spans` (
	`agent_id` text NOT NULL,
	`span_id` text NOT NULL,
	`trace_id` text NOT NULL,
	`parent_id` text,
	`span_type` text NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`data_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`agent_id`, `span_id`)
);
--> statement-breakpoint
CREATE INDEX `trace_spans_trace_idx` ON `trace_spans` (`trace_id`);--> statement-breakpoint
CREATE INDEX `trace_spans_created_idx` ON `trace_spans` (`created_at`);