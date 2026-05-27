CREATE TABLE "product_channels" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "product_master_sabangnet_code_uniq";--> statement-breakpoint
CREATE UNIQUE INDEX "product_channels_name_uniq" ON "product_channels" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "product_master_sabangnet_channel_uniq" ON "product_master" USING btree ("sabangnet_code","channel_name");--> statement-breakpoint
CREATE INDEX "product_master_sabangnet_code_idx" ON "product_master" USING btree ("sabangnet_code");--> statement-breakpoint
INSERT INTO "product_channels" ("name", "display_order") VALUES
  ('GSshop', 1),
  ('롯데아이몰', 2),
  ('현대홈쇼핑', 3),
  ('CJ온스타일', 4),
  ('롯데온', 5),
  ('토스', 6),
  ('쇼핑엔티(25%)', 7),
  ('쇼핑엔티(15%)', 8),
  ('W쇼핑', 9),
  ('이지웰', 10),
  ('동원몰', 11),
  ('오늘의집', 12),
  ('띵샵', 13),
  ('캐시딜', 14),
  ('한미양행', 15),
  ('키즈노트', 16),
  ('제이슨딜', 17),
  ('코오롱(W스토어)', 18),
  ('농협몰', 19),
  ('무신사', 20),
  ('이랜드몰', 21),
  ('에이블리', 22),
  ('허닭', 23),
  ('LG임직원몰', 24);