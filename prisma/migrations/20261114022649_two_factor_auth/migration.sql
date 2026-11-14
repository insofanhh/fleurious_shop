-- AlterTable
ALTER TABLE `User` ADD COLUMN `recoveryHashes` JSON NULL,
    ADD COLUMN `totpEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `totpLastStep` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `totpPendingEncrypted` TEXT NULL,
    ADD COLUMN `totpPendingExpires` DATETIME(3) NULL,
    ADD COLUMN `totpSecretEncrypted` TEXT NULL;
