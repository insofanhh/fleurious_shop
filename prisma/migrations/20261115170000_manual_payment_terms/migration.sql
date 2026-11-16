-- AlterTable
ALTER TABLE `Order` ADD COLUMN `manualPayment` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `paymentDueAt` DATETIME(3) NULL;
