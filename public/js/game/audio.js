// ============================================================
//  TILEKICK — Sistema de Audio
//  Clase: AudioManager
//
//  Mapea el tema del mapa a una carpeta de SFX y reproduce
//  sonidos de forma dinámica para cada evento del juego.
// ============================================================

// Mapa tema visual → carpeta SFX
const THEME_TO_FOLDER = {
    grass: 'Nature',   // estadio_clasico → sonidos naturales
    sand: 'Sand',      // arena_nocturna → sonidos de arena
    cement: 'Marble',  // campo_playa → sonidos de mármol/piedra
};

// Pool de sonidos para movimientos aleatorios
// Se excluyen: game-start, notify, game-end, tenseconds (uso reservado)
const MOVEMENT_POOL = [
    'capture',
    'castle',
    'move-check',
    'move-opponent',
    'move-self',
    'premove',
    'promote',
];

// Sonidos dedicados a eventos específicos
const DEDICATED = {
    steal_success: 'capture',
    steal_fail: 'illegal',
    goal: 'promote',
    save: 'castle',
    game_start: 'game-start',
    game_end: 'game-end',
    illegal: 'illegal',
};

export class AudioManager {
    /**
     * @param {string} mapTheme    — 'grass' | 'sand' | 'cement'
     * @param {object} opts
     * @param {number} opts.sfxVolume   — 0-100
     * @param {string} opts.sfxSet      — 'auto' | 'Default' | 'Marble' | 'Nature' | 'Sand' | 'Metal'
     */
    constructor(mapTheme = 'grass', { sfxVolume = 80, sfxSet = 'auto' } = {}) {
        this.folder = sfxSet === 'auto'
            ? (THEME_TO_FOLDER[mapTheme] ?? 'Default')
            : sfxSet;
        this.sfxVolume = Math.max(0, Math.min(1, sfxVolume / 100));
        this._cache = {};
        this._lastMovementIdx = -1;
        this._enabled = true;
        this._preload();
    }

    // ── Precarga ─────────────────────────────────────────────

    _preload() {
        const names = [
            ...MOVEMENT_POOL,
            'illegal',
            'game-start',
            'game-end',
        ];
        for (const name of names) {
            const audio = new Audio(`/assets/ChessSFX/${this.folder}/${name}.mp3`);
            audio.preload = 'auto';
            this._cache[name] = audio;
        }
    }

    // ── Reproducción interna ─────────────────────────────────

    _play(name) {
        if (!this._enabled || this.sfxVolume === 0) return;
        const src = this._cache[name];
        if (!src) return;
        // Clonar para permitir solapamiento
        const clone = src.cloneNode();
        clone.volume = this.sfxVolume;
        clone.play().catch(() => {}); // ignorar errores de política de autoplay
    }

    // Reproduce un sonido del pool de movimientos (rotando para no repetir)
    _playMovement() {
        const pool = MOVEMENT_POOL;
        let idx;
        do {
            idx = Math.floor(Math.random() * pool.length);
        } while (idx === this._lastMovementIdx && pool.length > 1);
        this._lastMovementIdx = idx;
        this._play(pool[idx]);
    }

    // ── API pública ──────────────────────────────────────────

    /** Movimiento propio */
    playMove() { this._playMovement(); }

    /** Movimiento del oponente */
    playOpponentMove() { this._playMovement(); }

    /** Pase del balón */
    playPass() { this._playMovement(); }

    /** Robo de balón exitoso */
    playStealSuccess() { this._play(DEDICATED.steal_success); }

    /** Intento de robo fallido */
    playStealFail() { this._play(DEDICATED.steal_fail); }

    /** Gol anotado */
    playGoal() { this._play(DEDICATED.goal); }

    /** Atajada del portero */
    playSave() { this._play(DEDICATED.save); }

    /** Inicio de partida */
    playGameStart() { this._play(DEDICATED.game_start); }

    /** Fin de partida */
    playGameEnd() { this._play(DEDICATED.game_end); }

    /** Acción ilegal */
    playIllegal() { this._play(DEDICATED.illegal); }

    // ── Configuración ────────────────────────────────────────

    setVolume(sfxVolume) {
        this.sfxVolume = Math.max(0, Math.min(1, sfxVolume / 100));
    }

    setEnabled(enabled) {
        this._enabled = enabled;
    }

    /**
     * Cambia la carpeta de SFX y recarga los sonidos.
     * @param {string} folder — 'Default' | 'Marble' | 'Nature' | 'Sand' | 'Metal'
     */
    setFolder(folder) {
        this.folder = folder;
        this._cache = {};
        this._preload();
    }
}
