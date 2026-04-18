import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mysql from 'mysql2';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const port = process.env.PORT || 3000;

const publicDir = path.join(__dirname, '..', 'public');
const page = (relativePath) => path.join(publicDir, 'pages', relativePath);

const pages = {
    welcome: page('index.html'),
    login: page('auth/login.html'),
    register: page('auth/register.html'),
    dashboard: page('protected/dashboard.html'),
    profile: page('protected/profile.html'),
    settings: page('protected/settings.html'),
    leaderboard: page('protected/leaderboard.html'),
    gameMenu: page('protected/game/menu.html'),
    gameWaiting: page('protected/game/waiting.html'),
    game2D: page('protected/game/game2d.html'),
    game3D: page('protected/game/game3d.html'),
};

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(publicDir));

app.use('/engine', express.static(path.join(__dirname, '..', 'engine')));

/**
 * Database
 */
const db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

db.connect((err) => {
    if (err) {
        console.error('Error al conectar a la base de datos:', err.stack);
        return;
    }
    console.log('Conectado a la base de datos');
});

/**
 * Middleware de autenticación
 * Verificamos el token JWT guardado en la cookie 'auth_token'.
 * Si no existe o es inválido, redirigimos al login.
 */
const requireAuth = (req, res, next) => {
    const token = req.cookies?.auth_token;
    if (!token) return res.redirect('/login');

    try {
        const decoded = jwt.verify(token, process.env.TOKEN_SECRET);
        req.user = decoded;
        next();
    } catch {
        res.clearCookie('auth_token');
        res.redirect('/login');
    }
};

/**
 * Routes — Públicas
 */
app.get('/', (req, res) => {
    res.sendFile(pages.welcome);
});

// Auth
app.route('/login')
    .get((req, res) => {
        // Si ya tiene sesión activa, redirigimos al dashboard
        if (req.cookies?.auth_token) {
            try {
                jwt.verify(req.cookies.auth_token, process.env.TOKEN_SECRET);
                return res.redirect('/dashboard');
            } catch {
                res.clearCookie('auth_token');
            }
        }
        res.sendFile(pages.login);
    })
    .post(async (req, res) => {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
        }

        const sql = `SELECT * FROM users WHERE username = ?`;
        db.query(sql, [username], async (err, result) => {
            if (err) {
                console.error('Error al iniciar sesión:', err.stack);
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            if (result.length === 0) {
                return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
            }

            const user = result[0];
            const passwordMatch = await bcrypt.compare(password, user.password);
            if (!passwordMatch) {
                return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
            }

            const token = jwt.sign(
                { id: user.id, username: user.username, email: user.email, name: user.name },
                process.env.TOKEN_SECRET,
                { expiresIn: '1h' }
            );

            // Guardamos el token en cookie httpOnly
            res.cookie('auth_token', token, {
                httpOnly: true,
                maxAge: 60 * 60 * 1000, // 1 hora
                sameSite: 'strict',
            });

            res.json({ ok: true });
        });
    });

app.route('/register')
    .get((req, res) => {
        res.sendFile(pages.register);
    })
    .post(async (req, res) => {
        const { name, username, email, password, confirmPassword } = req.body;
        const now = new Date();

        if (!name || !username || !email || !password || !confirmPassword) {
            return res.status(400).json({ error: 'Todos los campos son requeridos' });
        }
        if (password !== confirmPassword) {
            return res.status(400).json({ error: 'Las contraseñas no coinciden' });
        }

        const saltRounds = parseInt(process.env.SALT_ROUNDS) || 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const checkSql = `SELECT id FROM users WHERE username = ? OR email = ?`;
        db.query(checkSql, [username, email], (err, existing) => {
            if (err) {
                console.error('Error al verificar usuario:', err.stack);
                return res.status(500).json({ error: 'Error interno del servidor' });
            }
            if (existing.length > 0) {
                return res.status(409).json({ error: 'El usuario o correo ya está registrado' });
            }

            const sql = `INSERT INTO users (name, username, email, password, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`;
            db.query(sql, [name, username, email, hashedPassword, now, now], (err2) => {
                if (err2) {
                    console.error('Error al registrar usuario:', err2.stack);
                    return res.status(500).json({ error: 'Error al registrar usuario' });
                }
                res.status(201).json({ message: 'Usuario registrado exitosamente' });
            });
        });
    });

// Logout — Limpiamos cookie y redirigimos al inicio
app.get('/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.redirect('/login');
});

/**
 * Routes — Protegidas (requieren sesión)
 */
app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(pages.dashboard);
});

app.get('/profile', requireAuth, (req, res) => {
    res.sendFile(pages.profile);
});

app.get('/settings', requireAuth, (req, res) => {
    res.sendFile(pages.settings);
});

app.get('/leaderboard', requireAuth, (req, res) => {
    res.sendFile(pages.leaderboard);
});

