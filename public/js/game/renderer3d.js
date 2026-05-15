// ============================================================
//  TILEKICK — Renderer 3D (Three.js)
//  Clase: Renderer3D
//
//  Interacción: click/tap → selección/acción; drag → orbitar cámara
//
//  Requiere Three.js en el importmap del HTML:
//  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"
// ============================================================

import * as THREE from 'three';
import { SceneBuilder3D } from './sceneBuilder3d.js';

// ── Constantes de color ──────────────────────────────────────

const TEAM_COLORS = {
    A: 0x0d9488,
    B: 0x65713a,
};

// Alturas de las cajas 3D por nivel de profundidad (0→3)
const CELL_HEIGHTS = [0.50, 0.35, 0.20, 0.06];

// Paleta del tablero por tema + nivel
const PALETTE = {
    grass: {
        level0: [0x22c55e, 0x4ade80],
        level1: [0x16a34a, 0x22c55e],
        level2: [0x14532d, 0x166534],
        level3: [0x052e16, 0x064e24],
        goal: 0xe8e8e0,
    },
    sand: {
        level0: [0xca8a04, 0xeab308],
        level1: [0xa16207, 0xca8a04],
        level2: [0x78350f, 0x92400e],
        level3: [0x3b1a06, 0x4a2008],
        goal: 0xe8e8e0,
    },
    cement: {
        level0: [0x6b7280, 0x9ca3af],
        level1: [0x4b5563, 0x6b7280],
        level2: [0x1f2937, 0x374151],
        level3: [0x0a0f14, 0x111827],
        goal: 0xe8e8e0,
    },
};

// ── Clase Renderer3D ─────────────────────────────────────────

export class Renderer3D {
    /**
     * @param {HTMLElement} container  — div que contiene el canvas 3D
     * @param {GameState}   gameState
     * @param {object}      opts
     * @param {string}      opts.myTeam    — 'A' | 'B' | null
     * @param {Function}    opts.onAction  — callback tras acción exitosa
     * @param {Function}    opts.onLog     — callback para log
     */
    constructor(container, gameState, { myTeam = null, onAction = null, onLog = null } = {}) {
        this.container = container;
        this.gs = gameState;
        this.myTeam = myTeam;
        this.onAction = onAction;
        this.onLog = onLog;

        // Bloqueo de input (ej. turno IA)
        this.locked = false;

        // Objetos Three.js
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();
        this._clock  = new THREE.Clock();

        // Mapas de meshes (modo 2.5D con cajas — se mantienen como fallback
        // y para el raycasting de celdas mientras los modelos 3D se cargan)
        this.cellMeshes = new Map();  // `${row},${col}` → Mesh
        this.pieceMeshes = new Map(); // pieceId → Mesh
        this.highlights = [];

        // SceneBuilder3D — responsable de cargar los modelos GLTF
        this.sceneBuilder = null;

        // Orbit camera
        // Eje X del tablero: 0-4 → centro X = 2
        // Eje Z del tablero: 0-9 → centro Z = 4.5
        this.orbitCX = 2;
        this.orbitCZ = 4.5;
        this.orbitRadius = 13;
        this.orbitHeight = 9;
        // Ángulo de órbita: 0 = vista desde Team B (detrás de fila 9)
        //                   π = vista desde Team A (detrás de fila 0)
        // Team A ve sus piezas abajo → ángulo π; Team B → ángulo 0
        this.orbitAngle = (myTeam === 'B') ? 0 : Math.PI;

        // Estado del drag para orbitar
        this._drag = null; // { startX, totalDelta }

        this._init();
        this._buildBoard();
        this._buildPieces();
        this._bindEvents();
        this._animate();

        // Iniciar carga asíncrona del escenario 3D completo
        this._buildScene3D();
    }

    // ── Inicialización de Three.js ────────────────────────────

    _init() {
        const w = this.container.clientWidth || 600;
        const h = this.container.clientHeight || 700;

        // Escena
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e15);
        // Niebla sutil para profundidad
        this.scene.fog = new THREE.Fog(0x0a0e15, 20, 40);

        // Cámara perspectiva
        this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        this._updateCamera();

        // Renderer WebGL
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(w, h);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // Tone mapping necesario para que THREE.Sky luzca correcto
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.5;
        this.container.appendChild(this.renderer.domElement);


