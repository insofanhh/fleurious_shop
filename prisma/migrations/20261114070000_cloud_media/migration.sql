CREATE TABLE `MediaAsset` (
  `id` VARCHAR(41) NOT NULL,
  `data` MEDIUMBLOB NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE INDEX `Outbox_createdAt_idx` ON `Outbox`(`createdAt`);
