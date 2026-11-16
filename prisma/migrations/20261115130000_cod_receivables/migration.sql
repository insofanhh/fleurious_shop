-- AlterTable
ALTER TABLE `Order` ADD COLUMN `deliveredAt` DATETIME(3) NULL,
    ADD COLUMN `paidAt` DATETIME(3) NULL;

-- CreateTable
CREATE TABLE `CodReceivable` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(20) NOT NULL DEFAULT 'CUSTOMER',
    `state` VARCHAR(20) NOT NULL DEFAULT 'OPEN',
    `amount` INTEGER NOT NULL,
    `payerName` VARCHAR(100) NOT NULL,
    `payerPhone` VARCHAR(30) NOT NULL DEFAULT '',
    `ownerId` VARCHAR(191) NULL,
    `dueAt` DATETIME(3) NOT NULL,
    `nextReminderAt` DATETIME(3) NOT NULL,
    `lastContactAt` DATETIME(3) NULL,
    `note` VARCHAR(500) NOT NULL DEFAULT '',
    `settledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CodReceivable_orderId_key`(`orderId`),
    INDEX `CodReceivable_state_dueAt_idx`(`state`, `dueAt`),
    INDEX `CodReceivable_state_nextReminderAt_idx`(`state`, `nextReminderAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderReceipt` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `destination` VARCHAR(20) NOT NULL,
    `collectorId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `reference` VARCHAR(100) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `remittedAt` DATETIME(3) NULL,
    `remittanceReference` VARCHAR(100) NOT NULL DEFAULT '',

    UNIQUE INDEX `OrderReceipt_orderId_key`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CollectionEvent` (
    `id` VARCHAR(191) NOT NULL,
    `receivableId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `note` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `CollectionEvent_receivableId_createdAt_idx`(`receivableId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `CodReceivable` ADD CONSTRAINT `CodReceivable_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CodReceivable` ADD CONSTRAINT `CodReceivable_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderReceipt` ADD CONSTRAINT `OrderReceipt_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderReceipt` ADD CONSTRAINT `OrderReceipt_collectorId_fkey` FOREIGN KEY (`collectorId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CollectionEvent` ADD CONSTRAINT `CollectionEvent_receivableId_fkey` FOREIGN KEY (`receivableId`) REFERENCES `CodReceivable`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
