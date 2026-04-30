// ============================================================
//  TILEKICK — Tablero de juego
//  Exporta: ROWS, COLS, LEVELS, MAP_THEMES, clase Board
// ============================================================

export const ROWS = 10;
export const COLS = 5;
export const LEVELS = 3;   // 0 = sin pisar · 1 = pisado 1 vez · 2 = pisado 2 veces · 3 = pisado 3 veces (impasable)

// ──────────────────────────────────────────────────────────────
//  Mapeo nombre-de-mapa → tema visual
// ──────────────────────────────────────────────────────────────

export const MAP_THEMES = {
    estadio_clasico: 'grass',
    arena_nocturna: 'sand',
    campo_playa: 'cement',
    aleatorio: null,    // Se elige al azar en tiempo de ejecución
};

const ALL_THEMES = ['grass', 'sand', 'cement'];

// ──────────────────────────────────────────────────────────────
//  Paletas de colores por tema y nivel de profundidad
//
//  Cada nivel tiene [colorOscuro, colorClaro] → se alternan en
//  patrón de ajedrez según la paridad de (row + col).
//
//  Diseño por tema:
//
//  grass  → pasto. El verde se desatura conforme la casilla se hunde.
//  sand   → arena dorada. Se oscurece al hundirse.
//  cement → cemento gris. Se oscurece al hundirse.
// ──────────────────────────────────────────────────────────────

const MAP_COLORS = {
    grass: {
        goal: '#e8e8e0',                   // portería: blanco cálido
        level0: ['#22c55e', '#4ade80'],      // verde vivo  (sin pisar)
        level1: ['#16a34a', '#22c55e'],      // verde medio (pisado 1 vez)
        level2: ['#14532d', '#166534'],      // verde oscuro (pisado 2 veces)
        level3: ['#14532d', '#166534'],      // verde muy oscuro (pisado 3 veces impasable)
    },
    sand: {
        goal: '#e8e8e0',
        level0: ['#ca8a04', '#eab308'],      // arena dorada viva
        level1: ['#a16207', '#ca8a04'],      // arena oscura
        level2: ['#78350f', '#92400e'],      // arena muy oscura
        level3: ['#14532d', '#166534'],      // arena muy oscura (pisado 3 veces impasable)|
    },
    cement: {
        goal: '#e8e8e0',
        level0: ['#6b7280', '#9ca3af'],      // gris claro
        level1: ['#4b5563', '#6b7280'],      // gris oscuro
        level2: ['#1f2937', '#374151'],      // casi negro
        level3: ['#14532d', '#166534'],      // arena muy oscura (pisado 3 veces impasable) 
    },
};

// ──────────────────────────────────────────────────────────────
//  Clase Board — estado del tablero
// ──────────────────────────────────────────────────────────────

export class Board {
    /**
     * @param {string} mapName — clave de MAP_THEMES
     *   ('estadio_clasico' | 'arena_nocturna' | 'campo_playa' | 'aleatorio')
     */
    constructor(mapName = 'estadio_clasico') {
        // Resolver tema (aleatorio si es null)
        let theme = MAP_THEMES[mapName] ?? null;
        if (!theme) {
            theme = ALL_THEMES[Math.floor(Math.random() * ALL_THEMES.length)];
        }

        this.theme = theme;
        this.colors = MAP_COLORS[theme];

        /**
         * stomped[row][col] = nivel de profundidad de la casilla
         *   0 → sin pisar     (nivel superior, color más vivo)
         *   1 → pisada 1 vez  (un nivel abajo, color más opaco)
         *   2 → pisada 2 veces
         *   3 → pisada 3 veces (nivel más profundo impasable)
         *
         * Las casillas de la portería (fila 0 y fila 9, cols 1-3)
         * nunca cambian de nivel; siempre quedan en 0.
         */
        this.stomped = this._emptyGrid();
    }

    // ── Geometría del tablero ─────────────────────────────────

    /**
     * ¿Existe esta casilla en el tablero?
     *
     * Regla especial: en las filas extremas (0 y 9) solo existen
     * las columnas 1, 2 y 3 (portería). Las esquinas col 0 y col 4
     * en esas filas NO existen.
     */
    isOnBoard(row, col) {
        if (row < 0 || row >= ROWS) return false;
        if (col < 0 || col >= COLS) return false;
        if ((row === 0 || row === ROWS - 1) && (col === 0 || col === COLS - 1)) {
            return false;   // esquinas de las filas de portería
        }
        return true;
    }

    /**
     * ¿Es esta casilla parte de una portería?
     *
     * Portería A: fila 0,      cols 1-3
     * Portería B: fila 9,      cols 1-3
     */
    isGoalArea(row, col) {
        return (row === 0 || row === ROWS - 1) && (col >= 1 && col <= 3);
    }

    // ── Estado de profundidad ─────────────────────────────────

    /**
     * Nivel actual de profundidad de la casilla (0, 1 o 2).
     */
    getLevel(row, col) {
        return this.stomped[row]?.[col] ?? 0;
    }

    /**
     * ¿La casilla ya no puede ser pisada? (nivel máximo alcanzado)
     */
    isStomped(row, col) {
        return this.stomped[row][col] >= LEVELS - 1;
    }

    /**
     * Aumenta el nivel de profundidad de la casilla en 1.
     * Se llama al momento en que una pieza SALE de la casilla.
     * Las casillas de portería no se hunden nunca.
     */
    stampCell(row, col) {
        if (this.isGoalArea(row, col)) return;  // porterías no se hunden
        if (!this.isOnBoard(row, col)) return;
        if (this.stomped[row][col] < LEVELS - 1) {
            this.stomped[row][col]++;
        }
    }

    // ── Colores para renderización ────────────────────────────

    /**
     * Devuelve el color CSS que debe pintarse en la casilla (row, col).
     *
     * Lógica:
     *  1. Si es portería → color de portería (blanco cálido)
     *  2. El nivel determina qué paleta usar (level0, level1, level2)
     *  3. El patrón de ajedrez determina si se usa el tono oscuro o claro
     *     variant = (row + col) % 2  →  0 = oscuro, 1 = claro
     *
     * @returns {string|null} color CSS o null si la casilla no existe
     */
    getCellColor(row, col) {
        if (!this.isOnBoard(row, col)) return null;
        if (this.isGoalArea(row, col)) return this.colors.goal;

        const level = Math.min(this.getLevel(row, col), 2);
        const palette = this.colors[`level${level}`];
        const variant = (row + col) % 2;    // 0 → tono oscuro, 1 → tono claro
        return palette[variant];
    }

    // ── Reset ─────────────────────────────────────────────────

    /**
     * Reinicia todas las casillas a profundidad 0.
     * Se llama tras un gol para volver al estado inicial del tablero.
     */
    reset() {
        this.stomped = this._emptyGrid();
    }

    // ── Serialización (socket.io / online) ────────────────────

    toJSON() {
        return {
            theme: this.theme,
            stomped: this.stomped,
        };
    }

    static fromJSON({ theme, stomped }) {
        // Buscar el mapName que corresponde al tema
        const mapName = Object.entries(MAP_THEMES).find(([, v]) => v === theme)?.[0]
            ?? 'estadio_clasico';
        const board = new Board(mapName);
        board.stomped = stomped;
        return board;
    }

    // ── Privado ───────────────────────────────────────────────

    /** Genera un grid vacío (todos los niveles en 0) */
    _emptyGrid() {
        return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    }
}