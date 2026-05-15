// ============================================================
//  TILEKICK — Renderer 2D (Canvas API)
//  Clase: Renderer2D
//
//  Interacción: Drag & Drop con soporte táctil
//  Flip de tablero: Team A siempre aparece en la parte inferior
//
//  Importar como módulo ES en el HTML:
//    import { Renderer2D } from '/js/game/renderer2d.js';
// ============================================================

// ── Constantes de color ──────────────────────────────────────

const TEAM_COLORS = {
    A: {
        fill:     '#0d9488',
        stroke:   '#14b8a6',
        text:     '#f0efe9',
        darkFill: '#053d38',    // relleno oscuro para piezas rivales
        glow:     'rgba(13, 148, 136, 0.22)',  // halo piezas propias
    },
    B: {
        fill:     '#65713a',
        stroke:   '#7e8e48',
        text:     '#f0efe9',
        darkFill: '#2a2f17',
        glow:     'rgba(101, 113, 58, 0.22)',
    },
};

// Fondo del canvas según tema del mapa
const THEME_BG = {
    grass:  '#071a0c',   // verde oscuro profundo
    sand:   '#1a1005',   // marrón cálido oscuro
    cement: '#0c0e14',   // azul gris oscuro
};

// Color del halo de "tu zona" en el lado inferior del tablero
const THEME_ZONE = {
    A: 'rgba(13, 148, 136, 0.10)',   // teal suave
    B: 'rgba(101, 113, 58, 0.10)',   // olive suave
};

const ACTION_COLORS = {
    move:  { overlay: 'rgba(13, 148, 136, 0.35)',  dot: '#0d9488' },
    shoot: { overlay: 'rgba(239, 68, 68, 0.35)',   dot: '#ef4444' },
    pass:  { overlay: 'rgba(99, 102, 241, 0.35)',  dot: '#6366f1' },
    steal: { overlay: 'rgba(251, 146, 60, 0.45)',  dot: '#f97316' },
};

export class Renderer2D {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {GameState}         gameState
     * @param {object}            opts
     * @param {string}            opts.myTeam    — 'A' | 'B' | null (local)
     * @param {Function}          opts.onAction  — llamada tras cada acción exitosa
     * @param {Function}          opts.onLog     — llamada para añadir texto al log
     */
    constructor(canvas, gameState, { myTeam = null, onAction = null, onLog = null } = {}) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d');
        this.gs = gameState;
        this.myTeam = myTeam;   // null = modo local
        this.onAction = onAction;
        this.onLog = onLog;

        // Estado del drag
        this.dragging = null; // { piece, currentX, currentY }

        // Bloqueo (ej. durante turno IA)
        this.locked = false;

        // Layout
        this.cellSize = 0;
        this.offsetX = 0;
        this.offsetY = 0;

