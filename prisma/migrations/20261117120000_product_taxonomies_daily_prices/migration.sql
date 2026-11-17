CREATE TABLE `ProductTaxonomy` (
  `productId` VARCHAR(191) NOT NULL,
  `taxonomyId` VARCHAR(191) NOT NULL,
  INDEX `ProductTaxonomy_taxonomyId_idx` (`taxonomyId`),
  PRIMARY KEY (`productId`, `taxonomyId`),
  CONSTRAINT `ProductTaxonomy_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `ProductTaxonomy_taxonomyId_fkey` FOREIGN KEY (`taxonomyId`) REFERENCES `Taxonomy` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve every existing catalogue classification as an explicit relation.
INSERT IGNORE INTO `ProductTaxonomy` (`productId`, `taxonomyId`)
SELECT p.id, t.id FROM `Product` p JOIN `Taxonomy` t ON
  (t.kind='CATEGORY' AND t.name=p.category) OR
  (t.kind='OCCASION' AND t.name=p.occasion) OR
  (t.kind='COLOR' AND t.name=p.color);

INSERT INTO `Taxonomy` (id, kind, name, slug, description, image, productIds, active)
SELECT 'fleurious-daily-category', 'CATEGORY', 'Hoa mỗi ngày', 'category-hoa-moi-ngay', '', '', JSON_ARRAY(), true
WHERE NOT EXISTS (SELECT 1 FROM `Taxonomy` WHERE kind='CATEGORY' AND name='Hoa mỗi ngày');

-- Existing Daily products remain in the Daily catalogue. Paid plan snapshots are untouched.
INSERT IGNORE INTO `ProductTaxonomy` (`productId`, `taxonomyId`)
SELECT DISTINCT v.productId, t.id FROM `DailyOffering` o
JOIN `ProductVariant` v ON v.id=o.variantId
JOIN `Taxonomy` t ON t.kind='CATEGORY' AND t.name='Hoa mỗi ngày'
WHERE o.active=true;

UPDATE `Setting` SET value=JSON_SET(value, '$.pricingMode', 'PRODUCT') WHERE `key`='daily_program';
