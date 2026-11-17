ALTER TABLE `Order` ADD COLUMN `paymentCode` VARCHAR(191) NULL,
  ADD COLUMN `checkoutAttempt` INTEGER NOT NULL DEFAULT 1;
CREATE INDEX `Order_status_paymentDueAt_idx` ON `Order`(`status`, `paymentDueAt`);

CREATE TABLE `OrderPaymentAttempt` (
  `code` VARCHAR(191) NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `orderId` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`code`),
  UNIQUE INDEX `OrderPaymentAttempt_idempotencyKey_key` (`idempotencyKey`),
  INDEX `OrderPaymentAttempt_orderId_idx` (`orderId`),
  CONSTRAINT `OrderPaymentAttempt_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `OrderPaymentAttempt` (`code`, `idempotencyKey`, `orderId`, `createdAt`)
SELECT `code`, `idempotencyKey`, `id`, `createdAt` FROM `Order`;

ALTER TABLE `MemberLedger` ADD COLUMN `attempt` INTEGER NOT NULL DEFAULT 1;
DROP INDEX `MemberLedger_orderId_action_key` ON `MemberLedger`;
CREATE UNIQUE INDEX `MemberLedger_orderId_action_attempt_key` ON `MemberLedger` (`orderId`, `action`, `attempt`);
