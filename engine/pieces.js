// ============================================================
//  TILEKICK — Piezas del juego
//  Exporta: PIECE_TYPES, PIECE_STATS, clase Piece
// ============================================================

/** Los tres tipos de piezas del juego */
export const PIECE_TYPES = {
    GOALKEEPER: 'goalkeeper',
    DEFENDER: 'defender',
    FORWARD: 'forward',
};

/**
 * Stats base por tipo de pieza.
 * - def: probabilidad base de conservar el balón ante una intercepción
 * - atk: probabilidad base de robar el balón en una intercepción
 * Los valores se usan en: resolveInterception() de movements.js
 */
export const PIECE_STATS = {
    goalkeeper: { def: 80, atk: 10 },
    defender: { def: 60, atk: 20 },
    forward: { def: 20, atk: 60 },
};

/**
 * Clase Piece — representa una pieza del juego.
 *
 * Propiedades:
 *  - id:      identificador único ('A-GK', 'A-DEF1', 'B-FWD2', …)
 *  - type:    PIECE_TYPES value
 *  - team:    'A' | 'B'
 *  - row:     fila actual (0–9)
 *  - col:     columna actual (0–4)
 *  - hasBall: true si esta pieza posee el balón
 */
export class Piece {
    constructor({ id, type, team, row, col, hasBall = false }) {
        this.id = id;
        this.type = type;
        this.team = team;
        this.row = row;
        this.col = col;
        this.hasBall = hasBall;
    }

    /** Stats derivados del tipo */
    get stats() {
        return PIECE_STATS[this.type];
    }

    /** Etiqueta corta para mostrar en UI */
    get label() {
        return { goalkeeper: 'GK', defender: 'DEF', forward: 'FWD' }[this.type];
    }

    toJSON() {
        return {
            id: this.id,
            type: this.type,
            team: this.team,
            row: this.row,
            col: this.col,
            hasBall: this.hasBall,
        };
    }

    static fromJSON(data) {
        return new Piece(data);
    }
}

/**
 * Construye las piezas en su posición inicial.
 *
 * Team A (empieza arriba, filas 0–2):
 *   GK   → fila 0, col 2      (portería A)
 *   DEF1 → fila 1, col 1
 *   DEF2 → fila 1, col 3
 *   FWD1 → fila 2, col 2      (tiene el balón)
 *   FWD2 → fila 2, col 0
 *
 * Team B (empieza abajo, filas 7–9):
 *   GK   → fila 9, col 2      (portería B)
 *   DEF1 → fila 8, col 1
 *   DEF2 → fila 8, col 3
 *   FWD1 → fila 7, col 2
 *   FWD2 → fila 7, col 4
 */
export function buildInitialPieces() {
    return [
        // Equipo A
        new Piece({ id: 'A-GK', type: PIECE_TYPES.GOALKEEPER, team: 'A', row: 0, col: 2 }),
        new Piece({ id: 'A-DEF1', type: PIECE_TYPES.DEFENDER, team: 'A', row: 1, col: 1 }),
        new Piece({ id: 'A-DEF2', type: PIECE_TYPES.DEFENDER, team: 'A', row: 1, col: 3 }),
        new Piece({ id: 'A-FWD1', type: PIECE_TYPES.FORWARD, team: 'A', row: 2, col: 0 }),
        new Piece({ id: 'A-FWD2', type: PIECE_TYPES.FORWARD, team: 'A', row: 2, col: 2, hasBall: true }),
        new Piece({ id: 'A-FWD3', type: PIECE_TYPES.FORWARD, team: 'A', row: 2, col: 4 }),

        // Equipo B
        new Piece({ id: 'B-GK', type: PIECE_TYPES.GOALKEEPER, team: 'B', row: 9, col: 2 }),
        new Piece({ id: 'B-DEF1', type: PIECE_TYPES.DEFENDER, team: 'B', row: 8, col: 1 }),
        new Piece({ id: 'B-DEF2', type: PIECE_TYPES.DEFENDER, team: 'B', row: 8, col: 3 }),
        new Piece({ id: 'B-FWD1', type: PIECE_TYPES.FORWARD, team: 'B', row: 7, col: 0 }),
        new Piece({ id: 'B-FWD2', type: PIECE_TYPES.FORWARD, team: 'B', row: 7, col: 2 }),
        new Piece({ id: 'B-FWD3', type: PIECE_TYPES.FORWARD, team: 'B', row: 7, col: 4 }),
    ];
}