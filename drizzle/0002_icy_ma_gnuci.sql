DROP INDEX "cal_amount_product_code_uniq";--> statement-breakpoint
CREATE INDEX "cal_amount_product_code_idx" ON "cal_amount" USING btree ("product_code");