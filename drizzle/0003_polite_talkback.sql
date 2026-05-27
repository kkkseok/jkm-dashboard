CREATE TABLE "product_master" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"product_code" text NOT NULL,
	"channel_name" text NOT NULL,
	"brand_name" text NOT NULL,
	"product_name" text NOT NULL,
	"is_composite" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "product_master_product_code_uniq" ON "product_master" USING btree ("product_code");--> statement-breakpoint
CREATE INDEX "product_master_channel_name_idx" ON "product_master" USING btree ("channel_name");