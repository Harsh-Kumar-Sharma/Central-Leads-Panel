-- Phase 2: notifications (email + in-app)

-- Global key/value settings. Keys: 'smtp_global', 'global_recipients'
CREATE TABLE IF NOT EXISTS settings (
  `key` VARCHAR(100) PRIMARY KEY,
  value JSON NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-company SMTP override (optional, one row per site)
CREATE TABLE IF NOT EXISTS site_smtp (
  site_id INT PRIMARY KEY,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  host VARCHAR(255) NOT NULL,
  port INT NOT NULL,
  secure TINYINT(1) NOT NULL DEFAULT 0,
  username VARCHAR(255) NOT NULL,
  password_enc TEXT NOT NULL,
  from_name VARCHAR(150) NOT NULL,
  from_email VARCHAR(200) NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-company recipients
CREATE TABLE IF NOT EXISTS site_recipients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  site_id INT NOT NULL,
  email VARCHAR(200) NOT NULL,
  mode ENUM('to','cc','bcc') NOT NULL DEFAULT 'to',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_site_email (site_id, email),
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- In-app notifications
CREATE TABLE IF NOT EXISTS notifications (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  lead_id BIGINT NOT NULL,
  site_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  body VARCHAR(500) NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_read (user_id, is_read, created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-user notification preferences
CREATE TABLE IF NOT EXISTS user_notification_prefs (
  user_id INT PRIMARY KEY,
  bell_enabled TINYINT(1) NOT NULL DEFAULT 1,
  site_ids JSON NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Email delivery log (also acts as the retry queue)
CREATE TABLE IF NOT EXISTS email_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT NULL,
  site_id INT NULL,
  smtp_source ENUM('global','site') NOT NULL,
  to_addresses JSON NOT NULL,
  cc_addresses JSON NULL,
  bcc_addresses JSON NULL,
  subject VARCHAR(300) NOT NULL,
  status ENUM('pending','sent','retrying','failed') NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP NULL,
  error TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  sent_at TIMESTAMP NULL,
  INDEX idx_status_next (status, next_attempt_at),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
