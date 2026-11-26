-- Migration 003: Stretch Goals (GPS Salesman Visits + e-Invoice/e-Way Bill Mock)
SET @dbname = DATABASE();

-- 1. sales_visits table
CREATE TABLE IF NOT EXISTS sales_visits (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  salesman_id BIGINT NOT NULL,
  customer_id BIGINT NOT NULL,
  latitude DECIMAL(10,7) NOT NULL,
  longitude DECIMAL(10,7) NOT NULL,
  accuracy_m DECIMAL(8,2) NULL,
  notes VARCHAR(300) NULL,
  visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (salesman_id) REFERENCES users(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  INDEX idx_visits_salesman (salesman_id, visited_at)
) ENGINE=InnoDB;

-- 2. e-Invoice / e-Way Bill columns on invoices
SET @s = (SELECT IF((SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=@dbname AND TABLE_NAME='invoices' AND COLUMN_NAME='irn') > 0, 'SELECT 1', 'ALTER TABLE invoices ADD COLUMN irn VARCHAR(64) NULL, ADD COLUMN ack_no VARCHAR(40) NULL, ADD COLUMN ack_date DATETIME NULL, ADD COLUMN ewb_no VARCHAR(30) NULL, ADD COLUMN einvoice_json JSON NULL'));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
