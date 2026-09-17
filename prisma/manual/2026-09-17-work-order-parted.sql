-- Work orders can close as parted out: the machine is stripped for parts and
-- retired. v2-only enum (work_orders). ADD VALUE cannot run inside a
-- transaction block, so this file has no BEGIN/COMMIT.
ALTER TYPE "WorkOrderStatus" ADD VALUE 'CLOSED_PARTED';
