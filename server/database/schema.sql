-- ============================================================
-- TileKick — Schema completo (instalación limpia)
-- Convención: snake_case en todo
-- Sin ENUMs en BD (se manejan desde JS en utils/enums/)
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

CREATE DATABASE IF NOT EXISTS tilekick;
USE tilekick;

DROP TABLE IF EXISTS match_players;
DROP TABLE IF EXISTS matches;
DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS user_achievements;
DROP TABLE IF EXISTS password_resets;
DROP TABLE IF EXISTS social_accounts;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- ------------------------------------------------------------
-- 1. users
-- password NULL  → usuarios OAuth-only (sin contraseña propia)
-- username NULL  → se auto-asigna al crear cuenta OAuth
-- ------------------------------------------------------------
CREATE TABLE users (
    id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
    name            VARCHAR(200)  NOT NULL,
    father_lastname VARCHAR(200)  NULL,
    mother_lastname VARCHAR(200)  NULL,
    username        VARCHAR(50)   NULL,
    email           VARCHAR(200)  NOT NULL,
    password        VARCHAR(255)  NULL,
    avatar_url      VARCHAR(500)  NULL,
    is_verified     TINYINT(1)    NOT NULL DEFAULT 0,
    username_changed_at DATETIME  NULL,
    created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    deleted_at      DATETIME      NULL,

    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email    (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 2. social_accounts  (OAuth — Google / Facebook / GitHub)
-- provider: 1=google  2=facebook  3=github
-- ------------------------------------------------------------
CREATE TABLE social_accounts (
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

-- ------------------------------------------------------------
-- 3. password_resets
-- ------------------------------------------------------------
CREATE TABLE password_resets (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    token      VARCHAR(191) NOT NULL,
    expires_at DATETIME     NOT NULL,
    used       TINYINT(1)   NOT NULL DEFAULT 0,
    created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    user_id    INT UNSIGNED NOT NULL,

    PRIMARY KEY (id),
    INDEX idx_pr_token   (token),
    INDEX idx_pr_user_id (user_id),
    CONSTRAINT fk_pr_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 4. user_achievements  (stats + ELO)
-- ------------------------------------------------------------
CREATE TABLE user_achievements (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id     INT UNSIGNED NOT NULL,
    elo_rating  INT UNSIGNED NOT NULL DEFAULT 1000,
    points      INT UNSIGNED NOT NULL DEFAULT 0,
    wins        INT UNSIGNED NOT NULL DEFAULT 0,
    losses      INT UNSIGNED NOT NULL DEFAULT 0,
    draws       INT UNSIGNED NOT NULL DEFAULT 0,
    total_games INT UNSIGNED NOT NULL DEFAULT 0,
    win_streak  INT UNSIGNED NOT NULL DEFAULT 0,
    best_streak INT UNSIGNED NOT NULL DEFAULT 0,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_ua_user_id (user_id),
    CONSTRAINT fk_ua_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ------------------------------------------------------------
-- 5. user_preferences
-- graphics_quality: 1=low  2=medium  3=high  4=ultra
-- ------------------------------------------------------------
CREATE TABLE user_preferences (
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

-- ------------------------------------------------------------
-- 6. matches
-- game_type : 1=2d  2=3d
-- mode      : 1=online  2=local
-- status    : 1=waiting  2=in_progress  3=finished  4=abandoned
-- ------------------------------------------------------------
CREATE TABLE matches (
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

-- ------------------------------------------------------------
-- 7. match_players
-- team  : 1=A  2=B
-- result: 1=win  2=loss  3=draw  4=abandoned
-- elo_before / elo_after → historial de rating por partida
-- ------------------------------------------------------------
CREATE TABLE match_players (
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
