-- AlterTable
ALTER TABLE `Order` ADD COLUMN `dailyPlanId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Payment` ADD COLUMN `dailyInvoiceId` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `DailyOffering` (
    `id` VARCHAR(191) NOT NULL,
    `variantId` VARCHAR(191) NOT NULL,
    `budgetCode` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `tags` JSON NOT NULL,
    `premium` INTEGER NOT NULL DEFAULT 0,
    `cost` INTEGER NOT NULL DEFAULT 0,
    `capacity` INTEGER NOT NULL DEFAULT 10,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DailyOffering_variantId_budgetCode_key`(`variantId`, `budgetCode`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyPlan` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `buyerName` VARCHAR(191) NOT NULL,
    `buyerEmail` VARCHAR(191) NOT NULL,
    `recipientName` VARCHAR(191) NOT NULL,
    `recipientPhone` VARCHAR(191) NOT NULL,
    `senderName` VARCHAR(191) NOT NULL,
    `address` VARCHAR(800) NOT NULL,
    `shippingSnapshot` JSON NOT NULL,
    `policy` JSON NOT NULL,
    `budgetCode` VARCHAR(191) NOT NULL,
    `selectionMode` VARCHAR(191) NOT NULL,
    `preferences` JSON NOT NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'PENDING_PAYMENT',
    `total` INTEGER NOT NULL,
    `subsidy` INTEGER NOT NULL DEFAULT 0,
    `version` INTEGER NOT NULL DEFAULT 1,
    `expiresAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DailyPlan_code_key`(`code`),
    UNIQUE INDEX `DailyPlan_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DailyPlan_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `DailyPlan_state_expiresAt_idx`(`state`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyDelivery` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `slotId` VARCHAR(191) NOT NULL,
    `slotLabel` VARCHAR(191) NOT NULL,
    `startHour` INTEGER NOT NULL,
    `endHour` INTEGER NOT NULL,
    `lockAt` DATETIME(3) NOT NULL,
    `offeringId` VARCHAR(191) NULL,
    `approved` BOOLEAN NOT NULL DEFAULT false,
    `selectionSnapshot` JSON NULL,
    `message` TEXT NOT NULL,
    `writingMode` VARCHAR(191) NOT NULL DEFAULT 'AUTO',
    `base` INTEGER NOT NULL,
    `discount` INTEGER NOT NULL,
    `premium` INTEGER NOT NULL DEFAULT 0,
    `shippingGross` INTEGER NOT NULL,
    `subsidy` INTEGER NOT NULL,
    `total` INTEGER NOT NULL,
    `refunded` INTEGER NOT NULL DEFAULT 0,
    `refundPending` INTEGER NOT NULL DEFAULT 0,
    `state` VARCHAR(191) NOT NULL DEFAULT 'SCHEDULED',
    `reservation` VARCHAR(191) NOT NULL DEFAULT 'HELD',
    `orderId` VARCHAR(191) NULL,
    `issue` VARCHAR(500) NOT NULL DEFAULT '',
    `version` INTEGER NOT NULL DEFAULT 1,

    UNIQUE INDEX `DailyDelivery_orderId_key`(`orderId`),
    INDEX `DailyDelivery_day_slotId_reservation_idx`(`day`, `slotId`, `reservation`),
    INDEX `DailyDelivery_day_offeringId_reservation_idx`(`day`, `offeringId`, `reservation`),
    INDEX `DailyDelivery_state_lockAt_idx`(`state`, `lockAt`),
    UNIQUE INDEX `DailyDelivery_planId_day_key`(`planId`, `day`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `kind` VARCHAR(191) NOT NULL DEFAULT 'PURCHASE',
    `state` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `amount` INTEGER NOT NULL,
    `allocation` JSON NOT NULL,
    `change` JSON NULL,
    `idempotencyKey` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `paidAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DailyInvoice_code_key`(`code`),
    UNIQUE INDEX `DailyInvoice_idempotencyKey_key`(`idempotencyKey`),
    INDEX `DailyInvoice_state_expiresAt_idx`(`state`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyRefund` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `allocation` JSON NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `state` VARCHAR(191) NOT NULL DEFAULT 'PENDING',
    `reference` VARCHAR(191) NOT NULL DEFAULT '',
    `actorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `DailyRefund_state_createdAt_idx`(`state`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DailyHistory` (
    `id` VARCHAR(191) NOT NULL,
    `planId` VARCHAR(191) NOT NULL,
    `actorId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `detail` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DailyHistory_planId_createdAt_idx`(`planId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_dailyInvoiceId_fkey` FOREIGN KEY (`dailyInvoiceId`) REFERENCES `DailyInvoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyDelivery` ADD CONSTRAINT `DailyDelivery_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `DailyPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyDelivery` ADD CONSTRAINT `DailyDelivery_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyInvoice` ADD CONSTRAINT `DailyInvoice_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `DailyPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyRefund` ADD CONSTRAINT `DailyRefund_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `DailyPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `DailyHistory` ADD CONSTRAINT `DailyHistory_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `DailyPlan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
