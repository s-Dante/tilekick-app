// ============================================================
//  TILEKICK — Estado del juego (Game Orchestrator)
//  Exporta: PHASES, clase GameState
// ============================================================

import { Piece, PIECE_TYPES, buildInitialPieces } from './pieces.js';
import { Board } from './board.js';
import {
    getLegalMoves,
    getGoalkeeperSaveMoves,
    canShoot,
    getShootTargets,
    resolveInterception,
    getPassTargets,
} from './movements.js';

// ── Fases del juego ──────────────────────────────────────────

export const PHASES = {
    MOVE: 'move',   // turno normal: el equipo activo mueve, pasa o dispara
    SHOOT: 'shoot',  // (interno, transición instantánea hacia SAVE)
    SAVE: 'save',   // el portero rival elige dónde posicionarse para atajar
    OVER: 'over',   // partida terminada
};

// ── Constantes de partida ────────────────────────────────────

export const GOAL_LIMIT = 5;        // goles para ganar (valor por defecto)
export const TURNS_TO_RESET = 100;   // turnos sin gol → resetear posiciones

// ── Clase GameState ──────────────────────────────────────────

export class GameState {
    /**
     * @param {object} opts
     * @param {string} opts.mapName   — clave de MAP_THEMES
     * @param {string} opts.mode      — 'online' | 'local' | 'ai'
     * @param {number} opts.goalLimit — goles para ganar (por defecto GOAL_LIMIT=5)
     * @param {number} opts.timeSecs  — segundos para la partida (0 = ilimitado)
     */
    constructor({ mapName = 'estadio_clasico', mode = 'online', goalLimit = GOAL_LIMIT, timeSecs = 0 } = {}) {
        this.board = new Board(mapName);
        this.pieces = buildInitialPieces();
        this.mode = mode;
        this.goalLimit = goalLimit;
        this.timeSecs = timeSecs;   // 0 = sin límite de tiempo
        this.turn = 'A';             // equipo que debe actuar
        this.phase = PHASES.MOVE;
        this.score = { A: 0, B: 0 };
        this.selectedId = null;            // id de la pieza seleccionada
        this.legalMoves = [];              // casillas resaltadas para la UI
        this.pendingShot = null;            // { shooterId, targetRow, targetCol }
        this.lastEvent = null;            // texto del último evento (para el log)

        // Contadores de turno
        this.globalTurns = 0;          // turnos totales jugados
        this.turnsWithoutGoal = 0;     // turnos consecutivos sin gol (resetea posiciones)
        this.winner = null;            // 'A' | 'B' cuando la partida termina

        // Para sincronización online: forzar resultado de robo recibido del servidor
        // Se setea externamente antes de commitAction(); se limpia tras usar.
        this._forcedStealSuccess = null;
    }

    // ── Getters de conveniencia ──────────────────────────────

    getPiece(id) {
        return this.pieces.find(p => p.id === id) ?? null;
    }

    getPieceAt(row, col) {
        return this.pieces.find(p => p.row === row && p.col === col) ?? null;
    }

    getBallHolder() {
        return this.pieces.find(p => p.hasBall) ?? null;
    }

    getMyPieces(team) {
        return this.pieces.filter(p => p.team === team);
    }

    isOver() {
        return this.phase === PHASES.OVER;
    }

    // ── SELECCIONAR una pieza ────────────────────────────────

    /**
     * Selecciona una pieza del equipo activo.
     * Calcula y expone sus movimientos legales (+ pase + disparo si aplica).
     *
     * @returns {{ ok, legalMoves?, reason? }}
     */
    selectPiece(pieceId) {
        if (this.phase === PHASES.OVER) {
            return { ok: false, reason: 'Partida terminada' };
        }
        if (this.phase !== PHASES.MOVE) {
            return { ok: false, reason: 'Fase incorrecta' };
        }
        const piece = this.getPiece(pieceId);
        if (!piece) return { ok: false, reason: 'Pieza no encontrada' };
        if (piece.team !== this.turn) return { ok: false, reason: 'No es tu pieza' };

        this.selectedId = pieceId;
        const moves = getLegalMoves(piece, this.board, this.pieces);

        // Pase del balón
        if (piece.hasBall) {
            const passes = getPassTargets(piece, this.pieces);
            moves.push(...passes);
        }

        // Disparo a portería
        if (canShoot(piece, this.board)) {
            const shots = getShootTargets(piece);
            moves.push(...shots);
        }

        this.legalMoves = moves;
        return { ok: true, legalMoves: moves };
    }

    // ── CONFIRMAR acción sobre la casilla seleccionada ───────

