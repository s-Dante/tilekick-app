// ============================================================
//  TILEKICK — Renderer 3D (Three.js)
//  Clase: Renderer3D
//
//  Interacción: click/tap en casilla con Raycaster
//
//  Requiere Three.js en el importmap del HTML:
//  "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"
// ============================================================

import * as THREE from 'three';

// ── Constantes de color ──────────────────────────────────────

const TEAM_MAT = {
    A: new THREE.MeshPhongMaterial({ color: 0x0d9488, shininess: 60 }),
    B: new THREE.MeshPhongMaterial({ color: 0x65713a, shininess: 60 }),
};

// Dimensiones de las cajas 3D por nivel de profundidad
const CELL_HEIGHTS = [0.50, 0.30, 0.12]; // nivel 0, 1, 2

// Colores del tablero — se actualizan según el mapa
const PALETTE = {
    grass: { level0: [0x22c55e, 0x4ade80], level1: [0x16a34a, 0x22c55e], level2: [0x14532d, 0x166534], goal: 0xe8e8e0 },
    sand: { level0: [0xca8a04, 0xeab308], level1: [0xa16207, 0xca8a04], level2: [0x78350f, 0x92400e], goal: 0xe8e8e0 },
    cement: { level0: [0x6b7280, 0x9ca3af], level1: [0x4b5563, 0x6b7280], level2: [0x1f2937, 0x374151], goal: 0xe8e8e0 },
};

// ── Clase Renderer3D ─────────────────────────────────────────

export class Renderer3D {
    /**
     * @param {HTMLElement} container  — div que contiene el canvas 3D
     * @param {GameState}   gameState
     * @param {object}      opts
     * @param {Function}    opts.onAction — callback tras acción exitosa
     * @param {Function}    opts.onLog    — callback para log
     */
    constructor(container, gameState, { onAction = null, onLog = null } = {}) {
        this.container = container;
        this.gs = gameState;
        this.onAction = onAction;
        this.onLog = onLog;

        // Objetos Three.js
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.raycaster = new THREE.Raycaster();
        this.pointer = new THREE.Vector2();

        // Mapas de meshes para actualización eficiente
        this.cellMeshes = new Map(); // key `${row},${col}` → Mesh
        this.pieceMeshes = new Map(); // pieceId → Mesh
        this.highlights = [];        // Meshes de resaltado

        this._init();
        this._buildBoard();
        this._buildPieces();
        this._bindEvents();
        this._animate();
    }

    // ── Inicialización de Three.js ────────────────────────────

    _init() {
        const w = this.container.clientWidth || 600;
        const h = this.container.clientHeight || 700;

        // Escena
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0e15);

