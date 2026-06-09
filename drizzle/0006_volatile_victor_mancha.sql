CREATE TABLE "group_bundle_item" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"bundle_self_code" text NOT NULL,
	"seq" integer NOT NULL,
	"component_self_code" text NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_erp_code" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"self_code" text NOT NULL,
	"erp_code" text NOT NULL,
	"erp_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_market_map" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"market_code" text NOT NULL,
	"sabangnet_code" text NOT NULL,
	"self_code" text,
	"product_name" text NOT NULL,
	"is_composite" boolean NOT NULL,
	"quantity" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "group_bundle_item_bundle_seq_uniq" ON "group_bundle_item" USING btree ("bundle_self_code","seq");--> statement-breakpoint
CREATE INDEX "group_bundle_item_bundle_idx" ON "group_bundle_item" USING btree ("bundle_self_code");--> statement-breakpoint
CREATE UNIQUE INDEX "group_erp_code_self_code_uniq" ON "group_erp_code" USING btree ("self_code");--> statement-breakpoint
CREATE UNIQUE INDEX "group_market_map_market_code_uniq" ON "group_market_map" USING btree ("market_code");--> statement-breakpoint
CREATE INDEX "group_market_map_self_code_idx" ON "group_market_map" USING btree ("self_code");