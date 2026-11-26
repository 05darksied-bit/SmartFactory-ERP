-- Migration 001: SmartFactory ERP Audit & Feature Improvements (MySQL 8 compatible)
SET @dbname = DATABASE();

-- 1. sales_orders.idempotency_key
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='sales_orders' AND COLUMN_NAME='idempotency_key') > 0, 'SELECT 1', 'ALTER TABLE sales_orders ADD COLUMN idempotency_key VARCHAR(64) NULL, ADD UNIQUE INDEX uq_sales_orders_idempotency (idempotency_key)'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. customers.credit_limit
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='customers' AND COLUMN_NAME='credit_limit') > 0, 'SELECT 1', 'ALTER TABLE customers ADD COLUMN credit_limit DECIMAL(14,2) NOT NULL DEFAULT 100000.00'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. suppliers.is_active
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='suppliers' AND COLUMN_NAME='is_active') > 0, 'SELECT 1', 'ALTER TABLE suppliers ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. users.sales_target
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='users' AND COLUMN_NAME='sales_target') > 0, 'SELECT 1', 'ALTER TABLE users ADD COLUMN sales_target DECIMAL(14,2) NOT NULL DEFAULT 50000.00'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. production_runs.batch_number & production_date
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='production_runs' AND COLUMN_NAME='batch_number') > 0, 'SELECT 1', 'ALTER TABLE production_runs ADD COLUMN batch_number VARCHAR(60) NULL, ADD COLUMN production_date DATE NULL'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 6. stock_adjustments approval columns
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='stock_adjustments' AND COLUMN_NAME='status') > 0, 'SELECT 1', 'ALTER TABLE stock_adjustments ADD COLUMN status ENUM(\'PENDING\',\'APPROVED\',\'REJECTED\') NOT NULL DEFAULT \'PENDING\', ADD COLUMN approved_by BIGINT NULL, ADD COLUMN approved_at DATETIME NULL'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 7. stock_batches for batch tracking, expiry & FEFO
CREATE TABLE IF NOT EXISTS stock_batches (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  item_type ENUM('RAW','PACKAGING','FINISHED') NOT NULL,
  item_id BIGINT NOT NULL,
  batch_no VARCHAR(60) NOT NULL,
  expiry_date DATE NULL,
  initial_qty DECIMAL(16,4) NOT NULL,
  remaining_qty DECIMAL(16,4) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  unit_cost DECIMAL(14,4) DEFAULT 0,
  source_type VARCHAR(40) NOT NULL,
  source_id BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_fefo (item_type, item_id, expiry_date, remaining_qty)
) ENGINE=InnoDB;

-- 8. purchase_returns
CREATE TABLE IF NOT EXISTS purchase_returns (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  purchase_id BIGINT NOT NULL,
  item_id BIGINT NOT NULL,
  quantity DECIMAL(16,4) NOT NULL,
  unit VARCHAR(20) NOT NULL,
  reason VARCHAR(500),
  created_by BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (purchase_id) REFERENCES purchases(id),
  FOREIGN KEY (item_id) REFERENCES inventory_items(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- 9. quality_inspections
CREATE TABLE IF NOT EXISTS quality_inspections (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  run_id BIGINT NOT NULL,
  inspector_id BIGINT NOT NULL,
  inspection_date DATE NOT NULL,
  status ENUM('PASSED','FAILED','CONDITIONAL') NOT NULL DEFAULT 'PASSED',
  rejected_qty INT NOT NULL DEFAULT 0,
  defect_type VARCHAR(120) NULL,
  checklist JSON NULL,
  corrective_action TEXT NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES production_runs(id),
  FOREIGN KEY (inspector_id) REFERENCES users(id)
) ENGINE=InnoDB;
