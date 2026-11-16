ALTER TABLE "registrations" ADD COLUMN "instructor_request" text;--> statement-breakpoint
ALTER TABLE "registrations" ADD COLUMN "instructor_request_note" text;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD COLUMN "group_parts" jsonb DEFAULT '{}'::jsonb NOT NULL;