CREATE TABLE `warren_push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `warren_users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `warren_push_subscriptions_endpoint_unique` ON `warren_push_subscriptions` (`endpoint`);--> statement-breakpoint
CREATE INDEX `warren_push_subscriptions_user` ON `warren_push_subscriptions` (`user_id`);