ALTER TABLE `User` ADD COLUMN `googleSubject` VARCHAR(255) NULL;
CREATE UNIQUE INDEX `User_googleSubject_key` ON `User`(`googleSubject`);
CREATE TABLE `GoogleLoginAttempt` (
  `id` VARCHAR(64) NOT NULL,
  `browserHash` VARCHAR(64) NOT NULL,
  `verifierEncrypted` TEXT NOT NULL,
  `nonce` VARCHAR(64) NOT NULL,
  `nextPath` VARCHAR(1024) NOT NULL,
  `linkUserId` VARCHAR(191) NULL,
  `userId` VARCHAR(191) NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  `expiresAt` DATETIME(3) NOT NULL,
  INDEX `GoogleLoginAttempt_expiresAt_idx`(`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
