CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`video_id` text NOT NULL,
	`reporter_id` text NOT NULL,
	`reason` text NOT NULL,
	`details` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`video_id`) REFERENCES `videos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "reports_reason_check" CHECK("reports"."reason" in ('copyright', 'sexual', 'violence', 'harassment', 'illegal', 'spam', 'other')),
	CONSTRAINT "reports_status_check" CHECK("reports"."status" in ('open', 'actioned', 'dismissed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_video_reporter_idx` ON `reports` (`video_id`,`reporter_id`);--> statement-breakpoint
CREATE INDEX `reports_status_idx` ON `reports` (`status`,"created_at" desc,"id" desc);--> statement-breakpoint
ALTER TABLE `videos` ADD `taken_down_at` integer;