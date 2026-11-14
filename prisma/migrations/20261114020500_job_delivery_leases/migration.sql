ALTER TABLE `Notification` ADD COLUMN `dedupKey` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Notification_dedupKey_key` ON `Notification`(`dedupKey`);
ALTER TABLE `Outbox` ADD COLUMN `leasedUntil` DATETIME(3) NULL;
