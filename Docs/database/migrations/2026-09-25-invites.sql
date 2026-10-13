-- 2026-09-25: invite links (people choose their own password). Adds only; changes no existing data except
-- marking people who already have a password as joined.
SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE users ADD COLUMN joined_at DATETIME NULL AFTER is_active;
UPDATE users SET joined_at = created_at WHERE joined_at IS NULL AND password_hash <> '';

CREATE TABLE IF NOT EXISTS user_invites (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  purpose ENUM('join','reset') NOT NULL DEFAULT 'join',
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
