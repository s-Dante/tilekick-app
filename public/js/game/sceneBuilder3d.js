// ============================================================
//  TILEKICK — SceneBuilder3D
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';

// ═══════════════════════════════════════════════════════════
//  ██  PARÁMETROS AJUSTABLES  ██
//  Modifica estas constantes para afinar la escena visualmente
// ═══════════════════════════════════════════════════════════

// ── Espaciado del tablero ────────────────────────────────────
// CELL_SIZE controla la distancia entre CENTROS de casillas.
// Sube este valor para separar más los tiles entre sí.
const CELL_SIZE = 1.0;  // unidades Three.js entre centros

// ── Escala de los tiles GLTF ─────────────────────────────────
// Reduce para crear GAP visual entre tiles (0.85 → 15% de hueco).
// Aplica IGUAL en X y Z; Y se maneja por nivel de profundidad.
const TILE_SCALE_XZ = 0.5;  // ← gap entre tiles (0.0–1.0)

// ── Alturas de tile según nivel de profundidad (0 → 3) ───────
// Level 0 = tile completo, Level 3 = hundido / impasable.
// Ajusta para controlar cuánto se "hunde" visualmente un tile.
const TILE_LEVEL_HEIGHTS = [1.0, 0.70, 0.40, 0.10];  // escala Y relativa
// Level 3 (impasable): poner a 0 lo hace invisible
const TILE_LEVEL_3_VISIBLE = false;  // false = invisible cuando impasable

// ── Iluminación ──────────────────────────────────────────────
const LIGHT_CFG = {
    hemi: { sky: 0x87ceeb, ground: 0x7c5c3a, intensity: 0.4 },   // luz hemisférica
    sun: { color: 0xfff5e0, intensity: 0.8 },                    // luz direccional (sol)
    fill: { color: 0x4466aa, intensity: 0.2 },                    // luz de relleno
    exposure: 0.35,  // toneMappingExposure del renderer (más bajo = menos sobreexpuesto)
};

// ── Parámetros del Sky por tema ──────────────────────────────
// turbidity   [0–20]:  opacidad del aire (0=despejado, 20=brumoso)
// rayleigh    [0–4]:   dispersión de luz azul del cielo
// mieCoef     [0–0.1]: dispersión de partículas (niebla/polvo)
// mieDir      [0–1]:   dirección del scattering (0=difuso, 1=puntual)
// elevation   [0–90]:  altura del sol en grados
// azimuth     [0–360]: orientación del sol (0/360=Norte, 180=Sur)
const SKY_PRESETS = {
    grass: { turbidity: 3, rayleigh: 1.2, mieCoef: 0.003, mieDir: 0.7, elevation: 22, azimuth: 180 },
    sand: { turbidity: 8, rayleigh: 1.8, mieCoef: 0.015, mieDir: 0.85, elevation: 12, azimuth: 210 },
    cement: { turbidity: 1, rayleigh: 0, mieCoef: 0.03, mieDir: 0.75, elevation: 45, azimuth: 180 },
};

// ── Agua ─────────────────────────────────────────────────────
const WATER_CFG = {
    enabled: true,
    color: 0x006994,   // color base del agua
    distortionScale: 1.5,      // ondulación (0=plano, 8=muy agitado)
    alpha: 0.88,       // transparencia (0=invisible, 1=opaco)
    sunColor: 0xffffff,
    speed: 1.0,        // velocidad de animación (multiplicador)
    // Área del agua: cubre el tablero completo en Y negativa
    width: 4.0,               // ancho (columnas 0–4 = 4 unidades)
    height: 9.0,               // largo (filas 0–9 = 9 unidades)
    posY: -0.15,             // altura Y (negativa = debajo de los tiles)
};

// ═══════════════════════════════════════════════════════════
//  Constantes internas (no modificar a menos que sepas)
// ═══════════════════════════════════════════════════════════
const BOARD_COLS = 5;
const BOARD_ROWS = 10;
const BALL_COUNT = 7;
const TILE_Y_ROTATIONS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
const POSITION_FOLDER = { goalkeeper: 'Goalkeeper', defender: 'Defender', forward: 'Forward' };
const GENERAL_SCENARIO_PATH = '/assets/3D/Scenario/General/generalScenario.gltf';

