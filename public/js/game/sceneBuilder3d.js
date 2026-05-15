// ============================================================
//  TILEKICK — SceneBuilder3D
// ============================================================

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';

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

// ── Iluminación por tema ─────────────────────────────────────
//
// Cada tema tiene su propio preset de luces para que la
// atmósfera se sienta coherente con el escenario:
//
//   grass  → día soleado / estadio de fútbol clásico
//   sand   → tarde cálida en la playa, luz dorada
//   cement → urbano nublado, luz fría y difusa
//
const LIGHT_PRESETS = {
    grass: {
        hemi:     { sky: 0x9ec8f5, ground: 0x3a6b28, intensity: 0.65 },
        sun:      { color: 0xfff8e8, intensity: 1.3 },
        fill:     { color: 0x4488cc, intensity: 0.28, pos: [-5, 5, -8] },
        exposure: 0.55,
    },
    sand: {
        hemi:     { sky: 0xf0c870, ground: 0xb87040, intensity: 0.75 },
        sun:      { color: 0xffcc55, intensity: 1.1 },   // sol naranja dorado
        fill:     { color: 0xff9944, intensity: 0.20, pos: [-5, 4, -7] },  // rebote cálido
        exposure: 0.50,
    },
    cement: {
        hemi:     { sky: 0x8899bb, ground: 0x3a3f4a, intensity: 0.55 },
        sun:      { color: 0xdde8f5, intensity: 0.75 },  // sol frío / nublado
        fill:     { color: 0x5566aa, intensity: 0.32, pos: [-4, 7, -6] },
        exposure: 0.44,
    },
};

// ── Parámetros del Sky por tema ──────────────────────────────
// turbidity   [0–20]:  opacidad del aire (0=despejado, 20=brumoso)
// rayleigh    [0–4]:   dispersión de luz azul del cielo
// mieCoef     [0–0.1]: dispersión de partículas (niebla/polvo)
// mieDir      [0–1]:   dirección del scattering (0=difuso, 1=puntual)
// elevation   [0–90]:  altura del sol en grados
// azimuth     [0–360]: orientación del sol (0/360=Norte, 180=Sur)
const SKY_PRESETS = {
    grass:  { turbidity: 2.5, rayleigh: 1.5, mieCoef: 0.002, mieDir: 0.75, elevation: 28, azimuth: 160 },
    sand:   { turbidity: 7.0, rayleigh: 2.0, mieCoef: 0.012, mieDir: 0.90, elevation: 10, azimuth: 220 },
    cement: { turbidity: 12,  rayleigh: 0.5, mieCoef: 0.045, mieDir: 0.60, elevation: 40, azimuth: 200 },
};

// ── Agua por tema — shader sinusoidal propio ─────────────────
//
// En lugar del Water addon de Three.js (espejo de reflexión),
// usamos un ShaderMaterial custom con desplazamiento real de
// vértices en ondas sinusoidales superpuestas.
//
// colorShallow → color en las crestas de ola (más claro)
// colorDeep    → color en los valles (más oscuro/profundo)
// amplitude    → altura de las olas en unidades Three.js
// frequency    → densidad de las olas (más = olas pequeñas)
// speed        → velocidad de la animación
//
const WATER_PRESETS = {
    grass: {
        enabled:      true,
        colorShallow: 0x1a9e8a,   // turquesa suave (canal tranquilo)
        colorDeep:    0x033d50,   // azul profundo
        amplitude:    0.045,
        frequency:    2.2,
        speed:        0.45,
        alpha:        0.82,
    },
    sand: {
        enabled:      true,
        colorShallow: 0x00b4d8,   // azul caribe brillante
        colorDeep:    0x023e8a,   // azul mar profundo
        amplitude:    0.09,
        frequency:    1.8,
        speed:        0.85,
        alpha:        0.86,
    },
    cement: {
        enabled:      true,
        colorShallow: 0x2d4a5a,   // agua urbana oscura
        colorDeep:    0x0d1a22,
        amplitude:    0.022,
        frequency:    3.2,
        speed:        0.18,
        alpha:        0.70,
    },
};

// Shaders GLSL para el agua estilizada
const WATER_VERTEX_SHADER = /* glsl */`
    uniform float uTime;
    uniform float uAmplitude;
    uniform float uFrequency;
    uniform float uSpeed;

    varying float vHeight;
    varying vec2  vUv;

    void main() {
        vUv = uv;
        vec3 pos = position;

        // Tres oleadas superpuestas en distintas direcciones y frecuencias
        float w1 = sin(pos.x * uFrequency        + uTime * uSpeed)        * uAmplitude;
        float w2 = sin(pos.z * uFrequency * 0.75 + uTime * uSpeed * 1.3)  * uAmplitude * 0.65;
        float w3 = sin((pos.x * 0.6 + pos.z * 0.8) * uFrequency * 1.2
                       + uTime * uSpeed * 0.85)                            * uAmplitude * 0.42;

        float wave = w1 + w2 + w3;
        pos.y    += wave;
        vHeight   = wave / (uAmplitude * 2.1);   // normalizado [-0.5, 0.5]

        gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
    }
`;

