ALTER TABLE "relations" ADD COLUMN "archived_at" timestamptz;
ALTER TABLE "relations" ADD COLUMN "deleted_at" timestamptz;
ALTER TABLE "relations" ADD COLUMN "purge_after" timestamptz;
ALTER TABLE "operation_receipts" DROP CONSTRAINT "operation_receipts_entity_type_check";
ALTER TABLE "operation_receipts" ADD CONSTRAINT "operation_receipts_entity_type_check" CHECK ("entity_type" IN ('resource','project','folder','diagram','relation'));