const THEME_MAP = {
    grass: {
        scenarioPath: '/assets/3D/Scenario/Grass/grassScenario.gltf',
        tilePath: '/assets/3D/Grass/GrassTile/grassTile.gltf',
        goalTilePath: '/assets/3D/Grass/GoalTile/GoalTile.gltf',
    },
    sand: {
        scenarioPath: '/assets/3D/Scenario/Sand/sandScenario.gltf',
        tilePath: '/assets/3D/Sand/SandTile/sandTile.gltf',
        goalTilePath: '/assets/3D/Sand/GoalTile/GoalTile.gltf',
    },
    cement: {
        scenarioPath: '/assets/3D/Scenario/Cement/cementScenario.gltf',
        tilePath: '/assets/3D/Cement/ConcretTile/concretTile.gltf',
        goalTilePath: '/assets/3D/Cement/GoalTile/GoalTile.gltf',
    },
};

// ════════════════════════════════════════════════════════════
//  SceneBuilder3D
// ════════════════════════════════════════════════════════════

export class SceneBuilder3D {
    constructor(scene, theme, pieces, board, renderer, camera, quality = 'high') {
        this.scene = scene;
        this.theme = theme in THEME_MAP ? theme : 'grass';
        this.pieces = pieces;
        this.board = board;
        this.renderer = renderer;
        this.camera = camera;
        this.quality = quality;

        this._manager = new THREE.LoadingManager();
        this._manager.onError = (url) => console.error('[SceneBuilder3D] ❌', url);
        this._gltfLoader = new GLTFLoader(this._manager);
        this._ballIndex = Math.floor(Math.random() * BALL_COUNT) + 1;

        this.characterMeshes = new Map();  // pieceId → Object3D
        this.tileMeshes = new Map();  // `${row},${col}` → Object3D
        this.ballObject = null;
        this.waterMesh = null;
        this.skyObject = null;
        this._loadingOverlay = null;
    }

    // ──────────────────────────────────────────────────────────
    //  ENTRADA
    // ──────────────────────────────────────────────────────────

    async build() {
        this._showLoadingOverlay();
        const themeData = THEME_MAP[this.theme];

        // Aplicar configuración de luz y exposure al renderer
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = LIGHT_CFG.exposure;

        try {
            if (this.quality === 'low') {
                this._buildSky(themeData);
                if (WATER_CFG.enabled) this._buildWater();
            } else {
                // Sky PRIMERO → scene.environment listo antes de que los
                // materiales GLTF se registren en la escena
                this._buildSky(themeData);
                if (WATER_CFG.enabled) this._buildWater();

                // Cargar todos los modelos en paralelo
                await Promise.all([
                    this._loadScenario(themeData),
                    this._loadTiles(themeData),
                    this._loadCharacters(),
                    this._loadBall(),
                ]);

                // Re-aplicar IBL a todos los materiales GLTF ya cargados
                if (this._envMapIntensity !== undefined) {
                    this._applyEnvIntensity(this._envMapIntensity);
                }
            }
        } catch (err) {
            console.error('[SceneBuilder3D] Error:', err);
        } finally {
            this._hideLoadingOverlay();
        }
    }

    // ──────────────────────────────────────────────────────────
    //  OVERLAY DE CARGA
    // ──────────────────────────────────────────────────────────

