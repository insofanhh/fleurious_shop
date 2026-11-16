ALTER TABLE `Address`
  MODIFY `address` VARCHAR(800) NOT NULL,
  MODIFY `zoneId` VARCHAR(191) NULL,
  ADD COLUMN `placeId` VARCHAR(2048) NULL,
  ADD COLUMN `formattedAddress` VARCHAR(500) NULL,
  ADD COLUMN `addressDetails` VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN `latitude` DECIMAL(10,7) NULL,
  ADD COLUMN `longitude` DECIMAL(10,7) NULL,
  ADD COLUMN `verifiedAt` DATETIME(3) NULL;
ALTER TABLE `Order`
  MODIFY `address` VARCHAR(800) NOT NULL,
  MODIFY `zoneId` VARCHAR(191) NULL,
  ADD COLUMN `shippingMethod` VARCHAR(20) NOT NULL DEFAULT 'ZONE',
  ADD COLUMN `shippingSnapshot` JSON NULL,
  ADD COLUMN `shippingQuoteId` VARCHAR(191) NULL;
CREATE TABLE `ShippingLocation` (
  `id` VARCHAR(191) NOT NULL, `owner` VARCHAR(150) NOT NULL,
  `placeId` VARCHAR(2048) NOT NULL, `address` VARCHAR(500) NOT NULL,
  `latitude` DECIMAL(10,7) NOT NULL, `longitude` DECIMAL(10,7) NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ShippingLocation_expiresAt_idx` (`expiresAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ShippingQuote` (
  `id` VARCHAR(191) NOT NULL, `owner` VARCHAR(150) NOT NULL,
  `destinationKey` VARCHAR(64) NOT NULL, `policyVersion` INTEGER NOT NULL,
  `fee` INTEGER NOT NULL, `snapshot` JSON NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ShippingQuote_owner_destinationKey_policyVersion_expiresAt_idx` (`owner`, `destinationKey`, `policyVersion`, `expiresAt`),
  INDEX `ShippingQuote_expiresAt_idx` (`expiresAt`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE TABLE `ShippingRouteCache` (
  `key` VARCHAR(64) NOT NULL, `distanceMeters` INTEGER NOT NULL, `durationSeconds` INTEGER NOT NULL,
  `expiresAt` DATETIME(3) NOT NULL,
  INDEX `ShippingRouteCache_expiresAt_idx` (`expiresAt`), PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
