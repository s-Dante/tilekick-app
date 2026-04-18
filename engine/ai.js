// ============================================================
//  TILEKICK — IA del Jugador Autónomo
//  Exporta: AI_LEVELS, clase AIPlayer
//
//  Nivel 1 (EASY)   — Movimientos aleatorios
//  Nivel 2 (MEDIUM) — Prioriza disparo > pase adelantado > avanzar con balón
//  Nivel 3 (HARD)   — Añade presión defensiva y posicionamiento sin balón
// ============================================================

import { PIECE_TYPES } from './pieces.js';
import {
    getLegalMoves,
    canShoot,
    getShootTargets,
    getPassTargets,
} from './movements.js';

export const AI_LEVELS = { EASY: 1, MEDIUM: 2, HARD: 3 };

export class AIPlayer {
    /**
     * @param {string} team    — 'A' | 'B'
     * @param {number} level   — AI_LEVELS value
     */
    constructor(team, level = AI_LEVELS.EASY) {
        this.team = team;
        this.level = level;
    }

    /**
     * Calcula la próxima acción de la IA dado el estado del juego.
     *
     * @param {GameState} gs
     * @returns {{ pieceId, targetRow, targetCol } | null}
     */
    computeMove(gs) {
        switch (this.level) {
            case AI_LEVELS.EASY: return this._randomMove(gs);
            case AI_LEVELS.MEDIUM: return this._smartMove(gs);
            case AI_LEVELS.HARD: return this._hardMove(gs);
            default: return this._randomMove(gs);
        }
    }

    // ── Nivel 1: Aleatorio ───────────────────────────────────

    _randomMove(gs) {
        const myPieces = gs.getMyPieces(this.team).sort(() => Math.random() - 0.5);

        for (const piece of myPieces) {
            const moves = getLegalMoves(piece, gs.board, gs.pieces);
            if (moves.length > 0) {
                const target = moves[Math.floor(Math.random() * moves.length)];
                return { pieceId: piece.id, targetRow: target.row, targetCol: target.col };
            }
        }
        return null;
    }

    // ── Nivel 2: Inteligente ─────────────────────────────────

    _smartMove(gs) {
        const ballHolder = gs.getBallHolder();
        const rivalGoalRow = this.team === 'A' ? 9 : 0;

        // 1. Intentar disparo si es posible
        if (ballHolder?.team === this.team && canShoot(ballHolder, gs.board)) {
            const targets = getShootTargets(ballHolder);
            if (targets.length > 0) {
                const t = targets[Math.floor(Math.random() * targets.length)];
                return { pieceId: ballHolder.id, targetRow: t.row, targetCol: t.col };
            }
        }

        // 2. Pasar el balón a un compañero más adelantado
        if (ballHolder?.team === this.team) {
            const passes = getPassTargets(ballHolder, gs.pieces);
            if (passes.length > 0) {
                const best = passes
                    .map(p => ({ ...p, dist: Math.abs(p.row - rivalGoalRow) }))
                    .sort((a, b) => a.dist - b.dist)[0];
                // Solo pasar si hay alguien más adelantado
                if (best && best.dist < Math.abs(ballHolder.row - rivalGoalRow)) {
                    return { pieceId: ballHolder.id, targetRow: best.row, targetCol: best.col };
                }
            }
        }

        // 3. Avanzar con el balón hacia la portería rival
        if (ballHolder?.team === this.team) {
            const moves = getLegalMoves(ballHolder, gs.board, gs.pieces);
            if (moves.length > 0) {
                const best = moves
                    .map(m => ({ ...m, dist: Math.abs(m.row - rivalGoalRow) }))
                    .sort((a, b) => a.dist - b.dist)[0];
                return { pieceId: ballHolder.id, targetRow: best.row, targetCol: best.col };
            }
        }

        // 4. Si el rival tiene el balón, mover una pieza hacia él (presión)
        if (ballHolder && ballHolder.team !== this.team) {
            const myPieces = gs.getMyPieces(this.team)
                .filter(p => p.type !== PIECE_TYPES.GOALKEEPER);
            const closest = myPieces
                .map(p => ({
                    piece: p,
                    dist: Math.abs(p.row - ballHolder.row) + Math.abs(p.col - ballHolder.col),
                }))
                .sort((a, b) => a.dist - b.dist)[0];

            if (closest) {
                const moves = getLegalMoves(closest.piece, gs.board, gs.pieces);
                if (moves.length > 0) {
                    const best = moves
                        .map(m => ({
                            ...m,
                            dist: Math.abs(m.row - ballHolder.row) + Math.abs(m.col - ballHolder.col),
                        }))
                        .sort((a, b) => a.dist - b.dist)[0];
                    return { pieceId: closest.piece.id, targetRow: best.row, targetCol: best.col };
                }
            }
        }

        // Fallback
        return this._randomMove(gs);
    }

    // ── Nivel 3: Estratégico ─────────────────────────────────

    _hardMove(gs) {
        const rivalGoalRow = this.team === 'A' ? 9 : 0;
        const ballHolder = gs.getBallHolder();

        // Disparar si es posible (más agresivo que nivel 2)
        if (ballHolder?.team === this.team && canShoot(ballHolder, gs.board)) {
            const targets = getShootTargets(ballHolder);
            // Nivel 3 elige la casilla del disparo de forma ligeramente más estratégica
            // (elige la esquina de la portería rival en lugar de al azar)
            const target = targets.find(t => t.col === 1 || t.col === 3) ?? targets[1];
            return { pieceId: ballHolder.id, targetRow: target.row, targetCol: target.col };
        }

        // Intentar el movimiento inteligente base
        const smart = this._smartMove(gs);

        // Además: posicionar piezas sin balón para cubrir mejor el campo
        if (!ballHolder || ballHolder.team !== this.team) {
            const myField = gs.getMyPieces(this.team)
                .filter(p => p.type !== PIECE_TYPES.GOALKEEPER && !p.hasBall);

            for (const piece of myField) {
                const moves = getLegalMoves(piece, gs.board, gs.pieces);
                // Buscar casilla que acerque más a la portería rival y al balón
                if (moves.length > 0) {
                    const best = moves
                        .map(m => ({
                            ...m,
                            score: Math.abs(m.row - rivalGoalRow) +
                                (ballHolder
                                    ? Math.abs(m.row - ballHolder.row) + Math.abs(m.col - ballHolder.col)
                                    : 0),
                        }))
                        .sort((a, b) => a.score - b.score)[0];
                    return { pieceId: piece.id, targetRow: best.row, targetCol: best.col };
                }
            }
        }

        return smart ?? this._randomMove(gs);
    }
}
