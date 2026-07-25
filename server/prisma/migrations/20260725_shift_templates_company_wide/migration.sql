-- Shift templates may be shared by every branch in their company.
-- Existing branch-scoped rows keep their branchId and timezone unchanged.
ALTER TABLE `ShiftTemplate`
    MODIFY `branchId` INTEGER NULL,
    MODIFY `timezone` VARCHAR(64) NULL;

-- Rollback (only after assigning every global template to a valid branch and
-- restoring its branch timezone):
-- ALTER TABLE `ShiftTemplate`
--     MODIFY `branchId` INTEGER NOT NULL,
--     MODIFY `timezone` VARCHAR(64) NOT NULL;
