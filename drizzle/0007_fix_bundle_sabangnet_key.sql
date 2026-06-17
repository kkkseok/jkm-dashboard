-- 묶음 내품 구성 키를 ★자체코드 → 사방넷코드(D)로 변경.
-- ★코드는 수량 변형 SKU(파로x3/x6/x12)끼리 충돌해 수량이 뭉개졌다(2026-06-17 버그).
-- Postgres RENAME COLUMN 은 동일 이름의 인덱스를 자동으로 새 컬럼에 재연결한다.
-- group_bundle_item 은 매 업로드마다 truncate 후 재적재되므로 데이터 마이그레이션은 불필요.
ALTER TABLE "group_bundle_item" RENAME COLUMN "bundle_self_code" TO "bundle_sabangnet_code";
