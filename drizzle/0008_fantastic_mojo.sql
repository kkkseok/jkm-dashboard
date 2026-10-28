CREATE TABLE "match_check" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pair_id" bigint NOT NULL,
	"run_id" bigint,
	"fetch_ok" boolean NOT NULL,
	"fetch_error" text,
	"cj_thumb_url" text,
	"gs_thumb_url" text,
	"cj_thumb_hash" text,
	"gs_thumb_hash" text,
	"cj_detail_hash" text,
	"gs_detail_hash" text,
	"cj_detail" jsonb,
	"gs_detail" jsonb,
	"judged" boolean DEFAULT false NOT NULL,
	"verdict" jsonb,
	"rules_version" text,
	"model" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_creation_tokens" integer,
	"cache_read_tokens" integer,
	"api_equiv_usd" numeric(12, 4),
	"judge_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_common_image" (
	"hash" text PRIMARY KEY NOT NULL,
	"occurrences" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_pair" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mat_code" text NOT NULL,
	"product_name" text NOT NULL,
	"cj_url" text NOT NULL,
	"gs_url" text NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"diff_summary" text,
	"last_checked_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_judged_at" timestamp with time zone,
	"resolved_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match_run" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"total" integer DEFAULT 0 NOT NULL,
	"fetched" integer DEFAULT 0 NOT NULL,
	"judged" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"deferred" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"api_equiv_usd" numeric(12, 4) DEFAULT '0' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "match_status_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"pair_id" bigint NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor" text NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "match_check" ADD CONSTRAINT "match_check_pair_id_match_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."match_pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_check" ADD CONSTRAINT "match_check_run_id_match_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."match_run"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_status_log" ADD CONSTRAINT "match_status_log_pair_id_match_pair_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."match_pair"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "match_check_pair_created_idx" ON "match_check" USING btree ("pair_id","created_at");--> statement-breakpoint
CREATE INDEX "match_check_run_idx" ON "match_check" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_pair_mat_code_uniq" ON "match_pair" USING btree ("mat_code");--> statement-breakpoint
CREATE INDEX "match_pair_status_idx" ON "match_pair" USING btree ("status");--> statement-breakpoint
CREATE INDEX "match_status_log_pair_idx" ON "match_status_log" USING btree ("pair_id","created_at");