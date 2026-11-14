-- AlterTable
ALTER TABLE `MemberPeriod` ADD COLUMN `tierLimits` JSON NULL;

-- AlterTable
ALTER TABLE `Payment` ADD COLUMN `membershipInvoiceId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Refund` ADD COLUMN `merchandiseAmount` INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `User` ADD COLUMN `birthDate` VARCHAR(10) NULL,
    ADD COLUMN `membershipMigrated` BOOLEAN NOT NULL DEFAULT true;

-- Existing ranks must be preserved as legacy grants, never guessed to be purchases.
UPDATE `User` SET `membershipMigrated` = false;

-- CreateTable
CREATE TABLE `MembershipTier` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `rank` INTEGER NOT NULL,
    `description` VARCHAR(400) NOT NULL,
    `color` VARCHAR(7) NOT NULL DEFAULT '#6e1423',
    `active` BOOLEAN NOT NULL DEFAULT true,
    `monthlyEnabled` BOOLEAN NOT NULL DEFAULT false,
    `yearlyEnabled` BOOLEAN NOT NULL DEFAULT false,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MembershipTier_code_key`(`code`),
    UNIQUE INDEX `MembershipTier_rank_key`(`rank`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MembershipTierVersion` (
    `id` VARCHAR(191) NOT NULL,
    `tierId` VARCHAR(191) NOT NULL,
    `number` INTEGER NOT NULL,
    `quota` INTEGER NOT NULL,
    `percent` INTEGER NOT NULL,
    `cap` INTEGER NOT NULL,
    `minimum` INTEGER NOT NULL DEFAULT 0,
    `monthlyPrice` INTEGER NOT NULL,
    `yearlyPrice` INTEGER NOT NULL,
    `spendThreshold` INTEGER NOT NULL,
    `birthdayPercent` INTEGER NOT NULL DEFAULT 0,
    `birthdayCap` INTEGER NOT NULL DEFAULT 0,
    `birthdayMinimum` INTEGER NOT NULL DEFAULT 0,
    `birthdayDays` INTEGER NOT NULL DEFAULT 30,
    `terms` VARCHAR(191) NOT NULL DEFAULT 'membership-v2',
    `publishedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MembershipTierVersion_tierId_number_key`(`tierId`, `number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MembershipEntitlement` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tierVersionId` VARCHAR(191) NOT NULL,
    `source` VARCHAR(20) NOT NULL,
    `sourceKey` VARCHAR(180) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `revokedAt` DATETIME(3) NULL,
    `anchorAt` DATETIME(3) NULL,
    `months` INTEGER NOT NULL DEFAULT 0,
    `prepaidValue` INTEGER NOT NULL DEFAULT 0,
    `spendRequired` INTEGER NOT NULL DEFAULT 0,
    `reason` VARCHAR(400) NOT NULL,
    `actorId` VARCHAR(191) NULL,
    `invoiceId` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MembershipEntitlement_sourceKey_key`(`sourceKey`),
    UNIQUE INDEX `MembershipEntitlement_invoiceId_key`(`invoiceId`),
    INDEX `MembershipEntitlement_userId_revokedAt_startsAt_endsAt_idx`(`userId`, `revokedAt`, `startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MembershipInvoice` (
    `id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(20) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tierVersionId` VARCHAR(191) NOT NULL,
    `idempotencyKey` VARCHAR(100) NOT NULL,
    `cycle` VARCHAR(10) NOT NULL,
    `kind` VARCHAR(20) NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    `amount` INTEGER NOT NULL,
    `gross` INTEGER NOT NULL,
    `credit` INTEGER NOT NULL DEFAULT 0,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `anchorAt` DATETIME(3) NOT NULL,
    `baseEntitlementId` VARCHAR(191) NULL,
    `fingerprint` VARCHAR(64) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `activatedAt` DATETIME(3) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `reason` VARCHAR(400) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `MembershipInvoice_code_key`(`code`),
    UNIQUE INDEX `MembershipInvoice_idempotencyKey_key`(`idempotencyKey`),
    INDEX `MembershipInvoice_userId_createdAt_idx`(`userId`, `createdAt`),
    INDEX `MembershipInvoice_status_expiresAt_idx`(`status`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MembershipRefund` (
    `id` VARCHAR(191) NOT NULL,
    `invoiceId` VARCHAR(191) NOT NULL,
    `amount` INTEGER NOT NULL,
    `reason` VARCHAR(400) NOT NULL,
    `reference` VARCHAR(100) NOT NULL DEFAULT '',
    `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    `revokeAccess` BOOLEAN NOT NULL DEFAULT false,
    `actorId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MembershipSpendLedger` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `sourceKey` VARCHAR(180) NOT NULL,
    `amount` INTEGER NOT NULL,
    `reason` VARCHAR(400) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `MembershipSpendLedger_sourceKey_key`(`sourceKey`),
    INDEX `MembershipSpendLedger_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MembershipHistory` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `action` VARCHAR(40) NOT NULL,
    `entitlementId` VARCHAR(191) NULL,
    `actorId` VARCHAR(191) NULL,
    `detail` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `MembershipHistory_userId_createdAt_idx`(`userId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Payment` ADD CONSTRAINT `Payment_membershipInvoiceId_fkey` FOREIGN KEY (`membershipInvoiceId`) REFERENCES `MembershipInvoice`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MembershipTierVersion` ADD CONSTRAINT `MembershipTierVersion_tierId_fkey` FOREIGN KEY (`tierId`) REFERENCES `MembershipTier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MembershipEntitlement` ADD CONSTRAINT `MembershipEntitlement_tierVersionId_fkey` FOREIGN KEY (`tierVersionId`) REFERENCES `MembershipTierVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MembershipInvoice` ADD CONSTRAINT `MembershipInvoice_tierVersionId_fkey` FOREIGN KEY (`tierVersionId`) REFERENCES `MembershipTierVersion`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MembershipRefund` ADD CONSTRAINT `MembershipRefund_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `MembershipInvoice`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
