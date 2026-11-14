ALTER TABLE `Order`
  ADD COLUMN `source` VARCHAR(191) NOT NULL DEFAULT 'WEBSITE',
  ADD COLUMN `createdBy` VARCHAR(191) NULL,
  ADD COLUMN `expiredAt` DATETIME(3) NULL;

UPDATE `Order` o
JOIN (
  SELECT `orderId`, MIN(`createdAt`) AS `expiredAt`
  FROM `OrderHistory`
  WHERE `text` = 'Đơn hết thời gian xác nhận/thanh toán'
  GROUP BY `orderId`
) h ON h.`orderId` = o.`id`
SET o.`expiredAt` = h.`expiredAt`
WHERE o.`status` = 'CANCELLED' AND o.`paymentStatus` IN ('UNPAID', 'PENDING');
