-- Tokens explicitly ended by "Sign out". Rows are kept only until the token would expire anyway.
CREATE TABLE IF NOT EXISTS revoked_tokens (
  jti CHAR(32) PRIMARY KEY,
  user_id INT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  INDEX idx_expires (expires_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
