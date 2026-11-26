-- Migration 002: Masters Upgrade (MySQL 8 compatible, non-destructive)
SET @dbname = DATABASE();

-- 1. customers.email
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='customers' AND COLUMN_NAME='email') > 0, 'SELECT 1', 'ALTER TABLE customers ADD COLUMN email VARCHAR(190) NULL'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. products.image_url
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='products' AND COLUMN_NAME='image_url') > 0, 'SELECT 1', 'ALTER TABLE products ADD COLUMN image_url VARCHAR(500) NULL'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. boms.effective_date & notes
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='boms' AND COLUMN_NAME='effective_date') > 0, 'SELECT 1', 'ALTER TABLE boms ADD COLUMN effective_date DATE NULL, ADD COLUMN notes VARCHAR(255) NULL'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. supplier_payments table
CREATE TABLE IF NOT EXISTS supplier_payments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  supplier_id BIGINT NOT NULL,
  purchase_id BIGINT NULL,
  amount DECIMAL(14,2) NOT NULL,
  payment_date DATE NOT NULL,
  mode VARCHAR(30),
  reference_no VARCHAR(100),
  notes VARCHAR(500),
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- 5. Indexes for faster master filtering
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='customers' AND INDEX_NAME='idx_customers_type_active') > 0, 'SELECT 1', 'CREATE INDEX idx_customers_type_active ON customers(customer_type, is_active)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='products' AND INDEX_NAME='idx_products_active') > 0, 'SELECT 1', 'CREATE INDEX idx_products_active ON products(is_active)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
