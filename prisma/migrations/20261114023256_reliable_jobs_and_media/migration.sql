-- AlterTable
ALTER TABLE `ActiveDay` MODIFY `image` VARCHAR(2048) NOT NULL;

-- AlterTable
ALTER TABLE `Content` MODIFY `image` VARCHAR(2048) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `JobRun` ADD COLUMN `attempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `availableAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

-- AlterTable
ALTER TABLE `Order` MODIFY `buyerEmail` VARCHAR(254) NOT NULL;

-- AlterTable
ALTER TABLE `OrderItem` MODIFY `image` VARCHAR(2048) NOT NULL;

-- AlterTable
ALTER TABLE `Product` MODIFY `image` VARCHAR(2048) NOT NULL;

-- AlterTable
ALTER TABLE `Taxonomy` MODIFY `image` VARCHAR(2048) NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE `User` MODIFY `email` VARCHAR(254) NOT NULL;

-- CreateIndex
CREATE INDEX `JobRun_status_availableAt_idx` ON `JobRun`(`status`, `availableAt`);