    _showLoadingOverlay() {
        let ov = document.getElementById('scene-loading-overlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'scene-loading-overlay';
            ov.style.cssText = 'position:absolute;inset:0;background:#0a0e15;display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:500;font-family:Inter,sans-serif;color:#f0efe9;gap:20px;';
            ov.innerHTML = `
                <div style="font-size:40px">⚽</div>
                <div style="font-size:18px;font-weight:700;letter-spacing:.05em">Cargando escenario…</div>
                <div style="width:200px;height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden">
                    <div id="scene-loading-bar" style="height:100%;width:0%;background:#0d9488;border-radius:2px;transition:width .3s ease"></div>
                </div>
                <div id="scene-loading-text" style="font-size:12px;color:rgba(255,255,255,.4)">Iniciando…</div>`;
            const wrapper = this.renderer.domElement.parentElement ?? document.body;
            wrapper.style.position = 'relative';
            wrapper.appendChild(ov);
        }
        ov.style.display = 'flex';
        this._loadingOverlay = ov;
        let pct = 0;
        this._progressInterval = setInterval(() => {
            pct = Math.min(pct + Math.random() * 9, 90);
            const bar = document.getElementById('scene-loading-bar');
            const txt = document.getElementById('scene-loading-text');
            if (bar) bar.style.width = `${pct}%`;
            if (txt) txt.textContent = pct < 30 ? 'Cargando escenario…'
                : pct < 60 ? 'Cargando personajes…'
                    : pct < 85 ? 'Cargando pelota…'
                        : 'Finalizando…';
        }, 200);
    }

    _hideLoadingOverlay() {
        clearInterval(this._progressInterval);
        const bar = document.getElementById('scene-loading-bar');
        const txt = document.getElementById('scene-loading-text');
        if (bar) { bar.style.width = '100%'; }
        if (txt) txt.textContent = '¡Listo!';
        setTimeout(() => {
            if (!this._loadingOverlay) return;
            this._loadingOverlay.style.transition = 'opacity .5s ease';
            this._loadingOverlay.style.opacity = '0';
            setTimeout(() => { this._loadingOverlay?.remove(); this._loadingOverlay = null; }, 500);
        }, 300);
    }

    // ──────────────────────────────────────────────────────────
    //  SKY + LUCES + IBL
    // ──────────────────────────────────────────────────────────

    _buildSky(themeData) {
        const cfg = SKY_PRESETS[this.theme] ?? SKY_PRESETS.grass;

        // ── 1. Sky dome ───────────────────────────────────────
        const sky = new Sky();
        sky.scale.setScalar(10000);
        this.scene.add(sky);
        const u = sky.material.uniforms;
        u['turbidity'].value       = cfg.turbidity;
        u['rayleigh'].value        = cfg.rayleigh;
        u['mieCoefficient'].value  = cfg.mieCoef;
        u['mieDirectionalG'].value = cfg.mieDir;

        const phi    = THREE.MathUtils.degToRad(90 - cfg.elevation);
        const theta  = THREE.MathUtils.degToRad(cfg.azimuth);
        const sunVec = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
        u['sunPosition'].value.copy(sunVec);
        this.scene.background = null;
        this.skyObject = sky;

        // ── 2. Alinear luz de sol con la posición del sky ─────
        this.scene.traverse(child => {
            if (child.isDirectionalLight && child.castShadow) {
                child.position.copy(sunVec.clone().multiplyScalar(20));
                child.intensity = LIGHT_CFG.sun.intensity;
            }
            if (child.isHemisphereLight) {
                child.intensity = LIGHT_CFG.hemi.intensity;
            }
        });

        // ── 3. IBL: hornear el sky como environment map ───────
        //
        // SIN esto, los materiales PBR de los GLTF solo reciben
        // las luces manuales y quedan muy oscuros aunque el sky
        // se vea brillante. PMREMGenerator convierte el cielo en
        // iluminación global (diffuse + specular) para todos los
        // materiales de la escena.
        //
        // ── AJUSTE IBL ────────────────────────────────────────
        // envMapIntensity: cuánto influye el environment en los
        //   materiales (0 = solo luces manuales, 1 = IBL completo,
        //   >1 = potencia el efecto)
        const ENV_MAP_INTENSITY = 1.2; // ← AJUSTA ESTE VALOR
        // ─────────────────────────────────────────────────────

        const pmrem = new THREE.PMREMGenerator(this.renderer);
        pmrem.compileEquirectangularShader();

        // Renderizar el sky en una escena auxiliar para el cubemap
        const skyScene = new THREE.Scene();
        skyScene.add(sky.clone());  // clon temporal (sky principal queda en la escena)
        const envRT = pmrem.fromScene(skyScene);
        pmrem.dispose();

        // Aplicar el environment a toda la escena
        this.scene.environment = envRT.texture;

        // Intensidad del environment en todos los materiales existentes
        // (y en los que se añadan después, vía onBeforeRender o traverse)
        this._applyEnvIntensity(ENV_MAP_INTENSITY);
        this._envMapIntensity = ENV_MAP_INTENSITY;
    }

