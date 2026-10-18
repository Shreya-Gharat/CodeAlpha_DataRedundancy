CREATE DATABASE IF NOT EXISTS dedupdb;
USE dedupdb;

-- Verified, unique records only. The UNIQUE keys are the final guarantee that
-- duplicates can never be stored, even if two requests arrive at the same moment.
CREATE TABLE IF NOT EXISTS records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(255) NOT NULL,
  phone VARCHAR(20) NULL,
  city VARCHAR(60) NOT NULL,
  email_norm VARCHAR(255) NOT NULL,   -- normalized email used for matching
  phone_norm VARCHAR(15) NULL,        -- last 10 digits of the phone number
  name_key VARCHAR(120) NOT NULL,     -- lowercase name words, sorted, used for fuzzy matching
  name_block VARCHAR(4) NOT NULL,     -- first 2 letters of name_key, narrows the fuzzy search
  city_norm VARCHAR(60) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email_norm (email_norm),
  UNIQUE KEY uq_phone_norm (phone_norm),   -- NULLs are allowed more than once
  KEY idx_name_block (name_block)
);

-- Audit trail: every submission and how it was classified.
CREATE TABLE IF NOT EXISTS intake_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  status ENUM('unique','redundant','false_positive','invalid') NOT NULL,
  submitted TEXT,
  record_id INT NULL,
  matched_record_id INT NULL,
  similarity DECIMAL(4,3) NULL,
  reason VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_status (status)
);
