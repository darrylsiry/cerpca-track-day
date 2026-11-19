CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
DROP INDEX "reminder_once";--> statement-breakpoint
ALTER TABLE "reminder_sends" ADD COLUMN "day" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "moved_from_day" text;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "moved_from_min" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_once" ON "reminder_sends" USING btree ("schedule_item_id","offset_min","day","start_min");