        // Cámara perspectiva isométrica
        this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100);
        this.camera.position.set(2, 9, 14);
        this.camera.lookAt(2, 0, 4.5);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.setSize(w, h);
        this.container.appendChild(this.renderer.domElement);

        // Luces
        const ambient = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambient);

        const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(4, 10, 6);
        this.scene.add(dirLight);

        window.addEventListener('resize', () => this._onResize());
    }

    // ── Construcción del tablero ──────────────────────────────

    _buildBoard() {
        const board = this.gs.board;
        const palette = PALETTE[board.theme] ?? PALETTE.grass;

        for (let row = 0; row < 10; row++) {
            for (let col = 0; col < 5; col++) {
                if (!board.isOnBoard(row, col)) continue;

                const level = board.getLevel(row, col);
                const height = CELL_HEIGHTS[level];
                const isGoal = board.isGoalArea(row, col);
                const hexColor = isGoal
                    ? palette.goal
                    : (palette[`level${level}`] ?? palette.level0)[(row + col) % 2];

                const material = new THREE.MeshPhongMaterial({ color: hexColor, shininess: 20 });
                const geometry = new THREE.BoxGeometry(0.92, height, 0.92);
                const mesh = new THREE.Mesh(geometry, material);

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
        const mat = TEAM_MAT[piece.team].clone();
        const geo = new THREE.CylinderGeometry(0.28, 0.28, 0.5, 16);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData = { type: 'piece', pieceId: piece.id };

        this._positionPiece(mesh, piece);
        this.scene.add(mesh);
        this.pieceMeshes.set(piece.id, mesh);

        // Esfera pequeña del balón sobre la pieza
        if (piece.hasBall) this._addBallIndicator(mesh, piece);
    }

    _positionPiece(mesh, piece) {
        const level = this.gs.board.getLevel(piece.row, piece.col);
        const cellTop = CELL_HEIGHTS[level];
        mesh.position.set(piece.col, cellTop + 0.25, piece.row);
    }

    _addBallIndicator(pieceMesh, piece) {
        const geo = new THREE.SphereGeometry(0.1, 12, 8);
        const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 80 });
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
            move: 0x0d9488,
            shoot: 0xef4444,
            pass: 0x6366f1,
        };

        for (const move of this.gs.legalMoves) {
            const level = this.gs.board.getLevel(move.row, move.col);
            const height = CELL_HEIGHTS[level];
            const color = ACTION_COLORS_3D[move.action ?? 'move'];

            const geo = new THREE.BoxGeometry(0.92, 0.04, 0.92);
            const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6 });
            const mesh = new THREE.Mesh(geo, mat);

            mesh.position.set(move.col, height + 0.02, move.row);
            mesh.userData = { type: 'highlight', row: move.row, col: move.col, action: move.action ?? 'move' };

            this.scene.add(mesh);
            this.highlights.push(mesh);
        }
    }

    // ── Actualizar estado del juego en la escena ─────────────

    updateScene() {
        // Actualizar posiciones de piezas
        for (const piece of this.gs.pieces) {
            const mesh = this.pieceMeshes.get(piece.id);
            if (!mesh) continue;

            this._positionPiece(mesh, piece);

            // Color del seleccionado
            mesh.material.emissive.set(
                piece.id === this.gs.selectedId ? 0xfbbf24 : 0x000000
            );
            mesh.material.emissiveIntensity = piece.id === this.gs.selectedId ? 0.3 : 0;

            // Quitar/añadir indicador de balón
            const existing = mesh.children.find(c => c.userData.isBall);
            if (piece.hasBall && !existing) this._addBallIndicator(mesh, piece);
            if (!piece.hasBall && existing) mesh.remove(existing);
        }

        // Actualizar profundidades del tablero
        for (const [key, mesh] of this.cellMeshes) {
            const [row, col] = key.split(',').map(Number);
            const level = this.gs.board.getLevel(row, col);
            const height = CELL_HEIGHTS[level];
            mesh.scale.y = height / CELL_HEIGHTS[0]; // escalar el alto
            mesh.position.y = height / 2;
        }

        // Resaltados
        if (this.gs.legalMoves.length > 0) this._showHighlights();
        else this._clearHighlights();
    }

    // ── Interacción (click / tap) ─────────────────────────────

    _bindEvents() {
        const domEl = this.renderer.domElement;
        domEl.addEventListener('pointerdown', e => this._onPointer(e));
    }

    _onPointer(e) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.pointer, this.camera);

        // Primero intentar click en resaltado (acción)
        const hlHits = this.raycaster.intersectObjects(this.highlights);
        if (hlHits.length > 0) {
            const { row, col } = hlHits[0].object.userData;
            this._commitTo(row, col);
            return;
        }

        // Click en pieza — seleccionar
        const pieceMeshes = [...this.pieceMeshes.values()];
        const pieceHits = this.raycaster.intersectObjects(pieceMeshes, true);
        if (pieceHits.length > 0) {
            let obj = pieceHits[0].object;
            // Subir hasta el mesh con pieceId
            while (obj && !obj.userData.pieceId) obj = obj.parent;
            if (obj?.userData.pieceId) {
                const gs = this.gs;
                const result = gs.selectPiece(obj.userData.pieceId);
                if (result.ok) this.updateScene();
            }
            return;
        }

        // Click en celda de tablero (durante fase SAVE o como fallback)
        const cellMeshes = [...this.cellMeshes.values()];
        const cellHits = this.raycaster.intersectObjects(cellMeshes);
        if (cellHits.length > 0) {
            const { row, col } = cellHits[0].object.userData;
            this._commitTo(row, col);
        }
    }

    _commitTo(row, col) {
        const gs = this.gs;

        if (gs.phase === 'save') {
            const result = gs.commitSave(row, col);
            if (result.ok) {
                this.onLog?.(result.event);
                this.onAction?.(result);
                this.updateScene();
            }
            return;
        }

        const result = gs.commitAction(row, col);
        if (result.ok) {
            this.onLog?.(result.event);
            this.onAction?.(result);
            this.updateScene();
        }
    }

    // ── Loop de animación ─────────────────────────────────────

    _animate() {
        requestAnimationFrame(() => this._animate());
        // Rotación suave del tablero (sutil)
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
