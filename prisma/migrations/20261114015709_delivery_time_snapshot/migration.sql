-- AlterTable
ALTER TABLE `Order` ADD COLUMN `deliveryEnd` DATETIME(3) NULL,
    ADD COLUMN `deliveryStart` DATETIME(3) NULL;