const WATER_FRAGMENT_SHADER = /* glsl */`
    uniform vec3  uColorShallow;
    uniform vec3  uColorDeep;
    uniform float uOpacity;
    uniform float uTime;

    varying float vHeight;
    varying vec2  vUv;

    void main() {
        // Mezcla de color profundo → superficial según altura de ola
        float t = clamp(vHeight + 0.5, 0.0, 1.0);
        vec3 color = mix(uColorDeep, uColorShallow, t);

        // Destellos de luz en superficie (shimmer)
        float sh = sin(vUv.x * 32.0 + uTime * 2.8) * sin(vUv.y * 28.0 + uTime * 2.1) * 0.055;
        color += max(sh, 0.0);

        // Espuma suave en las crestas
        float foam = smoothstep(0.30, 0.50, vHeight);
        color = mix(color, vec3(0.92, 0.97, 1.0), foam * 0.22);

        gl_FragColor = vec4(color, uOpacity);
    }
`;

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
        const themeData  = THEME_MAP[this.theme];
        const lightCfg   = LIGHT_PRESETS[this.theme] ?? LIGHT_PRESETS.grass;
        const waterPreset = WATER_PRESETS[this.theme] ?? WATER_PRESETS.grass;

        // Tone mapping — exposure se actualiza en _buildSky() según tema
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = lightCfg.exposure;

        try {
            if (this.quality === 'low') {
                this._buildSky(themeData);
                if (waterPreset.enabled) this._buildWater();
            } else {
                // Sky PRIMERO → scene.environment listo antes de que los
                // materiales GLTF se registren en la escena
                this._buildSky(themeData);
                if (waterPreset.enabled) this._buildWater();

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
        const skyCfg   = SKY_PRESETS[this.theme]   ?? SKY_PRESETS.grass;
        const lightCfg = LIGHT_PRESETS[this.theme]  ?? LIGHT_PRESETS.grass;

        // ── 1. Sky dome ───────────────────────────────────────
        const sky = new Sky();
        sky.scale.setScalar(10000);
        this.scene.add(sky);
        const u = sky.material.uniforms;
        u['turbidity'].value       = skyCfg.turbidity;
        u['rayleigh'].value        = skyCfg.rayleigh;
        u['mieCoefficient'].value  = skyCfg.mieCoef;
        u['mieDirectionalG'].value = skyCfg.mieDir;

        const phi    = THREE.MathUtils.degToRad(90 - skyCfg.elevation);
        const theta  = THREE.MathUtils.degToRad(skyCfg.azimuth);
        const sunVec = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
        u['sunPosition'].value.copy(sunVec);
        this.scene.background = null;
        this.skyObject = sky;

        // Guardar sunVec para el Water (evita el bug del "espejo")
        this._sunVec = sunVec.clone();

        // ── 2. Aplicar exposure del tema al renderer ──────────
        this.renderer.toneMappingExposure = lightCfg.exposure;

        // ── 3. Alinear luces de escena con sky del tema ───────
        this.scene.traverse(child => {
            if (child.isDirectionalLight && child.castShadow) {
                child.position.copy(sunVec.clone().multiplyScalar(20));
                child.color.setHex(lightCfg.sun.color);
                child.intensity = lightCfg.sun.intensity;
            }
            if (child.isHemisphereLight) {
                child.color.setHex(lightCfg.hemi.sky);
                child.groundColor.setHex(lightCfg.hemi.ground);
                child.intensity = lightCfg.hemi.intensity;
            }
            if (child.isDirectionalLight && !child.castShadow) {
                // Luz de relleno (fill light)
                const fp = lightCfg.fill.pos ?? [-5, 5, -8];
                child.position.set(fp[0], fp[1], fp[2]);
                child.color.setHex(lightCfg.fill.color);
                child.intensity = lightCfg.fill.intensity;
            }
        });

        // ── 4. IBL: hornear el sky como environment map ───────
        //
        // PMREMGenerator convierte el sky en iluminación global
        // (diffuse + specular) para los materiales PBR de los GLTF.
        const ENV_MAP_INTENSITY = 1.0;

        const pmrem = new THREE.PMREMGenerator(this.renderer);
        pmrem.compileEquirectangularShader();

        const skyScene = new THREE.Scene();
        skyScene.add(sky.clone());
        const envRT = pmrem.fromScene(skyScene);
        pmrem.dispose();

        this.scene.environment = envRT.texture;
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
        const preset = WATER_PRESETS[this.theme] ?? WATER_PRESETS.grass;
        if (!preset.enabled) return;

        // PlaneGeometry con muchos segmentos → los vértices se desplazan
        // individualmente creando oleaje geométrico real, no solo normal-map.
        const geo = new THREE.PlaneGeometry(15, 15, 90, 90);

        const material = new THREE.ShaderMaterial({
            uniforms: {
                uTime:         { value: 0.0 },
                uAmplitude:    { value: preset.amplitude },
                uFrequency:    { value: preset.frequency },
                uSpeed:        { value: preset.speed },
                uColorShallow: { value: new THREE.Color(preset.colorShallow) },
                uColorDeep:    { value: new THREE.Color(preset.colorDeep) },
                uOpacity:      { value: preset.alpha },
            },
            vertexShader:   WATER_VERTEX_SHADER,
            fragmentShader: WATER_FRAGMENT_SHADER,
            transparent:    true,
            side:           THREE.DoubleSide,
            depthWrite:     false,
        });

        const water = new THREE.Mesh(geo, material);
        // Rotar de XY (defecto) a XZ (horizontal)
        water.rotation.x = -Math.PI / 2;
        // Posición: centrado debajo del tablero y extendido alrededor
        water.position.set(2, -0.15, -10);
        water.name = 'WaterPlane';

        this.scene.add(water);
        this.waterMesh = water;
    }

    // ──────────────────────────────────────────────────────────
    //  ANIMACIÓN DEL AGUA (llamar en el loop de render)
    // ──────────────────────────────────────────────────────────

    tickWater(delta) {
        if (!this.waterMesh?.material?.uniforms?.uTime) return;
        this.waterMesh.material.uniforms.uTime.value += delta;
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
