// ============================================================
//  TILEKICK — IA del Jugador Autónomo
//  Exporta: AI_LEVELS, clase AIPlayer
//
//  Nivel 1 (EASY)   — Movimientos casi aleatorios, portero poco preciso
//  Nivel 2 (MEDIUM) — Prioriza disparo > robo > pase adelantado > avanzar
//                     Portero acierta ~70% de atajadas
//  Nivel 3 (HARD)   — Táctico: esquinas, defensa activa, bloqueo de ruta
//                     Portero acierta ~90% de atajadas
// ============================================================

import { PIECE_TYPES } from './pieces.js';
import {
    getLegalMoves,
    getGoalkeeperSaveMoves,
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

    // ── API pública ──────────────────────────────────────────

    /**
     * Calcula la próxima acción de movimiento de la IA.
     * @param {GameState} gs
     * @returns {{ pieceId, targetRow, targetCol } | null}
     */
    computeMove(gs) {
        switch (this.level) {
            case AI_LEVELS.EASY:   return this._easyMove(gs);
            case AI_LEVELS.MEDIUM: return this._mediumMove(gs);
            case AI_LEVELS.HARD:   return this._hardMove(gs);
            default:               return this._randomMove(gs);
        }
    }

    /**
     * Calcula dónde colocar el portero para atajar el disparo.
     * Llama a esto cuando gs.phase === 'save' y gs.turn === this.team.
     *
     * @param {GameState} gs
     * @returns {{ row, col }}
     */
    computeSave(gs) {
        const shot = gs.pendingShot;
        const gk = gs.pieces.find(
            p => p.type === PIECE_TYPES.GOALKEEPER && p.team === this.team
        );
        const goalRow = gk ? gk.row : (this.team === 'A' ? 0 : 9);
        const saveCols = [1, 2, 3];

        if (!shot) {
            // Sin información de disparo → aleatoria
            return { row: goalRow, col: saveCols[Math.floor(Math.random() * 3)] };
        }

        const correctCol = shot.targetCol;

        if (this.level === AI_LEVELS.EASY) {
            // Portero fácil: completamente aleatorio (33% de acierto)
            return { row: goalRow, col: saveCols[Math.floor(Math.random() * 3)] };
        }

        if (this.level === AI_LEVELS.MEDIUM) {
            // Portero medio: 65% va al lugar correcto, 35% falla por 1 casilla
            const roll = Math.random();
            if (roll < 0.65) {
                return { row: goalRow, col: correctCol };
            }
            // Elige aleatoriamente entre las otras 2 columnas
            const others = saveCols.filter(c => c !== correctCol);
            return { row: goalRow, col: others[Math.floor(Math.random() * others.length)] };
        }

        // HARD: 88% preciso, 12% falla por 1 columna
        if (Math.random() < 0.88) {
            return { row: goalRow, col: correctCol };
        }
        const others = saveCols.filter(c => c !== correctCol);
        return { row: goalRow, col: others[Math.floor(Math.random() * others.length)] };
    }

    // ── Nivel 1: Fácil ───────────────────────────────────────
    // 80% aleatorio; 20% de las veces dispara si puede

    _easyMove(gs) {
        const ballHolder = gs.getBallHolder();

        // 20% de probabilidad de intentar disparo (si tiene el balón y puede)
        if (ballHolder?.team === this.team && canShoot(ballHolder, gs.board) && Math.random() < 0.20) {
            const targets = getShootTargets(ballHolder);
            if (targets.length > 0) {
                const t = targets[Math.floor(Math.random() * targets.length)];
                return { pieceId: ballHolder.id, targetRow: t.row, targetCol: t.col };
            }
        }

        return this._randomMove(gs);
    }

    // ── Nivel 2: Medio ───────────────────────────────────────
    // Cadena de prioridades:
    //   1. Disparo si tiene balón en zona de tiro
    //   2. Robo si hay un rival con balón adyacente (elige mejor atacante)
    //   3. Pase al compañero más adelantado
    //   4. Avanzar con balón hacia portería rival
    //   5. Mover pieza más cercana al balón
    //   6. Aleatorio

    _mediumMove(gs) {
        const ballHolder = gs.getBallHolder();
        const rivalGoalRow = this.team === 'A' ? 9 : 0;

        // 1. Disparo
        const shoot = this._tryShoot(gs, ballHolder, false);
        if (shoot) return shoot;

        // 2. Robo de balón
        const steal = this._tryBestSteal(gs);
        if (steal) return steal;

        // 3. Pase adelantado
        if (ballHolder?.team === this.team) {
            const pass = this._tryPassForward(gs, ballHolder, rivalGoalRow);
            if (pass) return pass;
        }

        // 4. Avanzar con balón
        if (ballHolder?.team === this.team) {
            const advance = this._tryAdvanceBall(gs, ballHolder, rivalGoalRow);
            if (advance) return advance;
        }

        // 5. Mover pieza más cercana al balón (presión o soporte)
        const pressure = this._tryPressure(gs, ballHolder);
        if (pressure) return pressure;

        return this._randomMove(gs);
    }

    // ── Nivel 3: Difícil ─────────────────────────────────────
    // Cadena de prioridades:
    //   1. Disparo a esquinas (más difícil de atajar)
    //   2. Robo agresivo (preferir delanteros)
    //   3. Defensa de emergencia: si rival está en zona de tiro, bloquear
    //   4. Pase adelantado
    //   5. Avanzar con balón
    //   6. Posicionamiento defensivo entre rival y nuestra portería
    //   7. Presionar al portador del balón
    //   8. Aleatorio

    _hardMove(gs) {
        const ballHolder = gs.getBallHolder();
        const rivalGoalRow = this.team === 'A' ? 9 : 0;
        const myGoalRow = this.team === 'A' ? 0 : 9;

        // 1. Disparo estratégico a esquinas
        const shoot = this._tryShoot(gs, ballHolder, true);
        if (shoot) return shoot;

        // 2. Robo agresivo
        const steal = this._tryBestSteal(gs);
        if (steal) return steal;

        // 3. Defensa de emergencia: rival en nuestra zona de tiro con el balón
        if (ballHolder && ballHolder.team !== this.team) {
            const dangerRows = this.team === 'A' ? [1, 2] : [7, 8]; // zona de tiro rival
            if (dangerRows.includes(ballHolder.row)) {
                const block = this._tryBlockThreat(gs, ballHolder);
                if (block) return block;
            }
        }

        // 4. Pase adelantado
        if (ballHolder?.team === this.team) {
            const pass = this._tryPassForward(gs, ballHolder, rivalGoalRow);
            if (pass) return pass;
        }

        // 5. Avanzar con balón
        if (ballHolder?.team === this.team) {
            const advance = this._tryAdvanceBall(gs, ballHolder, rivalGoalRow);
            if (advance) return advance;
        }

        // 6. Posicionamiento defensivo (sin balón)
        if (!ballHolder || ballHolder.team !== this.team) {
            const defend = this._tryDefend(gs, ballHolder, myGoalRow);
            if (defend) return defend;
        }

        // 7. Presionar al portador
        const pressure = this._tryPressure(gs, ballHolder);
        if (pressure) return pressure;

        return this._randomMove(gs);
    }

    // ── Helpers de acción ────────────────────────────────────

    /**
     * Dispara si el portador del balón está en zona de tiro.
     * @param {boolean} preferCorners — HARD=true elige columnas 1 o 3
     */
    _tryShoot(gs, ballHolder, preferCorners) {
        if (!ballHolder || ballHolder.team !== this.team) return null;
        if (!canShoot(ballHolder, gs.board)) return null;

        const targets = getShootTargets(ballHolder);
        if (targets.length === 0) return null;

        let target;
        if (preferCorners) {
            // Preferir esquinas (col 1 o 3) por ser más difíciles de atajar
            const corners = targets.filter(t => t.col === 1 || t.col === 3);
            target = corners.length > 0
                ? corners[Math.floor(Math.random() * corners.length)]
                : targets[Math.floor(Math.random() * targets.length)];
        } else {
            target = targets[Math.floor(Math.random() * targets.length)];
        }

        return { pieceId: ballHolder.id, targetRow: target.row, targetCol: target.col };
    }

    /**
     * Intenta robar el balón con la pieza con mejor stat de ataque.
     * Solo actúa si hay un rival con balón adyacente a alguna de nuestras piezas.
     */
    _tryBestSteal(gs) {
        const rival = gs.pieces.find(p => p.team !== this.team && p.hasBall);
        if (!rival) return null;

        // Buscar nuestras piezas que tienen al rival en movimientos legales (steal)
        const myPieces = gs.getMyPieces(this.team)
            .filter(p => p.type !== PIECE_TYPES.GOALKEEPER);

        let bestStealer = null;
        let bestAtk = -1;

        for (const piece of myPieces) {
            const moves = getLegalMoves(piece, gs.board, gs.pieces);
            const stealMove = moves.find(
                m => m.action === 'steal' && m.row === rival.row && m.col === rival.col
            );
            if (stealMove && piece.stats.atk > bestAtk) {
                bestAtk = piece.stats.atk;
                bestStealer = { pieceId: piece.id, targetRow: rival.row, targetCol: rival.col };
            }
        }

        return bestStealer;
    }

    /**
     * Pasa el balón al compañero más cercano a la portería rival (si está más adelantado).
     */
    _tryPassForward(gs, ballHolder, rivalGoalRow) {
        const passes = getPassTargets(ballHolder, gs.pieces);
        if (passes.length === 0) return null;

        const holderDist = Math.abs(ballHolder.row - rivalGoalRow);
        const best = passes
            .map(p => ({ ...p, dist: Math.abs(p.row - rivalGoalRow) }))
            .filter(p => p.dist < holderDist) // solo si está más adelantado
            .sort((a, b) => a.dist - b.dist)[0];

        if (!best) return null;
        return { pieceId: ballHolder.id, targetRow: best.row, targetCol: best.col };
    }

    /**
     * Avanza con el balón hacia la portería rival (la casilla más cercana al goal).
     */
    _tryAdvanceBall(gs, ballHolder, rivalGoalRow) {
        const moves = getLegalMoves(ballHolder, gs.board, gs.pieces);
        if (moves.length === 0) return null;

        const regularMoves = moves.filter(m => !m.action); // no robo/pase/disparo
        if (regularMoves.length === 0) return null;

        const best = regularMoves
            .map(m => ({ ...m, dist: Math.abs(m.row - rivalGoalRow) }))
            .sort((a, b) => a.dist - b.dist)[0];

        return { pieceId: ballHolder.id, targetRow: best.row, targetCol: best.col };
    }

    /**
     * Mueve la pieza no-portero más cercana al portador del balón rival.
     */
    _tryPressure(gs, ballHolder) {
        if (!ballHolder) return this._randomMove(gs);

        const myPieces = gs.getMyPieces(this.team)
            .filter(p => p.type !== PIECE_TYPES.GOALKEEPER && !p.hasBall)
            .map(p => ({
                piece: p,
                dist: Math.abs(p.row - ballHolder.row) + Math.abs(p.col - ballHolder.col),
            }))
            .sort((a, b) => a.dist - b.dist);

        for (const { piece } of myPieces) {
            const moves = getLegalMoves(piece, gs.board, gs.pieces);
            const regularMoves = moves.filter(m => !m.action);
            if (regularMoves.length === 0) continue;

            const best = regularMoves
                .map(m => ({
                    ...m,
                    dist: Math.abs(m.row - ballHolder.row) + Math.abs(m.col - ballHolder.col),
                }))
                .sort((a, b) => a.dist - b.dist)[0];

            return { pieceId: piece.id, targetRow: best.row, targetCol: best.col };
        }
        return null;
    }

    /**
     * Bloquea una amenaza rival: mueve la pieza más cercana entre el rival y nuestra portería.
     */
    _tryBlockThreat(gs, threatPiece) {
        const myGoalRow = this.team === 'A' ? 0 : 9;
        const myPieces = gs.getMyPieces(this.team)
            .filter(p => p.type !== PIECE_TYPES.GOALKEEPER);

        // Pieza más cercana a la amenaza
        const closest = myPieces
            .map(p => ({
                piece: p,
                dist: Math.abs(p.row - threatPiece.row) + Math.abs(p.col - threatPiece.col),
            }))
            .sort((a, b) => a.dist - b.dist)[0];

        if (!closest) return null;

        const moves = getLegalMoves(closest.piece, gs.board, gs.pieces);
        const stealMoves = moves.filter(m => m.action === 'steal');
        if (stealMoves.length > 0) {
            // Ya puede robar directamente
            return { pieceId: closest.piece.id, targetRow: stealMoves[0].row, targetCol: stealMoves[0].col };
        }

        const regularMoves = moves.filter(m => !m.action);
        if (regularMoves.length === 0) return null;

        // Moverse entre la amenaza y nuestra portería
        const best = regularMoves
            .map(m => ({
                ...m,
                dist: Math.abs(m.row - threatPiece.row) + Math.abs(m.col - threatPiece.col),
            }))
            .sort((a, b) => a.dist - b.dist)[0];

        return { pieceId: closest.piece.id, targetRow: best.row, targetCol: best.col };
    }

    /**
     * Posiciona piezas defensivamente entre el balón y nuestra portería.
     */
    _tryDefend(gs, ballHolder, myGoalRow) {
        if (!ballHolder) return null;

        const myPieces = gs.getMyPieces(this.team)
            .filter(p => p.type !== PIECE_TYPES.GOALKEEPER && !p.hasBall);

        // Buscar la pieza más lejos de nuestra portería (más avanzada en campo rival)
        // y traerla de vuelta a posición defensiva
        const sorted = myPieces
            .map(p => ({
                piece: p,
                distToGoal: Math.abs(p.row - myGoalRow),
            }))
            .sort((a, b) => b.distToGoal - a.distToGoal); // más lejos primero

        for (const { piece } of sorted) {
            const moves = getLegalMoves(piece, gs.board, gs.pieces);
            const regularMoves = moves.filter(m => !m.action);
            if (regularMoves.length === 0) continue;

            // Moverse hacia el punto medio entre el balón y nuestra portería
            const targetRow = Math.round((ballHolder.row + myGoalRow) / 2);
            const best = regularMoves
                .map(m => ({ ...m, dist: Math.abs(m.row - targetRow) + Math.abs(m.col - ballHolder.col) }))
                .sort((a, b) => a.dist - b.dist)[0];

            return { pieceId: piece.id, targetRow: best.row, targetCol: best.col };
        }
        return null;
    }

    // ── Fallback: Aleatorio ──────────────────────────────────

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
}