    /**
     * Ejecuta la acción correspondiente a la casilla destino.
     * Debe llamarse después de selectPiece().
     *
     * @returns {{ ok, event?, phase?, goal?, saved?, interception?, gameOver?, winner?, reason? }}
     */
    commitAction(targetRow, targetCol) {
        if (!this.selectedId) return { ok: false, reason: 'Ninguna pieza seleccionada' };

        const legal = this.legalMoves.find(
            m => m.row === targetRow && m.col === targetCol
        );
        if (!legal) return { ok: false, reason: 'Movimiento ilegal' };

        const piece = this.getPiece(this.selectedId);
        if (!piece) return { ok: false, reason: 'Pieza no encontrada' };

        if (legal.action === 'shoot') return this._doShoot(piece, targetRow, targetCol);
        if (legal.action === 'pass') return this._doPass(piece, legal.pieceId);
        if (legal.action === 'steal') return this._doSteal(piece, targetRow, targetCol);
        return this._doMove(piece, targetRow, targetCol);
    }

    // ── ATAJAR (turno del portero rival) ─────────────────────

    /**
     * El portero se posiciona en la casilla para atajar el disparo.
     *
     * @returns {{ ok, event?, goal?, saved?, scorer?, score?, gameOver?, winner?, reason? }}
     */
    commitSave(targetRow, targetCol) {
        if (this.phase !== PHASES.SAVE) {
            return { ok: false, reason: 'No estás en la fase de atajada' };
        }

        const gk = this.pieces.find(
            p => p.type === PIECE_TYPES.GOALKEEPER && p.team === this.turn
        );
        if (!gk) return { ok: false, reason: 'Portero no encontrado' };

        const shot = this.pendingShot;

        // Mover portero a la casilla elegida
        gk.col = targetCol;
        gk.row = targetRow;

        const saved = gk.row === shot.targetRow && gk.col === shot.targetCol;

        if (saved) {
            // Atajada → el portero recibe el balón, su equipo continúa
            const shooter = this.getPiece(shot.shooterId);
            if (shooter) shooter.hasBall = false;
            gk.hasBall = true;
            this.lastEvent = `¡Atajada! ${gk.id} detiene el disparo`;
            this.pendingShot = null;
            this.phase = PHASES.MOVE;
            // El turno se queda con el equipo del portero (ya fue seteado en _doShoot)
            this._clearSelection();
            this._incrementTurns(false);
            return { ok: true, event: this.lastEvent, saved: true };
        } else {
            // Gol → contabilizar, reiniciar tablero/piezas y mantener score
            const scoringTeam = gk.team === 'A' ? 'B' : 'A';
            this.score[scoringTeam]++;
            this.lastEvent = `¡GOOOL! Equipo ${scoringTeam} anota • ${this.score.A}–${this.score.B}`;

            const savedScore = { ...this.score };

            // Reiniciar posiciones después de gol (board.reset() conserva el tema)
            this._resetPositions(savedScore);

            this.globalTurns++;
            this.turnsWithoutGoal = 0; // gol = reset del contador

            // Comprobar si alguien ganó
            if (savedScore[scoringTeam] >= this.goalLimit) {
                this.phase = PHASES.OVER;
                this.winner = scoringTeam;
                return {
                    ok: true,
                    event: this.lastEvent,
                    goal: true,
                    scorer: scoringTeam,
                    score: savedScore,
                    gameOver: true,
                    winner: scoringTeam,
                };
            }

            return {
                ok: true,
                event: this.lastEvent,
                goal: true,
                scorer: scoringTeam,
                score: savedScore,
            };
        }
    }

    // ── Acciones privadas ────────────────────────────────────

    _doMove(piece, row, col) {
        piece.stealProtected = false; // al moverse, pierde la protección
        const prevRow = piece.row;
        const prevCol = piece.col;
        piece.row = row;
        piece.col = col;

        // Marcar la casilla anterior como pisada (solo campo, no portería)
        if (!this.board.isGoalArea(prevRow, prevCol)) {
            this.board.stampCell(prevRow, prevCol);
        }

        this.lastEvent = `${piece.id} se movió a (${row},${col})`;
        this._endTurn();
        return { ok: true, event: this.lastEvent };
    }

    _doSteal(piece, row, col) {
        const targetPiece = this.getPieceAt(row, col);
        if (!targetPiece || targetPiece.team === piece.team || !targetPiece.hasBall) {
            return { ok: false, reason: 'No hay rival con balón en esa casilla' };
        }

        // Protección anti-robo: no se puede robar recién tras un robo previo
        if (targetPiece.stealProtected) {
            this.lastEvent = `🛡 ${targetPiece.id} está protegido — no se puede robar de inmediato`;
            this._endTurn();
            return { ok: true, event: this.lastEvent, interception: { success: false, probability: 0, protected: true } };
        }

        const result = resolveInterception(piece, targetPiece);

        // Si hay un resultado forzado (recibido via sync online), respetarlo.
        // Esto garantiza que ambos clientes apliquen exactamente el mismo resultado.
        if (this._forcedStealSuccess !== null && this._forcedStealSuccess !== undefined) {
            result.success = this._forcedStealSuccess;
            this._forcedStealSuccess = null; // limpiar tras usar
        }

        if (result.success) {
            targetPiece.hasBall = false;
            targetPiece.stealProtected = false; // ya no tiene el balón
            piece.hasBall = true;
            piece.stealProtected = true;        // protección de 1 turno para quien acaba de robar
            this.lastEvent = `⚡ Robo exitoso (${result.probability}%) — ¡${piece.id} roba el balón a ${targetPiece.id}!`;
        } else {
            this.lastEvent = `✋ Robo fallido (${result.probability}%) — ${targetPiece.id} conserva el balón`;
        }
        this._endTurn();
        return { ok: true, event: this.lastEvent, interception: result };
    }

