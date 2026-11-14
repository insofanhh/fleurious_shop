-- AlterTable
ALTER TABLE `Payment` ADD COLUMN `identityHash` VARCHAR(64) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Payment_identityHash_key` ON `Payment`(`identityHash`);
