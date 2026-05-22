CREATE TABLE "cal_amount" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "cal_amount_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"product_code" text NOT NULL,
	"product_name" text,
	"extra_settlement" integer NOT NULL,
	"memo" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "cal_amount_product_code_uniq" ON "cal_amount" USING btree ("product_code");