        this._resize();
        this._bindEvents();
        window.addEventListener('resize', () => this._resize());
    }

    // ── Flip del tablero ──────────────────────────────────────
    //
    // Regla: Team A y modo local → tablero invertido (fila 0 abajo, fila 9 arriba).
    //        Team B (online)     → sin invertir (fila 9 abajo = B's territory at bottom).
    //
    // Esto hace que siempre veas tus piezas en la parte inferior.

    get _flipBoard() {
        return this.myTeam !== 'B';
    }

    /** Convierte fila lógica → fila de display */
    _toDisplayRow(logicalRow) {
        return this._flipBoard ? (9 - logicalRow) : logicalRow;
    }

    /** Convierte fila de display → fila lógica */
    _toLogicalRow(displayRow) {
        return this._flipBoard ? (9 - displayRow) : displayRow;
    }

    // ── Layout ───────────────────────────────────────────────

    _resize() {
        this.canvas.width = this.canvas.parentElement.clientWidth || 600;
        this.canvas.height = this.canvas.parentElement.clientHeight || 700;
        this._computeLayout();
        this.render();
    }

    _computeLayout() {
        const maxW = Math.floor(this.canvas.width / 5);
        const maxH = Math.floor(this.canvas.height / 10);
        this.cellSize = Math.min(maxW, maxH, 72);
        this.offsetX = Math.floor((this.canvas.width - this.cellSize * 5) / 2);
        this.offsetY = Math.floor((this.canvas.height - this.cellSize * 10) / 2);
    }

    // ── Render principal ──────────────────────────────────────

    render() {
        const { ctx } = this;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // Fondo theme-aware
        const theme = this.gs.board?.theme ?? 'grass';
        ctx.fillStyle = THEME_BG[theme] ?? THEME_BG.grass;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

        this._drawBoard();
        this._drawYourZone();   // halo de territorio propio
        this._drawHighlights();
        this._drawPieces();
        if (this.dragging) this._drawDragPiece();
    }

    // ── Tu zona (gradiente de territorio) ────────────────────
    //
    // En modos online/IA muestra un suave gradiente en la mitad
    // inferior del tablero (donde siempre están tus piezas)
    // para marcar visualmente tu territorio.

    _drawYourZone() {
        if (this.myTeam === null) return; // local: no aplica

        const { ctx, cellSize, offsetX, offsetY } = this;
        const boardH = cellSize * 10;
        const boardW = cellSize * 5;
        const zoneH  = cellSize * 3.5; // últimas 3.5 filas = tu zona

        // Siempre en la parte INFERIOR del canvas (las piezas propias siempre abajo)
        const grd = ctx.createLinearGradient(
            0, offsetY + boardH - zoneH,
            0, offsetY + boardH
        );
        const zoneColor = THEME_ZONE[this.myTeam] ?? THEME_ZONE.A;
        grd.addColorStop(0, 'transparent');
        grd.addColorStop(1, zoneColor);

        ctx.fillStyle = grd;
        ctx.fillRect(offsetX, offsetY + boardH - zoneH, boardW, zoneH);

        // Línea de mediocampo — separador visual entre zonas
        const midY = offsetY + cellSize * 5;
        ctx.beginPath();
        ctx.moveTo(offsetX, midY);
        ctx.lineTo(offsetX + boardW, midY);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // ── Tablero ───────────────────────────────────────────────

    _drawBoard() {
        const { ctx, cellSize, offsetX, offsetY } = this;
        const board = this.gs.board;

        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 5; col++) {
                if (!board.isOnBoard(row, col)) continue;

                const dispRow = this._toDisplayRow(row);
                const x = offsetX + col * cellSize;
                const y = offsetY + dispRow * cellSize;
                const color = board.getCellColor(row, col);
                const level = board.getLevel(row, col);

                // Fondo de la casilla
                ctx.fillStyle = color;
                ctx.fillRect(x, y, cellSize, cellSize);

                // Efecto de hundimiento en casillas pisadas
                if (level > 0) {
                    ctx.fillStyle = `rgba(0, 0, 0, ${level * 0.14})`;
                    ctx.fillRect(x + 2, y + 2, cellSize - 4, cellSize - 4);
                }

                // Casilla impasable (nivel 3): patrón diagonal
                if (level >= 3) {
                    ctx.fillStyle = 'rgba(0,0,0,0.45)';
                    ctx.fillRect(x, y, cellSize, cellSize);
                    ctx.strokeStyle = 'rgba(255,100,100,0.3)';
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(x, y); ctx.lineTo(x + cellSize, y + cellSize);
                    ctx.moveTo(x + cellSize, y); ctx.lineTo(x, y + cellSize);
                    ctx.stroke();
                }

                // Borde de la casilla
                ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
                ctx.lineWidth = 1;
                ctx.strokeRect(x, y, cellSize, cellSize);

                // Indicador de portería
                if (board.isGoalArea(row, col)) {
                    ctx.strokeStyle = 'rgba(244, 243, 238, 0.4)';
                    ctx.lineWidth = 2;
                    ctx.strokeRect(x + 3, y + 3, cellSize - 6, cellSize - 6);
                }
            }
        }
    }

    // ── Resaltados de movimientos ─────────────────────────────

    _drawHighlights() {
        const { ctx, cellSize, offsetX, offsetY } = this;

        for (const move of this.gs.legalMoves) {
            const dispRow = this._toDisplayRow(move.row);
            const x = offsetX + move.col * cellSize;
            const y = offsetY + dispRow * cellSize;
            const key = move.action ?? 'move';
            const col = ACTION_COLORS[key] ?? ACTION_COLORS.move;

            // Overlay semitransparente
            ctx.fillStyle = col.overlay;
            ctx.fillRect(x, y, cellSize, cellSize);

            // Punto central
            ctx.beginPath();
            ctx.arc(x + cellSize / 2, y + cellSize / 2, 5, 0, Math.PI * 2);
            ctx.fillStyle = col.dot;
            ctx.fill();
        }
    }

    // ── Piezas ───────────────────────────────────────────────

    _drawPieces() {
        for (const piece of this.gs.pieces) {
            if (this.dragging?.piece.id === piece.id) continue;

            const dispRow = this._toDisplayRow(piece.row);
            const x = this.offsetX + piece.col * this.cellSize + this.cellSize / 2;
            const y = this.offsetY + dispRow * this.cellSize + this.cellSize / 2;
            const r = this.cellSize * 0.36;
            const sel = piece.id === this.gs.selectedId;
            this._drawPieceAt(x, y, r, piece, sel);
        }
    }

    _drawPieceAt(x, y, r, piece, selected = false) {
        const { ctx } = this;
        const isOnlineMode = this.myTeam !== null;       // online o IA
        const isOwn = !isOnlineMode || piece.team === this.myTeam;
        const colors = TEAM_COLORS[piece.team];

        // ── 1. Halo de pieza propia ────────────────────────────
        // En modo online/IA, las piezas propias tienen un resplandor
        // suave para diferenciarse claramente de las rivales.
        if (isOwn && isOnlineMode) {
            const halo = ctx.createRadialGradient(x, y, r * 0.5, x, y, r + 9);
            halo.addColorStop(0, colors.glow);
            halo.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.beginPath();
            ctx.arc(x, y, r + 9, 0, Math.PI * 2);
            ctx.fillStyle = halo;
            ctx.fill();
        }

        // ── 2. Anillo exterior rival (dashed rojo) ─────────────
        // Las piezas rivales en online/IA llevan un anillo
        // discontinuo de advertencia para identificarlas de un vistazo.
        if (!isOwn && isOnlineMode) {
            ctx.beginPath();
            ctx.arc(x, y, r + 4, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
            ctx.lineWidth = 1.5;
            ctx.setLineDash([3, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // ── 3. Anillo de selección ─────────────────────────────
        if (selected && isOwn) {
            ctx.beginPath();
            ctx.arc(x, y, r + 6, 0, Math.PI * 2);
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 2.5;
            ctx.stroke();
        }

        // ── 4. Cuerpo principal ────────────────────────────────
        ctx.globalAlpha = isOwn ? 1.0 : 0.78;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);

        if (!isOwn && isOnlineMode) {
            // Rival: relleno más oscuro y opaco para parecer "amenaza"
            ctx.fillStyle = colors.darkFill;
        } else {
            ctx.fillStyle = colors.fill;
        }
        ctx.fill();

        // Borde
        ctx.strokeStyle = isOwn
            ? colors.stroke
            : (isOnlineMode ? 'rgba(239, 68, 68, 0.5)' : '#555');
        ctx.lineWidth = isOwn ? 2.5 : 1.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // ── 5. Indicador sobre la pieza ────────────────────────
        const iconSize = Math.max(9, Math.round(r * 0.46));
        ctx.font = `${iconSize}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (isOnlineMode && isOwn) {
            // Propia: estrella dorada
            ctx.fillStyle = '#fbbf24';
            ctx.fillText('★', x, y - r - 7);
        } else if (isOnlineMode && !isOwn) {
            // Rival: cruz roja muy sutil (no hostil, solo orientativo)
            ctx.globalAlpha = 0.65;
            ctx.fillStyle = '#f87171';
            ctx.fillText('✕', x, y - r - 7);
            ctx.globalAlpha = 1;
        }

        // ── 6. Indicador del balón ─────────────────────────────
        if (piece.hasBall) {
            ctx.beginPath();
            ctx.arc(x + r * 0.55, y - r * 0.55, r * 0.28, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.strokeStyle = '#aaaaaa';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // ── 7. Etiqueta tipo de pieza ──────────────────────────
        ctx.globalAlpha = isOwn ? 1 : 0.78;
        ctx.fillStyle = colors.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `bold ${Math.max(9, Math.round(r * 0.52))}px Inter, system-ui, sans-serif`;
        ctx.fillText(piece.label, x, y);
        ctx.globalAlpha = 1;
    }

    _drawDragPiece() {
        const { piece, currentX, currentY } = this.dragging;
        const r = this.cellSize * 0.36;
        this.ctx.globalAlpha = 0.85;
        this._drawPieceAt(currentX, currentY, r, piece, false);
        this.ctx.globalAlpha = 1;
    }

    // ── Eventos de input ──────────────────────────────────────

    _bindEvents() {
        const c = this.canvas;
        c.addEventListener('mousedown',  e => this._onDown(this._canvasPos(e)));
        c.addEventListener('mousemove',  e => this._onMove(this._canvasPos(e)));
        c.addEventListener('mouseup',    e => this._onUp(this._canvasPos(e)));
        c.addEventListener('touchstart', e => { e.preventDefault(); this._onDown(this._touchPos(e)); }, { passive: false });
        c.addEventListener('touchmove',  e => { e.preventDefault(); this._onMove(this._touchPos(e)); }, { passive: false });
        c.addEventListener('touchend',   e => { e.preventDefault(); this._onUp(this._touchPos(e)); }, { passive: false });
    }

    _canvasPos(e) {
        const r = this.canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _touchPos(e) {
        const t = (e.touches[0] ?? e.changedTouches[0]);
        const r = this.canvas.getBoundingClientRect();
        return { x: t.clientX - r.left, y: t.clientY - r.top };
    }

    _screenToCell({ x, y }) {
        const displayRow = Math.floor((y - this.offsetY) / this.cellSize);
        const col = Math.floor((x - this.offsetX) / this.cellSize);
        const row = this._toLogicalRow(displayRow);
        return { row, col };
    }

    _onDown({ x, y }) {
        if (this.locked) return;
        const gs = this.gs;
        const { row, col } = this._screenToCell({ x, y });

        // Fase SAVE → el portero elige dónde posicionarse
        if (gs.phase === 'save') {
            if (this.myTeam !== null && gs.turn !== this.myTeam) return;
            const legal = gs.legalMoves.find(m => m.row === row && m.col === col);
            if (legal) {
                const result = gs.commitSave(row, col);
                if (result.ok) {
                    result._sync = { type: 'commit-save', targetRow: row, targetCol: col };
                    this.onLog?.(result.event);
                    this.onAction?.(result);
                }
            }
            this.render();
            return;
        }

        // Fase MOVE → seleccionar pieza del equipo activo
        const piece = gs.getPieceAt(row, col);
        if (piece && piece.team === gs.turn) {
            // En modo online, solo actúas si es tu turno
            if (this.myTeam !== null && piece.team !== this.myTeam) return;

            const result = gs.selectPiece(piece.id);
            if (result.ok) {
                this.dragging = { piece, currentX: x, currentY: y };
            }
        }
        this.render();
    }

    _onMove({ x, y }) {
        if (!this.dragging) return;
        this.dragging.currentX = x;
        this.dragging.currentY = y;
        this.render();
    }

    _onUp({ x, y }) {
        if (!this.dragging) return;

        const pieceId = this.dragging.piece.id;
        const { row, col } = this._screenToCell({ x, y });
        const result = this.gs.commitAction(row, col);

        if (result.ok) {
            // Incluir stealSuccess en el sync para que el oponente aplique
            // exactamente el mismo resultado (evita divergencia por Math.random)
            result._sync = {
                type: 'select-commit',
                pieceId,
                targetRow: row,
                targetCol: col,
                ...(result.interception !== undefined ? { stealSuccess: result.interception.success } : {}),
            };
            this.onLog?.(result.event);
            this.onAction?.(result);
        }

        this.dragging = null;
        this.render();
    }
}