app.get('/game/menu', requireAuth, (req, res) => {
    res.sendFile(pages.gameMenu);
});

app.get('/game/waiting', requireAuth, (req, res) => {
    res.sendFile(pages.gameWaiting);
});

app.get('/game/2d', requireAuth, (req, res) => {
    res.sendFile(pages.game2D);
});

app.get('/game/3d', requireAuth, (req, res) => {
    res.sendFile(pages.game3D);
});

/**
 * API — Usuario actual
 */
app.get('/api/me', requireAuth, (req, res) => {
    res.json(req.user);
});

/**
 * Sockets — Matchmaking + Juego online
 *
 * Cola de espera: Map<key, { socketId, username }>
 * key = "map:gameType"
 */
const waitingQueue = new Map();

io.on('connection', (socket) => {
    console.log(`[Socket] Conectado: ${socket.id}`);

    // --- El jugador entra a la sala de espera ---
    socket.on('join-waiting-room', ({ mode, map, gameType, username }) => {
        if (mode !== 'online') return;

        const key = `${map}:${gameType}`;
        const waiting = waitingQueue.get(key);

        if (waiting) {
            waitingQueue.delete(key);
            socket.data.waitingKey = null;

            const roomId = randomUUID().slice(0, 8).toUpperCase();

            socket.join(roomId);
            const opponentSocket = io.sockets.sockets.get(waiting.socketId);
            opponentSocket?.join(roomId);

            io.to(roomId).emit('match-found', {
                roomId,
                gameType,
                players: [
                    { socketId: waiting.socketId, username: waiting.username },
                    { socketId: socket.id, username },
                ],
            });

            console.log(`[Match] Room ${roomId}: ${waiting.username} vs ${username} | ${map} ${gameType.toUpperCase()}`);
        } else {
            waitingQueue.set(key, { socketId: socket.id, username });
            socket.data.waitingKey = key;
            socket.emit('waiting', { count: 1 });
            console.log(`[Queue] ${username} esperando: ${key}`);
        }
    });

    // --- El jugador cancela la búsqueda ---
    socket.on('leave-waiting-room', () => {
        const key = socket.data.waitingKey;
        if (key && waitingQueue.get(key)?.socketId === socket.id) {
            waitingQueue.delete(key);
            socket.data.waitingKey = null;
        }
    });

    // --- El jugador entra a la sala del juego ---
    // Asignamos el equipo A al primer jugador y el equipo B al segundo
    socket.on('join-room', ({ roomId, username }) => {
        socket.join(roomId);
        socket.data.roomId = roomId;
        socket.data.username = username;

        const roomSockets = io.sockets.adapter.rooms.get(roomId);
        const roomSize = roomSockets?.size ?? 1;

        // Recolectar jugadores ya presentes (con equipo asignado)
        const existingPlayers = [];
        if (roomSockets) {
            for (const sid of roomSockets) {
                if (sid === socket.id) continue;
                const s = io.sockets.sockets.get(sid);
                if (s?.data?.team) {
                    existingPlayers.push({
                        socketId: sid,
                        username: s.data.username,
                        team: s.data.team,
                    });
                }
            }
        }

        // Primer jugador → A, segundo → B
        //      Podriamos despues hacerlo aleatorio
        const myTeam = existingPlayers.length === 0 ? 'A' : 'B';
        socket.data.team = myTeam;

        // Le decimos a cada socket que equipo tiene
        socket.emit('team-assigned', {
            myTeam,
            roomId,
            players: existingPlayers,
        });

        // Avisamos que alguien entró
        io.to(roomId).emit('player-joined', {
            socketId: socket.id,
            username,
            team: myTeam,
            playerCount: roomSize,
        });

        console.log(`[Room ${roomId}] ${username} → Equipo ${myTeam} (${roomSize}/2)`);
    });

    // --- Relay de acciones del juego ---
    socket.on('game-action', (action) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;

        socket.to(roomId).emit('opponent-action', {
            ...action,
            fromTeam: socket.data.team,
        });

        console.log(`[Room ${roomId}] ${socket.data.username} (${socket.data.team}): ${action.type}`);
    });

    // --- Desconexiones ---
    socket.on('disconnect', () => {
        const key = socket.data.waitingKey;
        if (key && waitingQueue.get(key)?.socketId === socket.id) {
            waitingQueue.delete(key);
        }

        const roomId = socket.data.roomId;
        if (roomId) {
            io.to(roomId).emit('player-left', {
                socketId: socket.id,
                username: socket.data.username,
                team: socket.data.team,
            });
            console.log(`[Room ${roomId}] ${socket.data.username} (${socket.data.team}) se desconectó`);
        }

        console.log(`[Socket] Desconectado: ${socket.id}`);
    });
});

/**
 * Listen
 */
server.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});