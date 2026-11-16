CREATE TABLE "announcements" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"audience" jsonb NOT NULL,
	"channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"urgent" boolean DEFAULT false NOT NULL,
	"author_id" text,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "driver_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"author_id" text NOT NULL,
	"event_id" text,
	"category" text DEFAULT 'general' NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"track_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"description" text,
	"registration_url" text,
	"schedule_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"occurred_on" text NOT NULL,
	"occurred_time" text,
	"location" text,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"has_injury" boolean DEFAULT false NOT NULL,
	"driver_user_id" text,
	"driver_name" text,
	"summary" text,
	"data" jsonb NOT NULL,
	"sketch" text,
	"due_on" text NOT NULL,
	"sent_at" timestamp with time zone,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "instructor_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"instructor_id" text NOT NULL,
	"student_id" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"is_admin" boolean DEFAULT false NOT NULL,
	"is_instructor" boolean DEFAULT false NOT NULL,
	"admin_title" text,
	"instructor_credential" text,
	"run_group_id" text,
	"solo_approved" boolean DEFAULT false NOT NULL,
	"experience" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"event_id" text,
	"channel" text NOT NULL,
	"to_address" text NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"status" text NOT NULL,
	"provider" text,
	"error" text,
	"kind" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"event_id" text,
	"announcement_id" text,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"href" text,
	"urgent" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"website" text,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"settings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text,
	"user_id" text NOT NULL,
	"kind" text DEFAULT 'group' NOT NULL,
	"from_group_id" text,
	"to_group_id" text,
	"recommended_by_id" text,
	"rationale" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"decided_by_id" text,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"run_group_id" text NOT NULL,
	"vehicle_id" text,
	"car_number" text,
	"attends_day1" boolean DEFAULT true NOT NULL,
	"attends_day2" boolean DEFAULT true NOT NULL,
	"is_instructor" boolean DEFAULT false NOT NULL,
	"solo" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"tshirt_size" text,
	"checked_in_at" timestamp with time zone,
	"source" text DEFAULT 'manual' NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder_sends" (
	"id" text PRIMARY KEY NOT NULL,
	"schedule_item_id" text NOT NULL,
	"offset_min" integer NOT NULL,
	"start_min" integer NOT NULL,
	"recipients" integer DEFAULT 0 NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "run_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"text_color" text NOT NULL,
	"sort_order" integer NOT NULL,
	"summary" text NOT NULL,
	"description" text NOT NULL,
	"instructor_policy" text DEFAULT 'none' NOT NULL,
	"passing_key" text,
	"is_instructor_group" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule_items" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"day" text NOT NULL,
	"start_min" integer NOT NULL,
	"end_min" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"audience" text DEFAULT 'groups' NOT NULL,
	"group_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"note" text,
	"cancelled" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"instructor_id" text NOT NULL,
	"student_id" text NOT NULL,
	"schedule_item_id" text,
	"day" text NOT NULL,
	"label" text NOT NULL,
	"shared_notes" text DEFAULT '' NOT NULL,
	"private_notes" text,
	"focus_areas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"contact_name" text,
	"email" text,
	"phone" text,
	"city" text,
	"verified" boolean DEFAULT false NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tech_inspections" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"method" text DEFAULT 'online' NOT NULL,
	"vehicle_year" integer,
	"vehicle_make" text,
	"vehicle_model" text,
	"vehicle_color" text,
	"car_number" text,
	"driver2_name" text,
	"emergency1" text,
	"emergency2" text,
	"form" jsonb NOT NULL,
	"inspection_date" text,
	"paper_file" text,
	"shop_id" text,
	"shop_name" text,
	"shop_email" text,
	"shop_phone" text,
	"mechanic_name" text,
	"mechanic_token_hash" text,
	"mechanic_token_expires" timestamp with time zone,
	"mechanic_invited_at" timestamp with time zone,
	"mechanic_signed_at" timestamp with time zone,
	"mechanic_signature" text,
	"mechanic_ip" text,
	"mechanic_user_agent" text,
	"seal_hash" text,
	"driver_signed_name" text,
	"driver_signature" text,
	"driver_signed_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"reviewed_by_id" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"grid_tech" jsonb,
	"grid_tech_by_id" text,
	"grid_tech_at" timestamp with time zone,
	"sticker_issued_at" timestamp with time zone,
	"sticker_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracks" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"length_miles" real,
	"turn_count" integer,
	"timezone" text DEFAULT 'America/New_York' NOT NULL,
	"guide" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"phone" text,
	"address1" text,
	"city" text,
	"state" text,
	"zip" text,
	"emergency_name" text,
	"emergency_phone" text,
	"pca_member_number" text,
	"tshirt_size" text,
	"notify_email" boolean DEFAULT true NOT NULL,
	"notify_sms" boolean DEFAULT false NOT NULL,
	"notify_push" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"year" integer,
	"make" text NOT NULL,
	"model" text NOT NULL,
	"color" text,
	"car_number" text,
	"is_primary" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waiver_signatures" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"template_version" integer NOT NULL,
	"event_id" text NOT NULL,
	"user_id" text NOT NULL,
	"signed_name" text NOT NULL,
	"signature_data" text,
	"body_hash" text,
	"ip" text,
	"user_agent" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waiver_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_notes" ADD CONSTRAINT "driver_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_notes" ADD CONSTRAINT "driver_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_notes" ADD CONSTRAINT "driver_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_assignments" ADD CONSTRAINT "instructor_assignments_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_assignments" ADD CONSTRAINT "instructor_assignments_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instructor_assignments" ADD CONSTRAINT "instructor_assignments_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_recommended_by_id_users_id_fk" FOREIGN KEY ("recommended_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_run_group_id_run_groups_id_fk" FOREIGN KEY ("run_group_id") REFERENCES "public"."run_groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_groups" ADD CONSTRAINT "run_groups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_items" ADD CONSTRAINT "schedule_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_instructor_id_users_id_fk" FOREIGN KEY ("instructor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_logs" ADD CONSTRAINT "session_logs_student_id_users_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_inspections" ADD CONSTRAINT "tech_inspections_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_inspections" ADD CONSTRAINT "tech_inspections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_template_id_waiver_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."waiver_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_signatures" ADD CONSTRAINT "waiver_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waiver_templates" ADD CONSTRAINT "waiver_templates_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_event" ON "announcements" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "driver_notes_user" ON "driver_notes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_org_slug" ON "events" USING btree ("org_id","slug");--> statement-breakpoint
CREATE INDEX "incidents_event" ON "incidents" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_event_student" ON "instructor_assignments" USING btree ("event_id","student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user" ON "memberships" USING btree ("org_id","user_id");--> statement-breakpoint
CREATE INDEX "message_log_created" ON "message_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_user" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_email" ON "otp_codes" USING btree ("email");--> statement-breakpoint
CREATE INDEX "promotions_user" ON "promotions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "registrations_event_user" ON "registrations" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "registrations_event" ON "registrations" USING btree ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminder_once" ON "reminder_sends" USING btree ("schedule_item_id","offset_min","start_min");--> statement-breakpoint
CREATE UNIQUE INDEX "run_groups_org_key" ON "run_groups" USING btree ("org_id","key");--> statement-breakpoint
CREATE INDEX "schedule_event_day" ON "schedule_items" USING btree ("event_id","day");--> statement-breakpoint
CREATE INDEX "session_logs_student" ON "session_logs" USING btree ("student_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tech_event_user" ON "tech_inspections" USING btree ("event_id","user_id");--> statement-breakpoint
CREATE INDEX "vehicles_user" ON "vehicles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "waiver_once" ON "waiver_signatures" USING btree ("template_id","event_id","user_id");