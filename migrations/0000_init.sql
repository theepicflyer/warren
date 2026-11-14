CREATE TABLE `warren_changes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`turn_id` integer NOT NULL,
	`table_name` text NOT NULL,
	`action` text NOT NULL,
	`row_id` integer NOT NULL,
	`before` text,
	`after` text,
	FOREIGN KEY (`turn_id`) REFERENCES `warren_turns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `warren_changes_turn` ON `warren_changes` (`turn_id`);--> statement-breakpoint
CREATE TABLE `warren_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`path` text NOT NULL,
	`media_type` text NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `warren_files_user` ON `warren_files` (`user_id`);--> statement-breakpoint
CREATE TABLE `warren_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `warren_threads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`scope` text NOT NULL,
	`model` text NOT NULL,
	`state` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `warren_threads_user_scope` ON `warren_threads` (`user_id`,`scope`);--> statement-breakpoint
CREATE TABLE `warren_turns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`thread_id` integer NOT NULL,
	`user_text` text DEFAULT '' NOT NULL,
	`reply_text` text DEFAULT '' NOT NULL,
	`messages` text DEFAULT '[]' NOT NULL,
	`usage` text DEFAULT '{}' NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`error` text,
	`app_version` text,
	`undone_at` integer,
	`rating` integer,
	`rating_note` text,
	`rated_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `warren_threads`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `warren_turns_thread` ON `warren_turns` (`thread_id`);--> statement-breakpoint
CREATE TABLE `warren_users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`oidc_sub` text NOT NULL,
	`email` text,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warren_users_oidc_sub_unique` ON `warren_users` (`oidc_sub`);