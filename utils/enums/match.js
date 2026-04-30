/**
 * Match-related enums
 *
 * Corresponden a columnas TINYINT en las tablas `matches`.
 */

/** game_type — Tipo de partida */
export const GameType = Object.freeze({
    TWO_D:   1,
    THREE_D: 2,
});

export const GameTypeLabel = Object.freeze({
    [GameType.TWO_D]:   '2d',
    [GameType.THREE_D]: '3d',
});

/** mode — Modo de juego */
export const GameMode = Object.freeze({
    ONLINE: 1,
    LOCAL:  2,
});

export const GameModeLabel = Object.freeze({
    [GameMode.ONLINE]: 'online',
    [GameMode.LOCAL]:  'local',
});

/** status — Estado de la partida */
export const MatchStatus = Object.freeze({
    WAITING:     1,
    IN_PROGRESS: 2,
    FINISHED:    3,
    ABANDONED:   4,
});

export const MatchStatusLabel = Object.freeze({
    [MatchStatus.WAITING]:     'waiting',
    [MatchStatus.IN_PROGRESS]: 'in_progress',
    [MatchStatus.FINISHED]:    'finished',
    [MatchStatus.ABANDONED]:   'abandoned',
});
