/**
 * Player-related enums
 *
 * Corresponden a columnas TINYINT en la tabla `match_players`.
 */

/** team — Equipo del jugador en la partida */
export const Team = Object.freeze({
    A: 1,
    B: 2,
});

export const TeamLabel = Object.freeze({
    [Team.A]: 'A',
    [Team.B]: 'B',
});

/** result — Resultado del jugador en la partida */
export const PlayerResult = Object.freeze({
    WIN:       1,
    LOSS:      2,
    DRAW:      3,
    ABANDONED: 4,
});

export const PlayerResultLabel = Object.freeze({
    [PlayerResult.WIN]:       'win',
    [PlayerResult.LOSS]:      'loss',
    [PlayerResult.DRAW]:      'draw',
    [PlayerResult.ABANDONED]: 'abandoned',
});

/** Puntos ELO base por resultado (ajustar según balance del juego) */
export const EloPoints = Object.freeze({
    [PlayerResult.WIN]:       +30,
    [PlayerResult.LOSS]:      -10,
    [PlayerResult.DRAW]:      +10,
    [PlayerResult.ABANDONED]: -15,
});
