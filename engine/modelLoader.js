/**
 * ═══════════════════════════════════════════════════════════════════════════════
 *  ModelLoader.js  —  Cargador universal de modelos 3D para Three.js
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 *  Uso mínimo:
 *    const loader = new ModelLoader({ scene });
 *    const { object } = await loader.load({
 *        tipo:    'glb',
 *        carpeta: 'XenSupport',
 *        archivo: 'xensupport.glb',
 *        nombre:  'Nave',
 *    });
 *
 *  Tipos soportados: 'obj', 'gltf', 'glb', 'fbx', 'usdz'
 *
 *  Estructura de carpetas esperada (configurable):
 *
 *    Para OBJ / FBX / GLB / USDZ:
 *      <basePath>/<carpeta>/source/<archivo>.<ext>
 *      <basePath>/<carpeta>/textures/<imagen>.<ext>   ← texturas separadas
 *
 *    Para GLTF (porque referencia .bin y texturas de forma relativa):
 *      <basePath>/<carpeta>/source/<archivo>.gltf
 *      <basePath>/<carpeta>/source/scene.bin          ← junto al .gltf
 *      <basePath>/<carpeta>/source/textures/<imagen>  ← junto al .gltf
 *
 *  El parámetro `carpeta` acepta rutas flexibles:
 *    'XenSupport'              →  <basePath>/XenSupport/source/...
 *    '../assets/XenSupport'   →  sube un nivel, luego assets/XenSupport/source/...
 *    '../../shared/robots'    →  sube dos niveles
 *    '/absolute/path/robot'   →  ruta absoluta (ignora basePath)
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

import * as THREE from 'three';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
// USDZ solo está disponible en Safari/iOS y requiere AR Quick Look.
// Lo incluimos como referencia; si lo necesitas en desktop usa un conversor previo.
// import { USDZLoader } from 'three/addons/loaders/USDZLoader.js';


// ─────────────────────────────────────────────────────────────────────────────
// Clase principal
// ─────────────────────────────────────────────────────────────────────────────

export class ModelLoader {
    /**
     * @param {Object}  config
     * @param {string}  [config.basePath='models']   Ruta raíz donde viven todos los modelos.
     *                                                Puede ser relativa o absoluta.
     * @param {THREE.Scene}            [config.scene]   Si se provee, los modelos se añaden
     *                                                   automáticamente a la escena al cargar.
     * @param {THREE.LoadingManager}   [config.manager] LoadingManager compartido (opcional).
     *                                                   Si no se pasa se crea uno interno.
     * @param {boolean} [config.verbose=true]           Imprime logs de progreso y errores.
     */
    constructor({ basePath = 'models', scene = null, manager = null, verbose = true } = {}) {
        // Normaliza basePath: elimina trailing slash
        this.basePath = basePath.replace(/\/+$/, '');
        this.scene = scene;
        this.verbose = verbose;

        // Si no nos pasan un manager, creamos uno propio con logs
        this.manager = manager ?? this._crearManager();
    }


    // ─────────────────────────────────────────────────────────────────────────
    // MÉTODO PRINCIPAL
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Carga un modelo 3D de cualquier tipo soportado.
     *
     * @param {Object}  opts
     * @param {string}  opts.tipo      Extensión/tipo: 'obj' | 'gltf' | 'glb' | 'fbx' | 'usdz'
     * @param {string}  opts.carpeta   Nombre de la carpeta del modelo (o ruta relativa/absoluta).
     * @param {string}  opts.archivo   Nombre del archivo CON extensión. P.ej. 'robot.fbx'
     * @param {string}  [opts.nombre]  Nombre que se le asigna al Object3D. Default: opts.archivo
     *
     * @param {THREE.Vector3} [opts.posicion]  Posición en la escena. Default: (0, 0, 0)
     * @param {THREE.Vector3} [opts.rotacion]  Rotación en GRADOS (x, y, z). Default: (0, 0, 0)
     * @param {THREE.Vector3} [opts.escala]    Escala. Default: (1, 1, 1)
     *
     * @param {boolean} [opts.agregarAEscena=true]  Añadir automáticamente a this.scene.
     *                                               Requiere que scene esté definido.
     *
     * @param {number|string} [opts.animacion]  Animación por defecto a reproducir.
     *                                          - número: índice en object.animations[]
     *                                          - string: nombre del clip
     *                                          - 'todas': reproduce todas en loop
     *                                          - null/undefined: no reproduce ninguna
     *
     * @param {boolean} [opts.tieneMTL=true]   Solo para OBJ. false si el .obj no tiene .mtl
     *
     * @returns {Promise<ModelResult>}
     *   { object, mixer, animations, meta }
     *   - object:     THREE.Object3D listo en escena
     *   - mixer:      THREE.AnimationMixer | null
     *   - animations: Array<THREE.AnimationClip>
     *   - meta:       { tipo, carpeta, archivo, rutas }  — útil para debug
     */
    async load(opts = {}) {
        const {
            tipo,
            carpeta,
            archivo,
            nombre = archivo,
            posicion = new THREE.Vector3(0, 0, 0),
            rotacion = new THREE.Vector3(0, 0, 0),
            escala = new THREE.Vector3(1, 1, 1),
            agregarAEscena = true,
            animacion = null,
            tieneMTL = true,
        } = opts;

        // Validación mínima
        if (!tipo) throw new Error('[ModelLoader] Falta el parámetro "tipo".');
        if (!carpeta) throw new Error('[ModelLoader] Falta el parámetro "carpeta".');
        if (!archivo) throw new Error('[ModelLoader] Falta el parámetro "archivo".');

        const tipoNorm = tipo.toLowerCase().replace('.', ''); // 'glb', 'gltf', etc.
        const rutas = this._resolverRutas(tipoNorm, carpeta, archivo);

        this._log(`⏳ Cargando [${tipoNorm.toUpperCase()}] "${nombre}"...`);
        this._log(`   → ${rutas.modelo}`);

        // Delegar al método específico
        let rawResult;
        switch (tipoNorm) {
            case 'obj':
                rawResult = await this._cargarOBJ(rutas, nombre, tieneMTL);
                break;
            case 'gltf':
            case 'glb':
                rawResult = await this._cargarGLTF(rutas, nombre);
                break;
            case 'fbx':
                rawResult = await this._cargarFBX(rutas, nombre);
                break;
            case 'usdz':
                rawResult = await this._cargarUSDZ(rutas, nombre);
                break;
            default:
                throw new Error(`[ModelLoader] Tipo "${tipo}" no soportado. Usa: obj, gltf, glb, fbx, usdz`);
        }

        // Aplicar transformaciones
        const { object, animations = [] } = rawResult;
        this._aplicarTransformaciones(object, { posicion, rotacion, escala });

        // Configurar animaciones
        const mixer = this._configurarAnimaciones(object, animations, animacion);

        // Añadir a escena si corresponde
        if (agregarAEscena && this.scene) {
            this.scene.add(object);
        } else if (agregarAEscena && !this.scene) {
            this._warn(`"agregarAEscena" es true pero no se proporcionó "scene" al constructor.`);
        }

        this._log(`✅ [${tipoNorm.toUpperCase()}] "${nombre}" listo.`);

        return {
            object,
            mixer,
            animations,
            meta: { tipo: tipoNorm, carpeta, archivo, rutas },
        };
    }


    // ─────────────────────────────────────────────────────────────────────────
    // RESOLUCIÓN DE RUTAS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Construye todas las rutas necesarias para un tipo de modelo.
     *
     * Lógica de "carpeta":
     *   Si empieza con '/' → ruta absoluta, ignora this.basePath
     *   Si contiene '../'  → ruta relativa (se usa tal cual)
     *   En cualquier otro caso → se concatena con this.basePath
     *
     * Resultado para cada tipo:
     *   OBJ:  { modelo: .../source/x.obj, mtl: .../source/x.mtl, texturas: .../textures/ }
     *   GLTF: { modelo: .../source/x.gltf, texturas: null }  ← texturas relativas al .gltf
     *   GLB:  { modelo: .../source/x.glb,  texturas: null }  ← embebidas en el .glb
     *   FBX:  { modelo: .../source/x.fbx,  texturas: .../textures/ }
     *   USDZ: { modelo: .../source/x.usdz, texturas: null }
     */
    _resolverRutas(tipo, carpeta, archivo) {
        // Determinar la raíz de la carpeta del modelo
        let raiz;
        if (carpeta.startsWith('/')) {
            // Absoluta: ignora basePath
            raiz = carpeta;
        } else if (carpeta.startsWith('.')) {
            // Relativa explícita: '../../assets/Robot' → se usa tal cual
            raiz = carpeta;
        } else {
            // Simple: 'XenSupport' → '<basePath>/XenSupport'
            raiz = `${this.basePath}/${carpeta}`;
        }

        const sourceDir = `${raiz}/source`;
        const texturesDir = `${raiz}/textures/`;
        const archivoBase = archivo.replace(/\.[^/.]+$/, ''); // nombre sin extensión

        switch (tipo) {
            case 'obj':
                return {
                    modelo: `${sourceDir}/${archivo}`,
                    mtl: `${sourceDir}/${archivoBase}.mtl`,
                    texturas: texturesDir,
                    sourceDir,
                };
            case 'gltf':
                /**
                 * GLTF especial: el .gltf referencia .bin y texturas de forma RELATIVA
                 * a su propia ubicación. Por eso las texturas deben estar en source/textures/
                 * y NO se usa setResourcePath (causaría doble-ruta).
                 */
                return {
                    modelo: `${sourceDir}/${archivo}`,
                    texturas: null,   // el .gltf las resuelve solo
                    sourceDir,
                    nota: 'GLTF: coloca scene.bin y textures/ junto al .gltf dentro de source/',
                };
            case 'glb':
                // GLB embebe geometría y texturas → sin archivos externos
                return {
                    modelo: `${sourceDir}/${archivo}`,
                    texturas: null,
                    sourceDir,
                };
            case 'fbx':
                /**
                 * FBX: las texturas se buscan desde la carpeta donde está el .fbx.
                 * Si el modelo las referencia con rutas relativas como 'textures/x.png',
                 * Three.js las buscará desde sourceDir. Para apuntar a ../textures/
                 * usamos setResourcePath.
                 */
                return {
                    modelo: `${sourceDir}/${archivo}`,
                    texturas: texturesDir,
                    sourceDir,
                };
            case 'usdz':
                return {
                    modelo: `${sourceDir}/${archivo}`,
                    texturas: null,
                    sourceDir,
                };
        }
    }


    // ─────────────────────────────────────────────────────────────────────────
    // LOADERS ESPECÍFICOS (privados)
    // ─────────────────────────────────────────────────────────────────────────

    _cargarOBJ(rutas, nombre, tieneMTL) {
        return new Promise((resolve, reject) => {
            const loaderOBJ = new OBJLoader(this.manager);

            const onLoad = (object) => {
                object.name = nombre;
                resolve({ object, animations: [] });
            };
            const onProgress = (xhr) => {
                if (xhr.total > 0) this._log(`   ${nombre}: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
            };
            const onError = (err) => {
                this._error(`OBJ "${nombre}":`, err);
                reject(err);
            };

            if (tieneMTL) {
                const loaderMTL = new MTLLoader(this.manager);
                loaderMTL.setResourcePath(rutas.texturas); // directorio de texturas
                loaderMTL.load(
                    rutas.mtl,
                    (materials) => {
                        materials.preload();
                        loaderOBJ.setMaterials(materials);
                        loaderOBJ.load(rutas.modelo, onLoad, onProgress, onError);
                    },
                    undefined,
                    (err) => {
                        // Si el MTL no existe pero tieneMTL=true, lo ignoramos y cargamos igual
                        this._warn(`MTL no encontrado para "${nombre}", cargando sin materiales.`);
                        loaderOBJ.load(rutas.modelo, onLoad, onProgress, onError);
                    }
                );
            } else {
                loaderOBJ.load(rutas.modelo, onLoad, onProgress, onError);
            }
        });
    }

    _cargarGLTF(rutas, nombre) {
        return new Promise((resolve, reject) => {
            const loader = new GLTFLoader(this.manager);
            // NO usamos setResourcePath aquí porque causaría que el .bin
            // también se busque en el directorio equivocado.
            // El .gltf resuelve sus dependencias relativas desde su propio directorio.
            loader.load(
                rutas.modelo,
                (gltf) => {
                    const object = gltf.scene;
                    object.name = nombre;
                    resolve({ object, animations: gltf.animations ?? [] });
                },
                (xhr) => {
                    if (xhr.total > 0) this._log(`   ${nombre}: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
                },
                (err) => {
                    this._error(`GLTF/GLB "${nombre}":`, err);
                    reject(err);
                }
            );
        });
    }

    _cargarFBX(rutas, nombre) {
        return new Promise((resolve, reject) => {
            const loader = new FBXLoader(this.manager);
            // setResourcePath redirige la búsqueda de texturas al directorio correcto.
            // En FBX esto es seguro porque no hay un archivo .bin que también se vea afectado.
            loader.setResourcePath(rutas.texturas);
            loader.load(
                rutas.modelo,
                (object) => {
                    object.name = nombre;
                    resolve({ object, animations: object.animations ?? [] });
                },
                (xhr) => {
                    if (xhr.total > 0) this._log(`   ${nombre}: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
                },
                (err) => {
                    this._error(`FBX "${nombre}":`, err);
                    reject(err);
                }
            );
        });
    }

    _cargarUSDZ(rutas, nombre) {
        // USDZ requiere importar USDZLoader desde three/addons
        // Solo disponible en Safari/iOS. En otros navegadores falla silenciosamente.
        return new Promise((resolve, reject) => {
            // Importación dinámica para no romper si USDZLoader no está disponible
            import('three/addons/loaders/USDZLoader.js').then(({ USDZLoader }) => {
                const loader = new USDZLoader(this.manager);
                loader.load(
                    rutas.modelo,
                    (object) => {
                        object.name = nombre;
                        resolve({ object, animations: [] });
                    },
                    (xhr) => {
                        if (xhr.total > 0) this._log(`   ${nombre}: ${(xhr.loaded / xhr.total * 100).toFixed(1)}%`);
                    },
                    (err) => {
                        this._error(`USDZ "${nombre}":`, err);
                        reject(err);
                    }
                );
            }).catch(err => {
                this._error('USDZLoader no disponible:', err);
                reject(err);
            });
        });
    }


    // ─────────────────────────────────────────────────────────────────────────
    // TRANSFORMACIONES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Aplica posición, rotación (en grados) y escala a un Object3D.
     * Acepta THREE.Vector3 o arrays [x, y, z] por comodidad.
     */
    _aplicarTransformaciones(object, { posicion, rotacion, escala }) {
        // Acepta tanto THREE.Vector3 como arrays simples [x, y, z]
        const toVec = (v) => Array.isArray(v) ? new THREE.Vector3(...v) : v;

        const p = toVec(posicion);
        const r = toVec(rotacion);
        const s = toVec(escala);

        object.position.copy(p);
        object.rotation.set(
            THREE.MathUtils.degToRad(r.x),
            THREE.MathUtils.degToRad(r.y),
            THREE.MathUtils.degToRad(r.z)
        );
        object.scale.copy(s);
    }


    // ─────────────────────────────────────────────────────────────────────────
    // ANIMACIONES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Configura el AnimationMixer y reproduce la animación indicada.
     *
     * @param {THREE.Object3D}          object
     * @param {THREE.AnimationClip[]}   animations
     * @param {number|string|null}      animacion   Ver docstring de load()
     * @returns {THREE.AnimationMixer|null}
     */
    _configurarAnimaciones(object, animations, animacion) {
        if (!animations || animations.length === 0) return null;

        const mixer = new THREE.AnimationMixer(object);
        this._log(`   ↳ ${animations.length} animación(es) disponibles.`);

        if (animacion === null || animacion === undefined) {
            // No reproducir nada, pero el mixer sigue disponible
            return mixer;
        }

        if (animacion === 'todas') {
            animations.forEach(clip => mixer.clipAction(clip).play());
            return mixer;
        }

        if (typeof animacion === 'number') {
            const clip = animations[animacion];
            if (clip) {
                mixer.clipAction(clip).play();
                this._log(`   ↳ Reproduciendo animación [${animacion}]: "${clip.name}"`);
            } else {
                this._warn(`Índice de animación ${animacion} no existe (hay ${animations.length}).`);
            }
            return mixer;
        }

        if (typeof animacion === 'string') {
            const clip = THREE.AnimationClip.findByName(animations, animacion);
            if (clip) {
                mixer.clipAction(clip).play();
                this._log(`   ↳ Reproduciendo animación "${animacion}"`);
            } else {
                this._warn(`Animación "${animacion}" no encontrada. Disponibles: ${animations.map(c => c.name).join(', ')}`);
            }
            return mixer;
        }

        return mixer;
    }


    // ─────────────────────────────────────────────────────────────────────────
    // UTILIDADES
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Crea un LoadingManager con logs automáticos.
     */
    _crearManager() {
        const m = new THREE.LoadingManager();
        m.onStart = (url, loaded, total) => this._log(`[Manager] Iniciando: ${url}  (${loaded}/${total})`);
        m.onProgress = (url, loaded, total) => this._log(`[Manager] Progreso: ${url}  (${loaded}/${total})`);
        m.onLoad = () => this._log('[Manager] ✅ Todos los assets cargados.');
        m.onError = (url) => this._error('[Manager] Error cargando:', url);
        return m;
    }

    _log(...args) { if (this.verbose) console.log('[ModelLoader]', ...args); }
    _warn(...args) { if (this.verbose) console.warn('[ModelLoader]', ...args); }
    _error(...args) { console.error('[ModelLoader]', ...args); }
}