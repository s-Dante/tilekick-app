// ============================================================
//  TILEKICK — Lógica de movimientos legales
//  Exporta: getLegalMoves, getGoalkeeperSaveMoves,
//           canShoot, getShootTargets,
//           resolveInterception, getPassTargets
// ============================================================

import { PIECE_TYPES } from './pieces.js';
import { ROWS, COLS } from './board.js';

// ── Vectores de dirección ────────────────────────────────────

/** 8 direcciones (incluyendo diagonales) para movimiento de 1 paso */
const DIRS_8 = [
    [-1, -1], [-1, 0], [-1, 1],
    [0, -1], [0, 1],
    [1, -1], [1, 0], [1, 1],
];

/** 4 direcciones cardinales para movimiento de 2 pasos (sin saltar) */
const DIRS_4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

// ── API principal ────────────────────────────────────────────

/**
 * Calcula todas las casillas a las que puede moverse la pieza.
 *
 * @param {Piece}   piece   — pieza a evaluar
 * @param {Board}   board   — estado del tablero
 * @param {Piece[]} pieces  — todas las piezas en juego
 * @returns {Array<{row, col, action?}>}
 *   action puede ser undefined (movimiento normal), 'shoot', o 'pass'
 */
export function getLegalMoves(piece, board, pieces) {
    const occupied = buildOccupiedMap(pieces);

    if (piece.type === PIECE_TYPES.GOALKEEPER) {
        return _goalkeeperMoves(piece, board, occupied);
    }
    return _fieldMoves(piece, board, pieces);
}

/**
 * Devuelve las 3 casillas de la portería a las que el portero puede
 * moverse en el turno de ATAJAR (incluye su posición actual).
 *
 * @param {Piece} goalkeeper
 * @returns {Array<{row, col}>}
 */
export function getGoalkeeperSaveMoves(goalkeeper) {
    const goalRow = goalkeeper.team === 'A' ? 0 : ROWS - 1;
    return [1, 2, 3].map(col => ({ row: goalRow, col }));
}

/**
 * ¿Puede esta pieza intentar un disparo a portería?
 * Condición: pieza con balón en las 2 filas más cercanas a la portería rival.
 *
 * Team A dispara hacia fila 9 → su zona de tiro es filas 7 y 8.
 * Team B dispara hacia fila 0 → su zona de tiro es filas 1 y 2.
 */
export function canShoot(piece, board) {
    if (!piece.hasBall) return false;
    const shootRows = piece.team === 'A' ? [7, 8] : [1, 2];
    return shootRows.includes(piece.row);
}

/**
 * Devuelve las 3 casillas destino válidas para disparar
 * (las 3 casillas centrales de la portería rival).
 */
export function getShootTargets(piece) {
    const goalRow = piece.team === 'A' ? ROWS - 1 : 0;
    return [
        { row: goalRow, col: 1, action: 'shoot' },
        { row: goalRow, col: 2, action: 'shoot' },
        { row: goalRow, col: 3, action: 'shoot' },
    ];
}

/**
 * Intento de intercepción del balón.
 * La probabilidad se calcula como: atk_atacante / (atk_atacante + def_poseedor).
 *
 * @param {Piece} attacker  — pieza que intenta robar el balón
 * @param {Piece} defender  — pieza que actualmente posee el balón
 * @returns {{ success: boolean, probability: number }}
 *   probability es el % de éxito redondeado del atacante
 */
export function resolveInterception(attacker, defender) {
    const { atk: atkA } = attacker.stats;
    const { def: defD } = defender.stats;
    const probability = atkA / (atkA + defD);
    const success = Math.random() < probability;
    return { success, probability: Math.round(probability * 100) };
}

/**
 * Compañeros de equipo dentro de un radio de 2 casillas
 * a quienes se les puede pasar el balón.
 *
 * @returns {Array<{row, col, pieceId, action: 'pass'}>}
 */
export function getPassTargets(piece, pieces) {
    if (!piece.hasBall) return [];
    return pieces
        .filter(p =>
            p.team === piece.team &&
            p.id !== piece.id &&
            Math.abs(p.row - piece.row) <= 2 &&
            Math.abs(p.col - piece.col) <= 2
        )
        .map(p => ({ row: p.row, col: p.col, pieceId: p.id, action: 'pass' }));
}

// ── Movimientos internos ─────────────────────────────────────

/** Movimientos legales del portero (solo dentro de su portería, sin posición actual) */
function _goalkeeperMoves(piece, board, occupied) {
    const goalRow = piece.team === 'A' ? 0 : ROWS - 1;
    return [1, 2, 3]
        .filter(col => col !== piece.col && !occupied.has(`${goalRow},${col}`))
        .map(col => ({ row: goalRow, col }));
}

/** Movimientos legales de jugadores de campo (defensas + delanteros) */
function _fieldMoves(piece, board, pieces) {
    const occupied = buildOccupiedMap(pieces);
    const result = [];

    // Movimientos de 1 paso en las 8 direcciones
    for (const [dr, dc] of DIRS_8) {
        const nr = piece.row + dr;
        const nc = piece.col + dc;
        if (_validTarget(nr, nc, board, occupied)) {
            result.push({ row: nr, col: nc });
        } else if (board.isOnBoard(nr, nc) && !board.isGoalArea(nr, nc) && !board.isStomped(nr, nc)) {
            // Comprobar si la casilla tiene un rival con el balón → robo
            const key = `${nr},${nc}`;
            const occupant = occupied.get(key);
            if (occupant && occupant.team !== piece.team && occupant.hasBall) {
                result.push({ row: nr, col: nc, action: 'steal' });
            }
        }
    }

    // Movimientos de 2 pasos en 4 direcciones (no puede saltar piezas)
    for (const [dr, dc] of DIRS_4) {
        const mr = piece.row + dr;      // casilla intermedia
        const mc = piece.col + dc;
        const nr = piece.row + dr * 2; // casilla destino
        const nc = piece.col + dc * 2;

        if (!board.isOnBoard(mr, mc)) continue;
        if (occupied.has(`${mr},${mc}`)) continue; // bloqueado
        if (_validTarget(nr, nc, board, occupied)) {
            result.push({ row: nr, col: nc });
        }
    }

    return result;
}

/**
 * ¿Puede un jugador de campo moverse a esta casilla?
 * No puede: salirse del tablero, entrar a portería, entrar a casilla impasable,
 * ni a casilla ocupada por otra pieza.
 */
function _validTarget(row, col, board, occupied) {
    if (!board.isOnBoard(row, col)) return false;
    if (board.isGoalArea(row, col)) return false; // solo porteros aquí
    if (board.isStomped(row, col)) return false; // impasable
    if (occupied.has(`${row},${col}`)) return false; // ocupada
    return true;
}

/** Construye un Map de "fila,col" → Piece para consultas O(1) */
function buildOccupiedMap(pieces) {
    return new Map(pieces.map(p => [`${p.row},${p.col}`, p]));
}