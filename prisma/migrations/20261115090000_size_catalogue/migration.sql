-- Reuse current size names without changing variant IDs, prices or stock.
INSERT INTO `Taxonomy` (`id`, `kind`, `name`, `slug`, `description`, `image`, `productIds`, `active`)
SELECT CONCAT('size_', MD5(v.`name`)), 'SIZE', v.`name`, CONCAT('size-', MD5(v.`name`)), '', '', JSON_ARRAY(), true
FROM (SELECT DISTINCT `name` FROM `ProductVariant`) v
WHERE NOT EXISTS (SELECT 1 FROM `Taxonomy` t WHERE t.`kind` = 'SIZE' AND t.`name` = v.`name`);
