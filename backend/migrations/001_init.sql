CREATE TABLE IF NOT EXISTS sites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  domain VARCHAR(255) NOT NULL,
  color VARCHAR(7) NOT NULL DEFAULT '#3B82F6',
  api_key VARCHAR(80) NOT NULL UNIQUE,
  allowed_origins JSON NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(200) NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  role ENUM('super_admin','manager','viewer') NOT NULL DEFAULT 'viewer',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  token_version INT NOT NULL DEFAULT 0,
  last_login_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_sites (
  user_id INT NOT NULL,
  site_id INT NOT NULL,
  PRIMARY KEY (user_id, site_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS leads (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  site_id INT NOT NULL,
  type ENUM('inquiry','quote') NOT NULL,
  name VARCHAR(200) NOT NULL,
  email VARCHAR(200) NULL,
  phone VARCHAR(30) NULL,
  subject VARCHAR(255) NULL,
  company VARCHAR(200) NULL,
  message TEXT NULL,
  extra JSON NULL,
  raw_payload JSON NOT NULL,
  source_url VARCHAR(500) NULL,
  ip VARCHAR(45) NULL,
  user_agent VARCHAR(300) NULL,
  status ENUM('new','contacted','followup','closed','spam') NOT NULL DEFAULT 'new',
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (site_id) REFERENCES sites(id),
  INDEX idx_site_created (site_id, created_at),
  INDEX idx_status (status),
  INDEX idx_type (type),
  INDEX idx_created (created_at),
  FULLTEXT INDEX ft_search (name, email, phone, message)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_notes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  lead_id BIGINT NOT NULL,
  user_id INT NOT NULL,
  note TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
