-- ============================================================
-- TileKick — Migración desde estructura existente
-- Ejecutar en orden. Seguro de relanzar (IF EXISTS / IF NOT EXISTS).
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- ============================================================
-- 1. TABLA: users
--    camelCase → snake_case + nuevas columnas
-- ============================================================

-- Renombrar columnas camelCase
ALTER TABLE users
    CHANGE COLUMN `createdAt` `created_at` DATETIME NULL,
    CHANGE COLUMN `updatedAt` `updated_at` DATETIME NULL;

-- deleted_at puede que ya exista en snake_case; intentar agregar solo si no existe
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS `deleted_at` DATETIME NULL AFTER `updated_at`;

-- Nuevas columnas
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS `avatar_url`            VARCHAR(500) NULL                AFTER `password`,
    ADD COLUMN IF NOT EXISTS `is_verified`           TINYINT(1)  NOT NULL DEFAULT 0  AFTER `avatar_url`,
    ADD COLUMN IF NOT EXISTS `username_changed_at`   DATETIME    NULL                 AFTER `is_verified`;

-- Hacer username y password nullable (para OAuth)
ALTER TABLE users
    MODIFY COLUMN `username` VARCHAR(50)  NULL,
    MODIFY COLUMN `password` VARCHAR(255) NULL;

-- Asegurar motor y charset
ALTER TABLE users
    ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4
    COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 2. TABLA: password_resets
--    camelCase → snake_case
-- ============================================================

ALTER TABLE password_resets
    CHANGE COLUMN `expiresAt` `expires_at` DATETIME     NOT NULL,
    CHANGE COLUMN `createdAt` `created_at` DATETIME     NOT NULL,
    CHANGE COLUMN `updatedAt` `updated_at` DATETIME     NOT NULL,
    CHANGE COLUMN `userID`    `user_id`    INT UNSIGNED NOT NULL;

-- Agregar índices si no existen (ignorar error si ya existen)
ALTER TABLE password_resets
    ADD INDEX IF NOT EXISTS `idx_pr_token`   (`token`),
    ADD INDEX IF NOT EXISTS `idx_pr_user_id` (`user_id`);

ALTER TABLE password_resets
    ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4
    COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 3. TABLA: user_achivements → user_achievements  (fix typo)
--    Agregar columnas nuevas
-- ============================================================

-- Renombrar tabla (fix typo)
RENAME TABLE `user_achivements` TO `user_achievements`;

-- Nuevas columnas de stats
ALTER TABLE user_achievements
    ADD COLUMN IF NOT EXISTS `elo_rating`  INT UNSIGNED NOT NULL DEFAULT 1000 AFTER `user_id`,
    ADD COLUMN IF NOT EXISTS `total_games` INT UNSIGNED NOT NULL DEFAULT 0     AFTER `draws`,
    ADD COLUMN IF NOT EXISTS `win_streak`  INT UNSIGNED NOT NULL DEFAULT 0     AFTER `total_games`,
    ADD COLUMN IF NOT EXISTS `best_streak` INT UNSIGNED NOT NULL DEFAULT 0     AFTER `win_streak`,
    ADD COLUMN IF NOT EXISTS `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `best_streak`,
    ADD COLUMN IF NOT EXISTS `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`;

-- Calcular total_games desde wins + losses + draws existentes
UPDATE user_achievements
    SET total_games = wins + losses + draws
    WHERE total_games = 0;

ALTER TABLE user_achievements
    ENGINE=InnoDB
    DEFAULT CHARSET=utf8mb4
    COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 4. CREAR TABLAS NUEVAS (si no existen)
-- ============================================================

-- social_accounts
CREATE TABLE IF NOT EXISTS social_accounts (
    id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    user_id          INT UNSIGNED     NOT NULL,
    provider         TINYINT UNSIGNED NOT NULL,
    provider_user_id VARCHAR(255)     NOT NULL,
    access_token     TEXT             NULL,
    refresh_token    TEXT             NULL,
    token_expires_at DATETIME         NULL,
    created_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_social_provider (provider, provider_user_id),
    INDEX idx_sa_user_id (user_id),
    CONSTRAINT fk_sa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- user_preferences
CREATE TABLE IF NOT EXISTS user_preferences (
    id               INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    user_id          INT UNSIGNED     NOT NULL,
    graphics_quality TINYINT UNSIGNED NOT NULL DEFAULT 2,
    character_color  VARCHAR(20)      NOT NULL DEFAULT '#354024',
    music_volume     TINYINT UNSIGNED NOT NULL DEFAULT 80,
    sfx_volume       TINYINT UNSIGNED NOT NULL DEFAULT 80,
    show_fps         TINYINT(1)       NOT NULL DEFAULT 0,
    language         VARCHAR(10)      NOT NULL DEFAULT 'es',
    created_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_pref_user_id (user_id),
    CONSTRAINT fk_pref_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- matches
CREATE TABLE IF NOT EXISTS matches (
    id          INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    room_id     VARCHAR(20)      NOT NULL,
    map         VARCHAR(50)      NOT NULL,
    game_type   TINYINT UNSIGNED NOT NULL,
    mode        TINYINT UNSIGNED NOT NULL DEFAULT 1,
    status      TINYINT UNSIGNED NOT NULL DEFAULT 1,
    winner_id   INT UNSIGNED     NULL,
    is_draw     TINYINT(1)       NOT NULL DEFAULT 0,
    started_at  DATETIME         NULL,
    finished_at DATETIME         NULL,
    created_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_matches_room_id   (room_id),
    INDEX idx_matches_status    (status),
    INDEX idx_matches_winner_id (winner_id),
    CONSTRAINT fk_match_winner FOREIGN KEY (winner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- match_players
CREATE TABLE IF NOT EXISTS match_players (
    id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
    match_id      INT UNSIGNED     NOT NULL,
    user_id       INT UNSIGNED     NOT NULL,
    team          TINYINT UNSIGNED NOT NULL,
    result        TINYINT UNSIGNED NULL,
    points_earned INT              NOT NULL DEFAULT 0,
    elo_before    INT UNSIGNED     NOT NULL DEFAULT 1000,
    elo_after     INT UNSIGNED     NOT NULL DEFAULT 1000,
    created_at    DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_mp_match_user (match_id, user_id),
    INDEX idx_mp_user_id (user_id),
    CONSTRAINT fk_mp_match FOREIGN KEY (match_id) REFERENCES matches(id)  ON DELETE CASCADE,
    CONSTRAINT fk_mp_user  FOREIGN KEY (user_id)  REFERENCES users(id)    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 5. BACKFILL: crear registros de achievements y preferences
--    para usuarios existentes que no los tengan aún
-- ============================================================

INSERT IGNORE INTO user_achievements (user_id)
    SELECT id FROM users;

INSERT IGNORE INTO user_preferences (user_id)
    SELECT id FROM users;

SET FOREIGN_KEY_CHECKS = 1;

SELECT 'Migración completada exitosamente.' AS resultado;