        // ── Iluminación base (valores conservadores de fallback) ─
        // SceneBuilder3D sobreescribe estas luces en _buildSky()
        // según el tema, usando LIGHT_PRESETS. Aquí ponemos valores
        // razonables para el estado previo a la carga del escenario.

        const hemi = new THREE.HemisphereLight(0x87ceeb, 0x5a6b3a, 0.55);
        this.scene.add(hemi);

        // Luz direccional principal (sol) — castShadow para sombras
        const sun = new THREE.DirectionalLight(0xfff8e8, 1.0);
        sun.position.set(6, 12, 8);
        sun.castShadow = true;
        sun.shadow.mapSize.width  = 1024;
        sun.shadow.mapSize.height = 1024;
        sun.shadow.camera.near   = 0.5;
        sun.shadow.camera.far    = 30;
        sun.shadow.camera.left   = -8;
        sun.shadow.camera.right  = 8;
        sun.shadow.camera.top    = 12;
        sun.shadow.camera.bottom = -4;
        this.scene.add(sun);

        // Luz de relleno (fill light) — sin sombras, lado opuesto al sol
        const fill = new THREE.DirectionalLight(0x4466aa, 0.28);
        fill.position.set(-5, 5, -8);
        this.scene.add(fill);

        window.addEventListener('resize', () => this._onResize());
    }

    // ── Cámara (órbita) ───────────────────────────────────────

    _updateCamera() {
        const { orbitCX: cx, orbitCZ: cz, orbitRadius: r, orbitHeight: h, orbitAngle: a } = this;
        this.camera.position.set(
            cx + r * Math.sin(a),
            h,
            cz + r * Math.cos(a)
        );
        this.camera.lookAt(cx, 0, cz);
    }

    // ── Escenario 3D (modelos GLTF) ───────────────────────────

    /**
     * Crea el SceneBuilder3D y lanza la carga asíncrona de modelos.
     * Calidad: lee 'tilekick_quality' de localStorage ('low' | 'high').
     * Después de la carga, oculta los fallbacks (cajas + cilindros).
     */
    async _buildScene3D() {
        const theme   = this.gs.board.theme;
        const quality = localStorage.getItem('tilekick_quality') ?? 'high';

        this.sceneBuilder = new SceneBuilder3D(
            this.scene,
            theme,
            this.gs.pieces,
            this.gs.board,
            this.renderer,   // necesario para Sky
            this.camera,     // necesario para Sky
            quality
        );
        try {
            await this.sceneBuilder.build();

            if (quality === 'high') {
                // Ocultar cajas de tile (reemplazadas por GLTF tiles)
                this.sceneBuilder.hideFallbackTiles(this.cellMeshes);

                // Ocultar cilindros de pieza (reemplazados por personajes GLTF)
                this.pieceMeshes.forEach(mesh => { mesh.visible = false; });
            }
        } catch (err) {
            console.error('[Renderer3D] Error cargando escenario 3D:', err);
        }
    }

    // ── Construcción del tablero ──────────────────────────────

    _buildBoard() {
        const board = this.gs.board;
        const palette = PALETTE[board.theme] ?? PALETTE.grass;

        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 5; col++) {
                if (!board.isOnBoard(row, col)) continue;

                const level = board.getLevel(row, col);
                const height = CELL_HEIGHTS[Math.min(level, 3)];
                const isGoal = board.isGoalArea(row, col);
                const hexColor = isGoal
                    ? palette.goal
                    : (palette[`level${Math.min(level, 3)}`] ?? palette.level0)[(row + col) % 2];

                // Tiles ligeramente separadas (0.85 en lugar de 0.92 → gap de 0.15)
                const geometry = new THREE.BoxGeometry(0.85, height, 0.85);
                const material = new THREE.MeshPhongMaterial({ color: hexColor, shininess: 25 });
                const mesh = new THREE.Mesh(geometry, material);

                mesh.castShadow = false;
                mesh.receiveShadow = true;
                mesh.position.set(col, height / 2, row);
                mesh.userData = { type: 'cell', row, col };

                this.scene.add(mesh);
                this.cellMeshes.set(`${row},${col}`, mesh);
            }
        }
    }

    // ── Construcción de piezas ────────────────────────────────

    _buildPieces() {
        for (const piece of this.gs.pieces) {
            this._createPieceMesh(piece);
        }
    }

    _createPieceMesh(piece) {
        const color = TEAM_COLORS[piece.team];
        const mat = new THREE.MeshPhongMaterial({ color, shininess: 70 });
        const geo = new THREE.CylinderGeometry(0.28, 0.28, 0.5, 16);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.userData = { type: 'piece', pieceId: piece.id };

        this._positionPiece(mesh, piece);
        this.scene.add(mesh);
        this.pieceMeshes.set(piece.id, mesh);

        if (piece.hasBall) this._addBallIndicator(mesh);
    }

    _positionPiece(mesh, piece) {
        const level = this.gs.board.getLevel(piece.row, piece.col);
        const cellTop = CELL_HEIGHTS[Math.min(level, 3)];
        mesh.position.set(piece.col, cellTop + 0.25, piece.row);
    }

    _addBallIndicator(pieceMesh) {
        const geo = new THREE.SphereGeometry(0.1, 12, 8);
        const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 100 });
        const ball = new THREE.Mesh(geo, mat);
        ball.position.set(0.25, 0.35, 0);
        ball.userData = { isBall: true };
        pieceMesh.add(ball);
    }

    // ── Resaltados ───────────────────────────────────────────

    _clearHighlights() {
        for (const h of this.highlights) this.scene.remove(h);
        this.highlights = [];
    }

    _showHighlights() {
        this._clearHighlights();
        const ACTION_COLORS_3D = {
            move:  0x0d9488,
            shoot: 0xef4444,
            pass:  0x6366f1,
            steal: 0xf97316,
        };

        for (const move of this.gs.legalMoves) {
            const level = this.gs.board.getLevel(move.row, move.col);
            const height = CELL_HEIGHTS[Math.min(level, 3)];
            const color = ACTION_COLORS_3D[move.action ?? 'move'];

            const geo = new THREE.BoxGeometry(0.85, 0.04, 0.85);
            const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.65 });
            const mesh = new THREE.Mesh(geo, mat);

            mesh.position.set(move.col, height + 0.02, move.row);
            mesh.userData = { type: 'highlight', row: move.row, col: move.col, action: move.action ?? 'move' };

            this.scene.add(mesh);
            this.highlights.push(mesh);
        }
    }

    // ── Actualizar estado del juego en la escena ─────────────

    updateScene() {
        const board = this.gs.board;
        const palette = PALETTE[board.theme] ?? PALETTE.grass;

        // Actualizar posiciones + estado de piezas (fallback cilindros)
        for (const piece of this.gs.pieces) {
            const mesh = this.pieceMeshes.get(piece.id);
            if (!mesh || !mesh.visible) continue;  // saltar si GLTF activo

            this._positionPiece(mesh, piece);

            // Emisivo en pieza seleccionada
            mesh.material.emissive.set(
                piece.id === this.gs.selectedId ? 0xfbbf24 : 0x000000
            );
            mesh.material.emissiveIntensity = piece.id === this.gs.selectedId ? 0.4 : 0;

            // Piezas rivales (online) → ligeramente translúcidas
            if (this.myTeam !== null && piece.team !== this.myTeam) {
                mesh.material.transparent = true;
                mesh.material.opacity = 0.72;
            } else {
                mesh.material.transparent = false;
                mesh.material.opacity = 1;
            }

            // Indicador de balón (fallback)
            const existing = mesh.children.find(c => c.userData.isBall);
            if (piece.hasBall && !existing) this._addBallIndicator(mesh);
            if (!piece.hasBall && existing) mesh.remove(existing);
        }

        // Actualizar profundidades del tablero (solo fallback cajas)
        for (const [key, mesh] of this.cellMeshes) {
            if (!mesh.visible) continue;   // GLTF tiles activos → saltar

            const [row, col] = key.split(',').map(Number);
            const level = board.getLevel(row, col);
            const height = CELL_HEIGHTS[Math.min(level, 3)];
            const isGoal = board.isGoalArea(row, col);
            const hexColor = isGoal
                ? palette.goal
                : (palette[`level${Math.min(level, 3)}`] ?? palette.level0)[(row + col) % 2];

            const baseH = CELL_HEIGHTS[0];
            mesh.scale.y = height / baseH;
            mesh.position.y = height / 2;
            mesh.material.color.setHex(hexColor);
        }

        // Resaltados
        if (this.gs.legalMoves.length > 0) this._showHighlights();
        else this._clearHighlights();

        // Sincronizar modelos 3D con el estado del juego
        if (this.sceneBuilder) {
            this.sceneBuilder.syncCharacters(this.gs.pieces);
            this.sceneBuilder.syncTiles(this.gs.board);
        }
    }

    // ── Interacción: órbita + click ───────────────────────────

    _bindEvents() {
        const domEl = this.renderer.domElement;
        domEl.addEventListener('pointerdown',  e => this._onPointerDown(e));
        domEl.addEventListener('pointermove',  e => this._onPointerMove(e));
        domEl.addEventListener('pointerup',    e => this._onPointerUp(e));
        domEl.addEventListener('pointerleave', () => { this._drag = null; });
    }

    _onPointerDown(e) {
        this._drag = { startX: e.clientX, startY: e.clientY, moved: false };
    }

    _onPointerMove(e) {
        if (!this._drag) return;
        const dx = e.clientX - this._drag.startX;
        const dy = e.clientY - this._drag.startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
            this._drag.moved = true;
        }
        if (this._drag.moved) {
            // Rotar cámara horizontalmente
            this.orbitAngle += dx * 0.006;
            this._drag.startX = e.clientX;
            this._drag.startY = e.clientY;
            this._updateCamera();
        }
    }

    _onPointerUp(e) {
        if (!this._drag) return;
        const wasDrag = this._drag.moved;
        this._drag = null;
        if (!wasDrag) {
            this._handleClick(e);
        }
    }

    _handleClick(e) {
        if (this.locked) return;

        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.camera);

        // 1. Click en resaltado → ejecutar acción
        const hlHits = this.raycaster.intersectObjects(this.highlights);
        if (hlHits.length > 0) {
            const { row, col } = hlHits[0].object.userData;
            this._commitTo(row, col);
            return;
        }

        // 2. Click en pieza → seleccionar
        // Incluimos tanto las cajas 2.5D (pieceMeshes) como los modelos 3D (sceneBuilder)
        const pieceMeshList = [...this.pieceMeshes.values()];
        const char3DMeshes  = this.sceneBuilder
            ? [...this.sceneBuilder.characterMeshes.values()]
            : [];
        const allPieceMeshes = [...pieceMeshList, ...char3DMeshes];

        const pieceHits = this.raycaster.intersectObjects(allPieceMeshes, true);
        if (pieceHits.length > 0) {
            let obj = pieceHits[0].object;
            while (obj && !obj.userData.pieceId) obj = obj.parent;
            if (obj?.userData.pieceId) {
                const gs = this.gs;
                // En online, solo actúas si es tu turno
                const piece = gs.getPiece(obj.userData.pieceId);
                if (this.myTeam !== null && piece?.team !== this.myTeam) return;

                const result = gs.selectPiece(obj.userData.pieceId);
                if (result.ok) this.updateScene();
            }
            return;
        }

        // 3. Click en celda → commit (ej. portero en save)
        const cellMeshes = [...this.cellMeshes.values()];
        const cellHits = this.raycaster.intersectObjects(cellMeshes);
        if (cellHits.length > 0) {
            const { row, col } = cellHits[0].object.userData;
            this._commitTo(row, col);
        }
    }

    _commitTo(row, col) {
        if (this.locked) return;
        const gs = this.gs;

        if (gs.phase === 'save') {
            // En online, solo el portero del equipo activo puede atajar
            if (this.myTeam !== null && gs.turn !== this.myTeam) return;
            const result = gs.commitSave(row, col);
            if (result.ok) {
                result._sync = { type: 'commit-save', targetRow: row, targetCol: col };
                this.onLog?.(result.event);
                this.onAction?.(result);
                this.updateScene();
            }
            return;
        }

        const selectedIdBeforeCommit = gs.selectedId; // capturar ANTES de que commitAction limpie
        const result = gs.commitAction(row, col);
        if (result.ok) {
            // Incluir stealSuccess para sincronización online determinista
            result._sync = {
                type: 'select-commit',
                pieceId: selectedIdBeforeCommit,
                targetRow: row,
                targetCol: col,
                ...(result.interception !== undefined ? { stealSuccess: result.interception.success } : {}),
            };
            this.onLog?.(result.event);
            this.onAction?.(result);
            this.updateScene();
        }
    }

    // ── Loop de animación ─────────────────────────────────────

    _animate() {
        requestAnimationFrame(() => this._animate());
        const delta = this._clock.getDelta();
        // Animar agua si está activa
        if (this.sceneBuilder) this.sceneBuilder.tickWater(delta);
        this.renderer.render(this.scene, this.camera);
    }

    _onResize() {
        const w = this.container.clientWidth;
        const h = this.container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
    }
}