    _doShoot(piece, goalRow, goalCol) {
        piece.stealProtected = false; // disparar cancela la protección
        this.pendingShot = { shooterId: piece.id, targetRow: goalRow, targetCol: goalCol };
        this.lastEvent = `¡Disparo! ${piece.id} apunta a (${goalRow},${goalCol})`;

        // Cambiar al equipo rival para que atajen
        this.turn = piece.team === 'A' ? 'B' : 'A';
        this.phase = PHASES.SAVE;

        // Pre-seleccionar el portero rival con sus casillas para atajar
        const gk = this.pieces.find(
            p => p.type === PIECE_TYPES.GOALKEEPER && p.team === this.turn
        );
        this.selectedId = gk?.id ?? null;
        this.legalMoves = gk ? getGoalkeeperSaveMoves(gk) : [];

        return { ok: true, event: this.lastEvent, phase: PHASES.SAVE };
    }

    _doPass(piece, targetId) {
        const target = this.getPiece(targetId);
        if (!target) return { ok: false, reason: 'Compañero no encontrado' };

        piece.stealProtected = false; // pasar cancela la protección propia
        piece.hasBall = false;
        target.hasBall = true;
        this.lastEvent = `${piece.id} pasa el balón a ${target.id}`;
        this._endTurn();
        return { ok: true, event: this.lastEvent, pass: true };
    }

    // ── Helpers internos ─────────────────────────────────────

    _endTurn() {
        this._clearSelection();
        this.turn = this.turn === 'A' ? 'B' : 'A';
        this.phase = PHASES.MOVE;
        this._incrementTurns(true);
    }

    /**
     * Incrementa contadores de turno.
     * @param {boolean} checkReset - Si debe comprobar el reset de 30 turnos
     */
    _incrementTurns(checkReset) {
        this.globalTurns++;
        this.turnsWithoutGoal++;

        if (checkReset && this.turnsWithoutGoal >= TURNS_TO_RESET) {
            const savedScore = { ...this.score };
            this._resetPositions(savedScore);
            this.turnsWithoutGoal = 0;
            this.lastEvent = (this.lastEvent ? this.lastEvent + ' — ' : '') +
                `⏱ ¡Reinicio! (${TURNS_TO_RESET} turnos sin gol)`;
        }
    }

    _resetPositions(score) {
        // buildInitialPieces() ya crea piezas sin protección (stealProtected=false por defecto).
        // Usamos board.reset() para conservar el tema/mapa visual;
        // crear new Board() con el string del tema causaría selección aleatoria de mapa.
        this.board.reset();
        this.pieces = buildInitialPieces();
        this.pendingShot = null;
        this.turn = 'A';
        this.phase = PHASES.MOVE;
        this.score = score;
        this._clearSelection();
    }

    _clearSelection() {
        this.selectedId = null;
        this.legalMoves = [];
    }

    // ── Serialización (para socket.io en modo online) ─────────

    toJSON() {
        return {
            board: this.board.toJSON(),
            pieces: this.pieces.map(p => p.toJSON()),
            mode: this.mode,
            goalLimit: this.goalLimit,
            timeSecs: this.timeSecs,
            turn: this.turn,
            phase: this.phase,
            score: this.score,
            selectedId: this.selectedId,
            legalMoves: this.legalMoves,
            pendingShot: this.pendingShot,
            lastEvent: this.lastEvent,
            globalTurns: this.globalTurns,
            turnsWithoutGoal: this.turnsWithoutGoal,
            winner: this.winner,
        };
    }

    static fromJSON(data) {
        const gs = new GameState({
            mapName: data.board.theme,
            mode: data.mode,
            goalLimit: data.goalLimit ?? GOAL_LIMIT,
            timeSecs: data.timeSecs ?? 0,
        });
        gs.board = Board.fromJSON(data.board);
        gs.pieces = data.pieces.map(p => Piece.fromJSON(p));
        gs.turn = data.turn;
        gs.phase = data.phase;
        gs.score = data.score;
        gs.selectedId = data.selectedId;
        gs.legalMoves = data.legalMoves;
        gs.pendingShot = data.pendingShot;
        gs.lastEvent = data.lastEvent;
        gs.globalTurns = data.globalTurns ?? 0;
        gs.turnsWithoutGoal = data.turnsWithoutGoal ?? 0;
        gs.winner = data.winner ?? null;
        return gs;
    }
}