    /**
     * Recorre la escena y aplica envMapIntensity a todos los MeshStandardMaterial.
     * Llámalo también desde _loadScenario / _loadTiles / _loadCharacters si quieres
     * que los modelos GLTF cargados DESPUÉS también usen la intensidad correcta.
     */
    _applyEnvIntensity(intensity) {
        this.scene.traverse(child => {
            if (!child.isMesh) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => {
                if (m && 'envMapIntensity' in m) m.envMapIntensity = intensity;
            });
        });
    }

    // ──────────────────────────────────────────────────────────
    //  AGUA
    // ──────────────────────────────────────────────────────────

    _buildWater() {
        const cfg = WATER_CFG;
        const geo = new THREE.PlaneGeometry(cfg.width, cfg.height);

        // Textura de normales para el agua (CDN de Three.js)
        const waterNormals = new THREE.TextureLoader().load(
            'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/textures/waternormals.jpg',
            (tex) => { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
        );

        const water = new Water(geo, {
            textureWidth: 512,
            textureHeight: 512,
            waterNormals,
            sunDirection: new THREE.Vector3(0, 1, 0),
            sunColor: cfg.sunColor,
            waterColor: cfg.color,
            distortionScale: cfg.distortionScale,
            alpha: cfg.alpha,
            fog: false,
        });

        // El plano de Water está en XY por defecto → rotar para que quede en XZ
        water.rotation.x = -Math.PI / 2;
        // Centrar en el tablero: X centro = (BOARD_COLS-1)/2 = 2, Z centro = (BOARD_ROWS-1)/2 = 4.5
        water.position.set(2, cfg.posY, -10);
        water.scale.set(15, 15, 1);
        water.name = 'WaterPlane';
 
        this.scene.add(water);
        this.waterMesh = water;
    }

    // ──────────────────────────────────────────────────────────
    //  ANIMACIÓN DEL AGUA (llamar en el loop de render)
    // ──────────────────────────────────────────────────────────

    tickWater(delta) {
        if (!this.waterMesh) return;
        this.waterMesh.material.uniforms['time'].value += delta * WATER_CFG.speed;
    }

    // ──────────────────────────────────────────────────────────
    //  HELPER GLTF
    // ──────────────────────────────────────────────────────────

    _loadGLTF(path) {
        return new Promise((resolve, reject) => {
            this._gltfLoader.load(path, (g) => resolve(g.scene), undefined, reject);
        });
    }

    // ──────────────────────────────────────────────────────────
    //  ESCENARIO
    // ──────────────────────────────────────────────────────────

    async _loadScenario(themeData) {
        const load = async (path, name, pos) => {
            try {
                const obj = await this._loadGLTF(path);
                obj.name = name;
                // ── AJUSTE: Escenario ──────────────────────────
                obj.position.set(...pos);
                obj.rotation.set(0, 0, 0);
                obj.scale.set(1, 1, 1);
                // ──────────────────────────────────────────────
                obj.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } });
                this.scene.add(obj);
            } catch (e) { console.warn(`[SceneBuilder3D] ${name} no cargado:`, e); }
        };
        await Promise.all([
            load(GENERAL_SCENARIO_PATH, 'ScenarioGeneral', [2, 0, 4.5]),
            load(themeData.scenarioPath, `Scenario_${this.theme}`, [2, 0, 4.5]),
        ]);
    }

    // ──────────────────────────────────────────────────────────
    //  TILES (con nivel dinámico)
    // ──────────────────────────────────────────────────────────

    async _loadTiles(themeData) {
        const [tileRes, goalRes] = await Promise.allSettled([
            this._loadGLTF(themeData.tilePath),
            this._loadGLTF(themeData.goalTilePath),
        ]);

        const tileProto = tileRes.status === 'fulfilled' ? tileRes.value : null;
        const goalTileProto = goalRes.status === 'fulfilled' ? goalRes.value : null;

        if (!tileProto) console.warn('[SceneBuilder3D] Tile temático no cargado');
        if (!goalTileProto) console.warn('[SceneBuilder3D] GoalTile no cargado');

        for (let row = 0; row < BOARD_ROWS; row++) {
            for (let col = 0; col < BOARD_COLS; col++) {
                if (!this.board.isOnBoard(row, col)) continue;

                const isGoal = this.board.isGoalArea(row, col);
                const proto = isGoal ? goalTileProto : tileProto;
                if (!proto) continue;

                const clone = proto.clone(true);

                // Posición base de la casilla
                clone.position.set(col * CELL_SIZE, 0, row * CELL_SIZE);

                // Rotación Y aleatoria en pasos de 90°
                clone.rotation.set(0, TILE_Y_ROTATIONS[Math.floor(Math.random() * 4)], 0);

                // Escala inicial (nivel 0 = completo)
                // ── AJUSTE: escala XZ controla el gap entre tiles ──
                clone.scale.set(TILE_SCALE_XZ, TILE_LEVEL_HEIGHTS[0], TILE_SCALE_XZ);
                // ──────────────────────────────────────────────────

                clone.name = `Tile_${row}_${col}`;
                clone.userData = { type: 'sceneTile', row, col, isGoal };
                clone.traverse(c => { if (c.isMesh) c.receiveShadow = true; });

                this.scene.add(clone);
                this.tileMeshes.set(`${row},${col}`, clone);
            }
        }
    }

    /**
     * Sincroniza la apariencia de los tiles GLTF con el nivel actual
     * del tablero. Llama desde Renderer3D.updateScene() tras cada acción.
     *
     * Niveles:
     *   0 → tile completo  (TILE_LEVEL_HEIGHTS[0])
     *   1 → tile reducido  (TILE_LEVEL_HEIGHTS[1])
     *   2 → tile muy bajo  (TILE_LEVEL_HEIGHTS[2])
     *   3 → impasable      (invisible si TILE_LEVEL_3_VISIBLE = false)
     */
    syncTiles(board) {
        for (const [key, clone] of this.tileMeshes) {
            const [row, col] = key.split(',').map(Number);

            // Las casillas de portería nunca cambian
            if (board.isGoalArea(row, col)) continue;

            const level = Math.min(board.getLevel(row, col), 3);

            if (level === 3 && !TILE_LEVEL_3_VISIBLE) {
                clone.visible = false;
                continue;
            }

            clone.visible = true;
            const scaleY = TILE_LEVEL_HEIGHTS[level];

            // ── AJUSTE: cómo se hunden los tiles ──────────────
            // scaleY reduce la altura del tile progresivamente.
            // El tile se "hunde" bajando su Y para que quede al ras del suelo.
            clone.scale.set(TILE_SCALE_XZ, scaleY, TILE_SCALE_XZ);
            // Bajar el tile proporcionalmente para que no flote
            clone.position.y = -(1 - scaleY) * 0.5;
            // ─────────────────────────────────────────────────
        }
    }

    hideFallbackTiles(cellMeshes) {
        if (!cellMeshes || this.tileMeshes.size === 0) return;
        cellMeshes.forEach(m => { m.visible = false; });
    }

    // ──────────────────────────────────────────────────────────
    //  PERSONAJES
    // ──────────────────────────────────────────────────────────

    async _loadCharacters() {
        await Promise.allSettled(this.pieces.map(p => this._loadOneCharacter(p)));
    }

    async _loadOneCharacter(piece) {
        const pos = POSITION_FOLDER[piece.type] ?? 'Forward';
        const team = piece.team === 'A' ? 'CharacterA' : 'CharacterB';
        const path = `/assets/3D/Shared/Characters/${pos}/${team}/${team}.gltf`;
        try {
            const obj = await this._loadGLTF(path);
            obj.name = `Char_${piece.id}`;
            obj.userData = { ...obj.userData, type: 'character', pieceId: piece.id };
            obj.traverse(c => {
                if (c.isMesh) {
                    c.castShadow = c.receiveShadow = true;
                    c.userData = { ...c.userData, type: 'character', pieceId: piece.id };
                }
            });
            this._positionCharacter(obj, piece);
            this.scene.add(obj);
            this.characterMeshes.set(piece.id, obj);
        } catch (e) {
            console.warn(`[SceneBuilder3D] Personaje ${piece.id} no cargado:`, e);
        }
    }

    _positionCharacter(obj, piece) {
        // ── AJUSTE: Personajes ─────────────────────────────────
        obj.position.set(
            piece.col * CELL_SIZE,
            0.5,                       // Y ← sube si queda hundido en el tile
            piece.row * CELL_SIZE
        );
        obj.scale.set(0.7, 0.7, 0.7);      // ← ESCALA del personaje
        obj.rotation.set(0, piece.team === 'B' ? Math.PI : 0, 0);
        // ──────────────────────────────────────────────────────
    }

    // ──────────────────────────────────────────────────────────
    //  PELOTA
    // ──────────────────────────────────────────────────────────

    async _loadBall() {
        const n = this._ballIndex;
        const path = `/assets/3D/Shared/Balls/Ball_${n}/ball_${n}.gltf`;
        try {
            const obj = await this._loadGLTF(path);
            obj.name = `Ball_${n}`;
            obj.userData = { type: 'ball', isBall3D: true };
            obj.traverse(c => { if (c.isMesh) { c.castShadow = c.receiveShadow = true; } });

            // ── AJUSTE: Pelota ─────────────────────────────────
            obj.position.set(0, 0.5, 0.5);  // offset LOCAL al personaje portador
            obj.scale.set(0.2, 0.2, 0.2);    // ← ESCALA de la pelota
            // ──────────────────────────────────────────────────

            this.ballObject = obj;
            this._attachBall(this.pieces);
        } catch (e) {
            console.warn('[SceneBuilder3D] Pelota no cargada:', e);
        }
    }

    _attachBall(pieces) {
        if (!this.ballObject) return;
        if (this.ballObject.parent) this.ballObject.parent.remove(this.ballObject);

        const holder = pieces.find(p => p.hasBall);
        const charMesh = holder ? this.characterMeshes.get(holder.id) : null;

        if (charMesh) {
            // ── AJUSTE: offset local pelota ──────────────────
            this.ballObject.position.set(0, 0.25, 0.1);
            // ─────────────────────────────────────────────────
            charMesh.add(this.ballObject);
        } else {
            this.ballObject.position.set(2, 0.3, 4.5);
            this.scene.add(this.ballObject);
        }
    }

    // ──────────────────────────────────────────────────────────
    //  SINCRONIZACIÓN
    // ──────────────────────────────────────────────────────────

    /** Llama desde Renderer3D.updateScene() tras cada acción. */
    syncCharacters(pieces) {
        for (const piece of pieces) {
            const obj = this.characterMeshes.get(piece.id);
            if (obj) this._positionCharacter(obj, piece);
        }
        this._attachBall(pieces);
    }

    // ──────────────────────────────────────────────────────────
    //  LIMPIEZA
    // ──────────────────────────────────────────────────────────

    dispose() {
        this.characterMeshes.forEach(o => this.scene.remove(o));
        this.tileMeshes.forEach(o => this.scene.remove(o));
        if (this.skyObject) this.scene.remove(this.skyObject);
        if (this.waterMesh) this.scene.remove(this.waterMesh);
        if (this.ballObject?.parent) this.ballObject.parent.remove(this.ballObject);
        else if (this.ballObject) this.scene.remove(this.ballObject);
        this.characterMeshes.clear();
        this.tileMeshes.clear();
        this.ballObject = this.skyObject = this.waterMesh = null;
    }
}
