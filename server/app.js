import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import mysql from 'mysql2';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID, randomBytes } from 'crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import nodemailer from 'nodemailer';
import multer from 'multer';
import sharp from 'sharp';
import fs from 'fs';

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
    recovery: page('auth/recovery.html'),
    dashboard: page('protected/dashboard.html'),
    profile: page('protected/profile.html'),
    settings: page('protected/settings.html'),
    leaderboard: page('protected/leaderboard.html'),
    rules: page('protected/rules.html'),
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
app.use('/storage', express.static(path.join(__dirname, '..', 'storage')));
app.use('/assets', express.static(path.join(__dirname, '..', 'assets')));

// Multer — solo en memoria, sharp se encarga del disco
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024 },  // 4 MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        cb(null, allowed.includes(file.mimetype));
    },
});

const avatarsDir = path.join(__dirname, '..', 'storage', 'avatars');
if (!fs.existsSync(avatarsDir)) fs.mkdirSync(avatarsDir, { recursive: true });

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

// Manejar errores no fatales de la conexión para evitar que Node crashee
db.on('error', (err) => {
    console.error('[DB] Error de conexión:', err.message);
});

/**
 * Mailer — Nodemailer con SMTPS (puerto 465)
 */
function createMailer() {
    return nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: parseInt(process.env.MAIL_PORT) || 465,
        secure: true, // smtps
        auth: {
            user: process.env.MAIL_USERNAME,
            pass: process.env.MAIL_PASSWORD,
        },
    });
}

/**
 * Recovery — Sesiones temporales
 * sessionKeys: Map<sessionKey, { userId, expiresAt }> — válido 10 min tras verificar
 */
const sessionKeys = new Map();

function generateToken(len = 8) {
    return randomBytes(Math.ceil(len / 2))
        .toString('hex')
        .toUpperCase()
        .slice(0, len);
}

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

            const sql = `INSERT INTO users (name, username, email, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`;
            db.query(sql, [name, username, email, hashedPassword, now, now], (err2, result2) => {
                if (err2) {
                    console.error('Error al registrar usuario:', err2.stack);
                    return res.status(500).json({ error: 'Error al registrar usuario' });
                }

                // Auto-crear registros de achievements y preferences para el nuevo usuario
                const newUserId = result2.insertId;
                db.query(
                    `INSERT IGNORE INTO user_achievements (user_id) VALUES (?)`,
                    [newUserId]
                );
                db.query(
                    `INSERT IGNORE INTO user_preferences (user_id) VALUES (?)`,
                    [newUserId]
                );

                res.status(201).json({ message: 'Usuario registrado exitosamente' });
            });
        });
    });

// Logout — Limpiamos cookie y redirigimos al inicio
app.get('/logout', (req, res) => {
    res.clearCookie('auth_token');
    res.redirect('/login');
});

// Recovery — Vista
app.get('/recovery', (req, res) => {
    res.sendFile(pages.recovery);
});

// ============================================================
//  OAuth 2.0 — Google, Facebook, GitHub
//  Flujo manual sin passport: redirect → callback → JWT → dashboard
//  provider codes: 1=google  2=facebook  3=github
// ============================================================

const OAUTH_PROVIDERS = { GOOGLE: 1, FACEBOOK: 2, GITHUB: 3 };

/**
 * Busca o crea un usuario a partir de datos OAuth.
 * Si existe social_account → reutiliza user.
 * Si no pero hay email → vincula a user existente con ese correo.
 * Si nada → crea user nuevo.
 * Emite JWT httpOnly y redirige al dashboard.
 */
function oauthFinish(provider, providerUserId, profile, res) {
    const { name, email, avatarUrl } = profile;
    const now = new Date();

    // 1. ¿Ya hay cuenta social vinculada?
    db.query(
        'SELECT user_id FROM social_accounts WHERE provider = ? AND provider_user_id = ?',
        [provider, String(providerUserId)],
        (err, rows) => {
            if (err) {
                console.error('[OAuth] DB error (lookup):', err);
                return res.redirect('/login?error=server');
            }

            if (rows.length > 0) {
                return _issueJwt(rows[0].user_id, res);
            }

            // 2. ¿Existe usuario con el mismo email?
            if (email) {
                db.query('SELECT id FROM users WHERE email = ?', [email], (err2, users) => {
                    if (err2) {
                        console.error('[OAuth] DB error (email lookup):', err2);
                        return res.redirect('/login?error=server');
                    }

                    if (users.length > 0) {
                        const userId = users[0].id;
                        db.query(
                            'INSERT IGNORE INTO social_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)',
                            [userId, provider, String(providerUserId)],
                            () => _issueJwt(userId, res)
                        );
                    } else {
                        _createOAuthUser({ name, email, avatarUrl, now }, provider, String(providerUserId), res);
                    }
                });
            } else {
                _createOAuthUser({ name, email: null, avatarUrl, now }, provider, String(providerUserId), res);
            }
        }
    );
}

function _createOAuthUser({ name, email, avatarUrl, now }, provider, providerUserId, res) {
    // Si el proveedor no entrega email (ej. GitHub con email privado),
    // usamos un placeholder con formato noreply para cumplir el NOT NULL de la BD.
    const effectiveEmail = email || `oauth_${provider}_${providerUserId}@noreply.tilekick.local`;

    const sql  = 'INSERT INTO users (name, email, avatar_url, is_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)';
    const vals = [name || 'Player', effectiveEmail, avatarUrl || null, now, now];

    db.query(sql, vals, (err, result) => {
        if (err) {
            console.error('[OAuth] DB error (insert user):', err);
            return res.redirect('/login?error=server');
        }
        const userId = result.insertId;
        db.query(
            'INSERT IGNORE INTO social_accounts (user_id, provider, provider_user_id) VALUES (?, ?, ?)',
            [userId, provider, providerUserId]
        );
        db.query('INSERT IGNORE INTO user_achievements (user_id) VALUES (?)', [userId]);
        db.query('INSERT IGNORE INTO user_preferences (user_id) VALUES (?)', [userId]);
        _issueJwt(userId, res);
    });
}

function _issueJwt(userId, res) {
    db.query('SELECT id, username, email, name FROM users WHERE id = ?', [userId], (err, rows) => {
        if (err || !rows.length) {
            console.error('[OAuth] _issueJwt error:', err);
            return res.redirect('/login?error=server');
        }
        const user  = rows[0];
        const token = jwt.sign(
            { id: user.id, username: user.username, email: user.email, name: user.name },
            process.env.TOKEN_SECRET,
            { expiresIn: '1h' }
        );
        res.cookie('auth_token', token, {
            httpOnly: true,
            maxAge: 60 * 60 * 1000,
            sameSite: 'lax',   // lax = necesario para redirects cross-site OAuth
        });
        res.redirect('/dashboard');
    });
}

// ── Google ────────────────────────────────────────────────────

app.get('/auth/google', (req, res) => {
    if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID === 'your_google_client_id_here') {
        return res.redirect('/login?error=oauth_not_configured');
    }
    const params = new URLSearchParams({
        client_id:     process.env.GOOGLE_CLIENT_ID,
        redirect_uri:  `${process.env.APP_URL}/auth/google/callback`,
        response_type: 'code',
        scope:         'openid email profile',
        access_type:   'online',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/login?error=oauth_denied');

    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body:    new URLSearchParams({
                code,
                client_id:     process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri:  `${process.env.APP_URL}/auth/google/callback`,
                grant_type:    'authorization_code',
            }),
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
            console.error('[OAuth Google] token error:', tokenData.error);
            return res.redirect('/login?error=oauth_failed');
        }

        const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` },
        });
        const profile = await userRes.json();

        oauthFinish(OAUTH_PROVIDERS.GOOGLE, profile.id, {
            name:      profile.name,
            email:     profile.email,
            avatarUrl: profile.picture,
        }, res);
    } catch (e) {
        console.error('[OAuth Google] callback error:', e);
        res.redirect('/login?error=oauth_failed');
    }
});

// ── Facebook ──────────────────────────────────────────────────

app.get('/auth/facebook', (req, res) => {
    if (!process.env.FACEBOOK_APP_ID || process.env.FACEBOOK_APP_ID === 'your_facebook_app_id_here') {
        return res.redirect('/login?error=oauth_not_configured');
    }
    const params = new URLSearchParams({
        client_id:     process.env.FACEBOOK_APP_ID,
        redirect_uri:  `${process.env.APP_URL}/auth/facebook/callback`,
        scope:         'email,public_profile',
        response_type: 'code',
    });
    res.redirect(`https://www.facebook.com/v19.0/dialog/oauth?${params}`);
});

app.get('/auth/facebook/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/login?error=oauth_denied');

    try {
        const tokenRes = await fetch(
            `https://graph.facebook.com/v19.0/oauth/access_token?` +
            new URLSearchParams({
                client_id:     process.env.FACEBOOK_APP_ID,
                client_secret: process.env.FACEBOOK_APP_SECRET,
                redirect_uri:  `${process.env.APP_URL}/auth/facebook/callback`,
                code,
            })
        );
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
            console.error('[OAuth Facebook] token error:', tokenData.error);
            return res.redirect('/login?error=oauth_failed');
        }

        const userRes = await fetch(
            `https://graph.facebook.com/me?fields=id,name,email,picture.type(large)&access_token=${tokenData.access_token}`
        );
        const profile = await userRes.json();

        oauthFinish(OAUTH_PROVIDERS.FACEBOOK, profile.id, {
            name:      profile.name,
            email:     profile.email || null,
            avatarUrl: profile.picture?.data?.url || null,
        }, res);
    } catch (e) {
        console.error('[OAuth Facebook] callback error:', e);
        res.redirect('/login?error=oauth_failed');
    }
});

// ── GitHub ────────────────────────────────────────────────────

app.get('/auth/github', (req, res) => {
    if (!process.env.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID === 'your_github_client_id_here') {
        return res.redirect('/login?error=oauth_not_configured');
    }
    const params = new URLSearchParams({
        client_id:    process.env.GITHUB_CLIENT_ID,
        redirect_uri: `${process.env.APP_URL}/auth/github/callback`,
        scope:        'read:user user:email',
    });
    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

app.get('/auth/github/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/login?error=oauth_denied');

    try {
        const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
            method:  'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept':       'application/json',
            },
            body: new URLSearchParams({
                client_id:     process.env.GITHUB_CLIENT_ID,
                client_secret: process.env.GITHUB_CLIENT_SECRET,
                code,
                redirect_uri:  `${process.env.APP_URL}/auth/github/callback`,
            }),
        });
        const tokenData = await tokenRes.json();
        if (tokenData.error) {
            console.error('[OAuth GitHub] token error:', tokenData.error);
            return res.redirect('/login?error=oauth_failed');
        }

        const [userRes, emailsRes] = await Promise.all([
            fetch('https://api.github.com/user', {
                headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'TileKick' },
            }),
            fetch('https://api.github.com/user/emails', {
                headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'TileKick' },
            }),
        ]);
        const profile = await userRes.json();
        const emails  = await emailsRes.json();

        let email = profile.email;
        if (!email && Array.isArray(emails)) {
            const primary = emails.find(e => e.primary && e.verified);
            email = primary?.email ?? null;
        }

        oauthFinish(OAUTH_PROVIDERS.GITHUB, String(profile.id), {
            name:      profile.name || profile.login,
            email,
            avatarUrl: profile.avatar_url || null,
        }, res);
    } catch (e) {
        console.error('[OAuth GitHub] callback error:', e);
        res.redirect('/login?error=oauth_failed');
    }
});

// ── Config pública (App IDs, safe para el frontend) ───────────

app.get('/api/config/public', (req, res) => {
    res.json({
        facebookAppId: process.env.FACEBOOK_APP_ID || '',
    });
});

/**
 * API — Recovery de contraseña
 *
 * STEP 1: POST /api/recovery/request  → genera token 8-chars, lo guarda en BD, envía correo
 * STEP 2: POST /api/recovery/verify   → valida token, devuelve sessionKey temporal
 * STEP 3: POST /api/recovery/reset    → con sessionKey cambia la contraseña
 */

// STEP 1 — Solicitar código
app.post('/api/recovery/request', async (req, res) => {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'El correo es requerido.' });

    const findSql = `SELECT id FROM users WHERE email = ?`;
    db.query(findSql, [email], async (err, rows) => {
        if (err) {
            console.error('[Recovery] Error al buscar usuario:', err);
            return res.status(500).json({ error: 'Error interno del servidor.' });
        }

        // Siempre respondemos OK para no filtrar si el correo existe
        if (rows.length === 0) {
            return res.json({ ok: true });
        }

        const userId = rows[0].id;
        const token = generateToken(8);
        const now = new Date();
        const expires = new Date(now.getTime() + 15 * 60 * 1000); // +15 min

        // Invalidar tokens previos del usuario
        const invalidateSql = `UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0`;
        db.query(invalidateSql, [userId]);

        // Insertar nuevo token
        const insertSql = `INSERT INTO password_resets (token, expires_at, used, created_at, updated_at, user_id)
                           VALUES (?, ?, 0, ?, ?, ?)`;
        db.query(insertSql, [token, expires, now, now, userId], async (err2) => {
            if (err2) {
                console.error('[Recovery] Error al insertar token:', err2);
                return res.status(500).json({ error: 'Error al generar el código.' });
            }

            // Enviar correo
            try {
                const mailer = createMailer();
                await mailer.sendMail({
                    from: `"${process.env.MAIL_FROM_NAME || 'TileKick'}" <${process.env.MAIL_FROM_ADDRESS}>`,
                    to: email,
                    subject: 'Código de recuperación — TileKick',
                    html: `
                        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #e8e8e0; border-radius: 16px; overflow: hidden;">
                            <div style="background: #354024; padding: 32px; text-align: center;">
                                <h1 style="color: #e5d7c4; font-size: 28px; margin: 0; letter-spacing: -0.02em;">TileKick</h1>
                            </div>
                            <div style="padding: 40px 32px;">
                                <h2 style="color: #333; font-size: 20px; margin: 0 0 12px;">Recupera tu contraseña</h2>
                                <p style="color: #555; font-size: 15px; line-height: 1.6; margin: 0 0 28px;">
                                    Usa el siguiente código para restablecer tu contraseña.
                                    Este código es válido por <strong>15 minutos</strong>.
                                </p>
                                <div style="background: #d4d4c8; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 28px;">
                                    <span style="font-size: 36px; font-weight: 800; letter-spacing: 0.18em; color: #354024; font-family: monospace;">${token}</span>
                                </div>
                                <p style="color: #777; font-size: 13px; margin: 0;">
                                    Si no solicitaste este código, puedes ignorar este correo.
                                </p>
                            </div>
                        </div>
                    `,
                });
                console.log(`[Recovery] Token enviado a ${email}`);
            } catch (mailErr) {
                console.error('[Recovery] Error al enviar correo:', mailErr);
                return res.status(500).json({ error: 'No se pudo enviar el correo. Verifica la configuración de correo.' });
            }

            res.json({ ok: true });
        });
    });
});

// STEP 2 — Verificar token
app.post('/api/recovery/verify', (req, res) => {
    const { email, token } = req.body;
    if (!email || !token) return res.status(400).json({ error: 'Datos incompletos.' });

    const sql = `
        SELECT pr.id, pr.user_id, pr.expires_at
        FROM password_resets pr
        JOIN users u ON u.id = pr.user_id
        WHERE u.email = ?
          AND pr.token = ?
          AND pr.used  = 0
        ORDER BY pr.created_at DESC
        LIMIT 1
    `;
    db.query(sql, [email, token.toUpperCase()], (err, rows) => {
        if (err) {
            console.error('[Recovery] Error al verificar token:', err);
            return res.status(500).json({ error: 'Error interno del servidor.' });
        }

        if (rows.length === 0) {
            return res.status(400).json({ error: 'Código incorrecto o ya utilizado.' });
        }

        const row = rows[0];
        if (new Date() > new Date(row.expires_at)) {
            return res.status(400).json({ error: 'El código ha expirado. Solicita uno nuevo.' });
        }

        // Generar sessionKey temporal (10 min)
        const key = randomUUID();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
        sessionKeys.set(key, { userId: row.user_id, resetId: row.id, expiresAt });

        // Auto-limpiar la sessionKey al expirar
        setTimeout(() => sessionKeys.delete(key), 10 * 60 * 1000);

        res.json({ ok: true, sessionKey: key });
    });
});

// STEP 3 — Cambiar contraseña
app.post('/api/recovery/reset', async (req, res) => {
    const { sessionKey, newPassword, confirmPassword } = req.body;
    if (!sessionKey || !newPassword || !confirmPassword) {
        return res.status(400).json({ error: 'Datos incompletos.' });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    }
    if (newPassword.length < 6) {
        return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres.' });
    }

    const session = sessionKeys.get(sessionKey);
    if (!session) {
        return res.status(400).json({ error: 'Sesión inválida o expirada. Reinicia el proceso.' });
    }
    if (new Date() > session.expiresAt) {
        sessionKeys.delete(sessionKey);
        return res.status(400).json({ error: 'La sesión expiró. Reinicia el proceso.' });
    }

    const saltRounds = parseInt(process.env.SALT_ROUNDS) || 10;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    const now = new Date();

    const updateSql = `UPDATE users SET password = ?, updated_at = ? WHERE id = ?`;
    db.query(updateSql, [hashedPassword, now, session.userId], (err) => {
        if (err) {
            console.error('[Recovery] Error al actualizar contraseña:', err);
            return res.status(500).json({ error: 'Error al cambiar la contraseña.' });
        }

        // Marcar el token como usado
        const markSql = `UPDATE password_resets SET used = 1, updated_at = ? WHERE id = ?`;
        db.query(markSql, [now, session.resetId]);

        // Invalidar la sessionKey
        sessionKeys.delete(sessionKey);

        console.log(`[Recovery] Contraseña actualizada para userId ${session.userId}`);
        res.json({ ok: true, message: 'Contraseña actualizada exitosamente.' });
    });
});

/**
 * GET /share — Página pública con Open Graph dinámico para compartir resultados.
 *
 * Los crawlers de Facebook/WhatsApp/Telegram leen los meta og: de esta URL
 * y muestran la imagen, título y descripción del resultado en el preview.
 * Los usuarios reales son redirigidos al home de inmediato (los bots no ejecutan JS).
 *
 * ⚠️  En localhost el preview de Facebook no aparece porque sus servidores no
 *     alcanzan 127.0.0.1. En producción con APP_URL configurado funciona correctamente.
 *
 * Query params:
 *   result  = win | lose | draw
 *   score   = "3-1"
 *   map     = nombre del mapa (opcional)
 */
app.get('/share', (req, res) => {
    const result = ['win', 'lose', 'draw'].includes(req.query.result) ? req.query.result : 'win';
    const score  = /^\d+-\d+$/.test(req.query.score ?? '') ? req.query.score : '3-1';
    const map    = (req.query.map || 'TileKick').slice(0, 80); // sanitize length

    const appUrl  = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
    const imgUrl  = `${appUrl}/assets/img/share/${result}.png`;
    const pageUrl = `${appUrl}/share?result=${result}&score=${encodeURIComponent(score)}&map=${encodeURIComponent(map)}`;
    const homeUrl = `${appUrl}/`;

    const scoreDisplay = score.replace('-', '–'); // guión largo para mejor tipografía
    const titles = {
        win:  `🏆 ¡VICTORIA en TileKick! ${scoreDisplay}`,
        lose: `😤 Caída táctica en TileKick — ${scoreDisplay}`,
        draw: `🤝 ¡Empate épico en TileKick! ${scoreDisplay}`,
    };
    const descs = {
        win:  `Gané ${scoreDisplay} en ${map}. ¿Me retas a TileKick? El fútbol táctico que no sabías que necesitabas. ⚽🎮`,
        lose: `Perdí ${scoreDisplay} en ${map} pero vuelvo más fuerte. ¿Tú puedes ganarme? ⚽🎮`,
        draw: `Empate ${scoreDisplay} en ${map}. Ninguno cedió. ¿Rompes tú el empate? ⚽🎮`,
    };

    const title = titles[result];
    const desc  = descs[result];

    const fbAppId = process.env.FACEBOOK_APP_ID || '';

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Cache 5 min — los bots pueden volver a scrapearlo si cambia
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(`<!DOCTYPE html>
<html lang="es" prefix="og: https://ogp.me/ns#">
<head>
  <meta charset="UTF-8">
  <title>${title} — TileKick</title>

  <!-- Open Graph — Facebook, WhatsApp, Telegram, LinkedIn -->
  <meta property="og:type"         content="website">
  <meta property="og:site_name"    content="TileKick">
  <meta property="og:locale"       content="es_ES">
  <meta property="og:url"          content="${pageUrl}">
  <meta property="og:title"        content="${title} — TileKick">
  <meta property="og:description"  content="${desc}">
  <meta property="og:image"        content="${imgUrl}">
  <meta property="og:image:width"  content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt"    content="${title}">
  ${fbAppId ? `<meta property="fb:app_id" content="${fbAppId}">` : ''}

  <!-- Twitter / X Card -->
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:site"        content="@TileKick">
  <meta name="twitter:title"       content="${title} — TileKick">
  <meta name="twitter:description" content="${desc}">
  <meta name="twitter:image"       content="${imgUrl}">
  <meta name="twitter:image:alt"   content="${title}">

  <!-- Redirigir al home para usuarios reales; los bots no ejecutan JS -->
  <script>window.location.replace('${homeUrl}');</script>
</head>
<body>
  <p>Redirigiendo a TileKick… <a href="${homeUrl}">Haz clic aquí si no ocurre.</a></p>
</body>
</html>`);
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

app.get('/rules', requireAuth, (req, res) => {
    res.sendFile(pages.rules);
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
    // Incluimos username_changed_at para el cooldown del perfil
    const sql = `SELECT id, name, username, email, avatar_url, created_at, username_changed_at FROM users WHERE id = ?`;
    db.query(sql, [req.user.id], (err, rows) => {
        if (err || rows.length === 0) return res.json(req.user);
        res.json(rows[0]);
    });
});

/**
 * API — Estadísticas del usuario
 */
app.get('/api/me/stats', requireAuth, (req, res) => {
    const sql = `SELECT elo_rating, wins, losses, draws, total_games, win_streak, best_streak
                 FROM user_achievements WHERE user_id = ?`;
    db.query(sql, [req.user.id], (err, rows) => {
        if (err) {
            console.error('[API] Error al cargar stats:', err);
            return res.status(500).json({ error: 'Error al obtener estadísticas.' });
        }
        if (rows.length === 0) return res.json({ elo_rating: 1000, wins: 0, losses: 0, draws: 0, total_games: 0 });
        res.json(rows[0]);
    });
});

/**
 * API — Editar perfil (PATCH /api/me/profile)
 * Campos editables: name, username (cooldown 30 días), avatar_url
 */
app.patch('/api/me/profile', requireAuth, async (req, res) => {
    const { name, username, avatar_url } = req.body;
    const userId = req.user.id;
    const now = new Date();

    if (!name || name.trim().length < 2) {
        return res.status(400).json({ error: 'El nombre debe tener al menos 2 caracteres.' });
    }

    // 1. Obtener datos actuales del usuario para validaciones
    const userSql = `SELECT id, username, username_changed_at FROM users WHERE id = ?`;
    db.query(userSql, [userId], (err, rows) => {
        if (err || rows.length === 0) {
            console.error('[API] Error al obtener usuario para PATCH:', err, userId);
            return res.status(404).json({ error: 'Usuario no encontrado.' });
        }

        const current = rows[0];
        let newUsername = current.username;

        const performUpdate = () => {
            const usernameChanged = newUsername !== current.username;
            const updateSql = `
                UPDATE users
                SET name = ?,
                    username = ?,
                    avatar_url = ?,
                    username_changed_at = ?,
                    updated_at = ?
                WHERE id = ?
            `;
            db.query(
                updateSql,
                [
                    name.trim(),
                    newUsername,
                    avatar_url || null,
                    usernameChanged ? now : current.username_changed_at,
                    now,
                    userId,
                ],
                (err3) => {
                    if (err3) {
                        console.error('[API] Error al actualizar perfil:', err3);
                        return res.status(500).json({ error: 'Error al guardar los cambios.' });
                    }
                    res.json({
                        ok: true,
                        user: {
                            name: name.trim(),
                            username: newUsername,
                            avatar_url: avatar_url || null,
                            username_changed_at: usernameChanged ? now : current.username_changed_at,
                        }
                    });
                }
            );
        };

        // Validar cambio de username
        if (username && username.trim() !== current.username) {
            // Cooldown 30 días
            if (current.username_changed_at) {
                const lastChange = new Date(current.username_changed_at);
                const nextAllowed = new Date(lastChange);
                nextAllowed.setDate(nextAllowed.getDate() + 30);
                if (now < nextAllowed) {
                    const days = Math.ceil((nextAllowed - now) / (1000 * 60 * 60 * 24));
                    return res.status(400).json({ error: `Puedes cambiar tu username en ${days} día(s).` });
                }
            }

            // Formato
            if (!/^[a-zA-Z0-9_]{3,30}$/.test(username.trim())) {
                return res.status(400).json({ error: 'Formato de username inválido.' });
            }

            // Unicidad
            db.query(`SELECT id FROM users WHERE username = ? AND id != ?`, [username.trim(), userId], (err2, existing) => {
                if (err2) return res.status(500).json({ error: 'Error al verificar username.' });
                if (existing.length > 0) return res.status(409).json({ error: 'Ese username ya está en uso.' });

                newUsername = username.trim();
                performUpdate();
            });
        } else {
            performUpdate();
        }
    });
});

/**
 * API — Preferencias de juego (GET + PATCH /api/me/preferences)
 */
app.get('/api/me/preferences', requireAuth, (req, res) => {
    const sql = `SELECT graphics_quality, music_volume, sfx_volume, show_fps, language
                 FROM user_preferences WHERE user_id = ?`;
    db.query(sql, [req.user.id], (err, rows) => {
        if (err) {
            console.error('[API] Error al cargar preferencias:', err);
            return res.status(500).json({ error: 'Error al obtener preferencias.' });
        }
        if (rows.length === 0) {
            return res.json({ graphics_quality: 2, music_volume: 80, sfx_volume: 80, show_fps: 0, language: 'es' });
        }
        res.json(rows[0]);
    });
});

app.patch('/api/me/preferences', requireAuth, (req, res) => {
    const { graphics_quality, music_volume, sfx_volume, show_fps, language } = req.body;
    const userId = req.user.id;
    const now = new Date();

    // Validaciones básicas
    const gq = parseInt(graphics_quality);
    const mv = parseInt(music_volume);
    const sv = parseInt(sfx_volume);
    const sf = show_fps ? 1 : 0;
    const lang = ['es', 'en'].includes(language) ? language : 'es';

    if (isNaN(gq) || gq < 1 || gq > 4) return res.status(400).json({ error: 'Calidad gráfica inválida.' });
    if (isNaN(mv) || mv < 0 || mv > 100) return res.status(400).json({ error: 'Volumen de música inválido.' });
    if (isNaN(sv) || sv < 0 || sv > 100) return res.status(400).json({ error: 'Volumen de efectos inválido.' });

    const upsertSql = `
        INSERT INTO user_preferences (user_id, graphics_quality, music_volume, sfx_volume, show_fps, language, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
            graphics_quality = VALUES(graphics_quality),
            music_volume     = VALUES(music_volume),
            sfx_volume       = VALUES(sfx_volume),
            show_fps         = VALUES(show_fps),
            language         = VALUES(language),
            updated_at       = VALUES(updated_at)
    `;
    db.query(upsertSql, [userId, gq, mv, sv, sf, lang, now], (err) => {
        if (err) {
            console.error('[API] Error al guardar preferencias:', err);
            return res.status(500).json({ error: 'Error al guardar las preferencias.' });
        }
        res.json({ ok: true });
    });
});

/**
 * API — Subir avatar (POST /api/me/avatar)
 * Procesa la imagen con sharp, la guarda como .webp en storage/avatars/
 */
app.post('/api/me/avatar', requireAuth, upload.single('avatar'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    }

    try {
        const userId   = req.user.id;
        const filename = `${userId}_${Date.now()}.webp`;
        const outPath  = path.join(avatarsDir, filename);

        // Convertir a webp, redimensionar a máx 256x256 manteniendo ratio
        await sharp(req.file.buffer)
            .resize(256, 256, { fit: 'cover', position: 'centre' })
            .webp({ quality: 85 })
            .toFile(outPath);

        const avatarUrl = `/storage/avatars/${filename}`;

        // Borrar el avatar anterior si existía
        const prevSql = `SELECT avatar_url FROM users WHERE id = ?`;
        db.query(prevSql, [userId], (err, rows) => {
            if (!err && rows.length > 0 && rows[0].avatar_url) {
                const oldUrl  = rows[0].avatar_url;
                // Solo borrar si es un archivo local nuestro
                if (oldUrl.startsWith('/storage/avatars/')) {
                    const oldPath = path.join(__dirname, '..', oldUrl);
                    fs.unlink(oldPath, () => {});   // Silencioso si ya no existe
                }
            }
        });

        // Actualizar BD
        const now = new Date();
        db.query(
            `UPDATE users SET avatar_url = ?, updated_at = ? WHERE id = ?`,
            [avatarUrl, now, userId],
            (err) => {
                if (err) {
                    console.error('[Avatar] Error al guardar URL en BD:', err);
                    return res.status(500).json({ error: 'Error al guardar el avatar.' });
                }
                res.json({ ok: true, avatar_url: avatarUrl });
            }
        );
    } catch (err) {
        console.error('[Avatar] Error al procesar imagen:', err);
        res.status(500).json({ error: 'Error al procesar la imagen.' });
    }
});

/**
 * API — Leaderboard global (GET /api/leaderboard)
 * Devuelve todos los jugadores con stats, ordenados por ELO desc
 */
app.get('/api/leaderboard', requireAuth, (req, res) => {
    const sql = `
        SELECT
            u.id,
            u.username,
            u.name,
            u.avatar_url,
            COALESCE(ua.elo_rating,  1000) AS elo_rating,
            COALESCE(ua.wins,        0)    AS wins,
            COALESCE(ua.losses,      0)    AS losses,
            COALESCE(ua.draws,       0)    AS draws,
            COALESCE(ua.total_games, 0)    AS total_games,
            COALESCE(ua.win_streak,  0)    AS win_streak
        FROM users u
        LEFT JOIN user_achievements ua ON ua.user_id = u.id
        WHERE u.deleted_at IS NULL
        ORDER BY elo_rating DESC, wins DESC
    `;
    db.query(sql, (err, rows) => {
        if (err) {
            console.error('[Leaderboard] Error:', err);
            return res.status(500).json({ error: 'Error al obtener el ranking.' });
        }
        res.json(rows);
    });
});

/**
 * Sockets — Matchmaking + Juego online
 *
 * Cola de espera: Map<key, { socketId, username }>
 * key = "map:gameType"
 *
 * activeRooms: Map<roomId, { map, gameType, matchId, matchCreating, finished,
 *                            players: Map<socketId, { userId, team, username, eloBefore }> }>
 */
const waitingQueue = new Map();
const activeRooms  = new Map();

// ── Helpers de ELO y resultados de partida ───────────────────

/** Calcula nuevos ratings ELO (K=32). scoreA: 1=win, 0.5=draw, 0=loss para equipo A */
function calcElo(rA, rB, scoreA) {
    const eA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const newA = Math.round(rA + 32 * (scoreA - eA));
    const newB = Math.round(rB + 32 * ((1 - scoreA) - (1 - eA)));
    return { newA: Math.max(100, newA), newB: Math.max(100, newB) };
}

/** Crea los registros match + match_players en BD al empezar una partida */
function _createMatchRecord(roomId, room) {
    const now = new Date();
    const gameTypeNum = room.gameType === '3d' ? 2 : 1;

    db.query(
        'INSERT INTO matches (room_id, map, game_type, mode, status, started_at, created_at, updated_at) VALUES (?,?,?,1,2,?,?,?)',
        [roomId, room.map, gameTypeNum, now, now, now],
        (err, result) => {
            if (err) {
                console.error('[Match] Error creando match:', err.message);
                room.matchCreating = false;
                return;
            }
            room.matchId = result.insertId;

            // Obtener ELO de cada jugador y crear match_players
            const players = [...room.players.values()].filter(p => p.userId);
            let pending = players.length;
            if (pending === 0) return;

            for (const player of players) {
                db.query(
                    'SELECT COALESCE(elo_rating, 1000) AS elo FROM user_achievements WHERE user_id = ?',
                    [player.userId],
                    (err2, rows) => {
                        const eloBefore = rows?.[0]?.elo ?? 1000;
                        player.eloBefore = eloBefore;

                        const teamNum = player.team === 'A' ? 1 : 2;
                        db.query(
                            'INSERT IGNORE INTO match_players (match_id, user_id, team, elo_before, created_at) VALUES (?,?,?,?,?)',
                            [room.matchId, player.userId, teamNum, eloBefore, now],
                            (err3) => { if (err3) console.error('[Match] Error creando match_player:', err3.message); }
                        );

                        if (--pending === 0) {
                            console.log(`[Match] Partida ${room.matchId} iniciada — sala ${roomId} (${room.map})`);
                        }
                    }
                );
            }
        }
    );
}

/** Guarda el resultado final de una partida y actualiza stats/ELO */
function _saveMatchResult(roomId, room, winnerTeam) {
    if (room.finished) return;
    room.finished = true;

    if (!room.matchId) {
        console.warn('[Match] No hay matchId para sala', roomId);
        return;
    }

    const playerA = [...room.players.values()].find(p => p.team === 'A');
    const playerB = [...room.players.values()].find(p => p.team === 'B');

    if (!playerA?.userId || !playerB?.userId) {
        // Sin IDs de usuario válidos — solo marcar partida como finalizada
        const now = new Date();
        db.query('UPDATE matches SET status=3, finished_at=?, updated_at=? WHERE id=?', [now, now, room.matchId]);
        console.warn('[Match] Sin userId para sala', roomId, '— sólo se marcó el match como finalizado');
        return;
    }

    // Obtener ELO actual de ambos jugadores
    db.query(
        'SELECT user_id, COALESCE(elo_rating, 1000) AS elo FROM user_achievements WHERE user_id IN (?,?)',
        [playerA.userId, playerB.userId],
        (err, rows) => {
            if (err) console.error('[Match] Error obteniendo ELO:', err.message);

            const eloMap = Object.fromEntries((rows ?? []).map(r => [r.user_id, r.elo]));
            // mysql2 puede devolver strings — parsear explícitamente como enteros
            const eloA = parseInt(eloMap[playerA.userId] ?? playerA.eloBefore ?? 1000, 10) || 1000;
            const eloB = parseInt(eloMap[playerB.userId] ?? playerB.eloBefore ?? 1000, 10) || 1000;

            // scoreA: 1=A gana, 0=B gana, 0.5=empate
            const scoreA = winnerTeam === 'A' ? 1 : winnerTeam === 'B' ? 0 : 0.5;
            const { newA, newB } = calcElo(eloA, eloB, scoreA);

            // Validar que el cálculo produjo valores numéricos válidos
            if (!Number.isFinite(newA) || !Number.isFinite(newB)) {
                console.error(`[Match] Cálculo ELO inválido: eloA=${eloA} eloB=${eloB} scoreA=${scoreA} → newA=${newA} newB=${newB}`);
                const now2 = new Date();
                db.query('UPDATE matches SET status=3, winner_id=?, finished_at=?, updated_at=? WHERE id=?',
                    [winnerTeam === 'A' ? playerA.userId : winnerTeam === 'B' ? playerB.userId : null, now2, now2, room.matchId]);
                return;
            }

            const pointsA = scoreA === 1 ? 15 : scoreA === 0.5 ? 5 : 0;
            const pointsB = scoreA === 0 ? 15 : scoreA === 0.5 ? 5 : 0;

            // result: 1=win 2=loss 3=draw
            const resultA = scoreA === 1 ? 1 : scoreA === 0.5 ? 3 : 2;
            const resultB = scoreA === 0 ? 1 : scoreA === 0.5 ? 3 : 2;

            const winnerUserId = winnerTeam === 'A' ? playerA.userId
                               : winnerTeam === 'B' ? playerB.userId : null;
            const now = new Date();

            // 1. Actualizar matches
            db.query(
                'UPDATE matches SET status=3, winner_id=?, is_draw=?, finished_at=?, updated_at=? WHERE id=?',
                [winnerUserId, winnerTeam ? 0 : 1, now, now, room.matchId]
            );

            // 2. Actualizar match_players
            db.query(
                'UPDATE match_players SET result=?, elo_after=?, points_earned=? WHERE match_id=? AND user_id=?',
                [resultA, newA, pointsA, room.matchId, playerA.userId]
            );
            db.query(
                'UPDATE match_players SET result=?, elo_after=?, points_earned=? WHERE match_id=? AND user_id=?',
                [resultB, newB, pointsB, room.matchId, playerB.userId]
            );

            // 3. Actualizar user_achievements
            _updateAchievements(playerA.userId, resultA === 1, resultA === 2, resultA === 3, newA, pointsA);
            _updateAchievements(playerB.userId, resultB === 1, resultB === 2, resultB === 3, newB, pointsB);

            console.log(`[Match] Guardado: sala=${roomId} id=${room.matchId} ganador=${winnerTeam ?? 'empate'} ELO_A:${eloA}→${newA} ELO_B:${eloB}→${newB}`);

            // Notificar a los clientes con el cambio de ELO
            io.to(roomId).emit('match-saved', {
                winner: winnerTeam,
                eloChanges: {
                    A: { before: eloA, after: newA, delta: newA - eloA },
                    B: { before: eloB, after: newB, delta: newB - eloB },
                },
            });
        }
    );
}

/** Actualiza wins/losses/draws/streak/ELO en user_achievements */
function _updateAchievements(userId, isWin, isLoss, isDraw, newElo, points) {
    // En MySQL, dentro del mismo SET, cada columna usa el valor YA actualizado.
    // Así win_streak en best_streak ya tiene el valor incrementado.
    const streakAndResult = isWin
        ? 'wins        = wins + 1, win_streak = win_streak + 1, best_streak = GREATEST(best_streak, win_streak),'
        : isLoss
        ? 'losses      = losses + 1, win_streak = 0,'
        : 'draws       = draws + 1, win_streak = 0,';

    const sql = `
        UPDATE user_achievements
        SET elo_rating   = ?,
            points       = points + ?,
            ${streakAndResult}
            total_games  = total_games + 1,
            updated_at   = NOW()
        WHERE user_id = ?
    `;
    db.query(sql, [newElo, points, userId], (err) => {
        if (err) console.error(`[Achievements] Error userId=${userId}:`, err.message);
    });
}

io.on('connection', (socket) => {
    console.log(`[Socket] Conectado: ${socket.id}`);

    // --- El jugador entra a la sala de espera ---
    socket.on('join-waiting-room', ({ mode, map, gameType, username, goals, time, random }) => {
        if (mode !== 'online') return;

        const goalLimit = parseInt(goals ?? '5', 10) || 5;
        const timeSecs  = parseInt(time  ?? '0', 10) || 0;
        const isRandom  = random === true || random === 'true';

        // Anti self-play: revisar TODAS las entradas de la cola
        for (const [, entry] of waitingQueue) {
            if (entry.username === username) {
                socket.emit('self-play-error', { message: 'Ya estás buscando partida. No puedes jugar contra ti mismo.' });
                return;
            }
        }

        // ── Buscar candidato ───────────────────────────────────────
        let matchKey   = null;
        let matchEntry = null;

        if (isRandom) {
            // Partida aleatoria → aceptar cualquier oponente en espera
            const firstEntry = [...waitingQueue.entries()][0];
            if (firstEntry) {
                [matchKey, matchEntry] = firstEntry;
            }
        } else {
            // Partida específica → primero buscar coincidencia exacta (map+gameType)
            const specificKey = `${map}:${gameType}`;
            if (waitingQueue.has(specificKey)) {
                matchKey   = specificKey;
                matchEntry = waitingQueue.get(specificKey);
            } else if (waitingQueue.has('any:any')) {
                // Fallback: hay alguien esperando partida aleatoria → emparejamos
                matchKey   = 'any:any';
                matchEntry = waitingQueue.get('any:any');
            }
        }

        if (matchEntry) {
            waitingQueue.delete(matchKey);
            socket.data.waitingKey = null;

            // Determinar configuración de la sala:
            // Usar los parámetros del jugador con modalidad específica; si ambos son
            // aleatorios, usar estadio_clasico / 2d como defaults.
            const matchMap       = !isRandom ? map      : (matchEntry.map      ?? 'estadio_clasico');
            const matchGameType  = !isRandom ? gameType : (matchEntry.gameType ?? '2d');
            const matchGoalLimit = !isRandom ? goalLimit : (matchEntry.goalLimit ?? 5);
            const matchTimeSecs  = !isRandom ? timeSecs  : (matchEntry.timeSecs  ?? 0);

            const roomId = randomUUID().slice(0, 8).toUpperCase();

            activeRooms.set(roomId, {
                map:           matchMap,
                gameType:      matchGameType,
                goalLimit:     matchGoalLimit,
                timeSecs:      matchTimeSecs,
                matchId:       null,
                matchCreating: false,
                finished:      false,
                players:       new Map(),
            });

            socket.join(roomId);
            const opponentSocket = io.sockets.sockets.get(matchEntry.socketId);
            opponentSocket?.join(roomId);

            io.to(roomId).emit('match-found', {
                roomId,
                map:       matchMap,
                gameType:  matchGameType,
                goalLimit: matchGoalLimit,
                timeSecs:  matchTimeSecs,
                players: [
                    { socketId: matchEntry.socketId, username: matchEntry.username },
                    { socketId: socket.id, username },
                ],
            });

            console.log(`[Match] Room ${roomId}: ${matchEntry.username} vs ${username} | ${matchMap} ${matchGameType.toUpperCase()} | goals=${matchGoalLimit} time=${matchTimeSecs}s`);
        } else {
            // Nadie disponible → entrar en cola
            const queueKey = isRandom ? 'any:any' : `${map}:${gameType}`;
            waitingQueue.set(queueKey, { socketId: socket.id, username, map, gameType, goalLimit, timeSecs });
            socket.data.waitingKey = queueKey;
            socket.emit('waiting', { count: 1 });
            console.log(`[Queue] ${username} esperando: ${queueKey}`);
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
        const myTeam = existingPlayers.length === 0 ? 'A' : 'B';
        socket.data.team = myTeam;

        socket.emit('team-assigned', { myTeam, roomId, players: existingPlayers });
        io.to(roomId).emit('player-joined', {
            socketId: socket.id,
            username,
            team: myTeam,
            playerCount: roomSize,
        });

        console.log(`[Room ${roomId}] ${username} → Equipo ${myTeam} (${roomSize}/2)`);

        // Buscar userId por username para registrar la partida en BD
        db.query('SELECT id FROM users WHERE username = ?', [username], (err, rows) => {
            const userId = rows?.[0]?.id ?? null;
            socket.data.userId = userId;

            const room = activeRooms.get(roomId);
            if (!room) return; // sala no online (local / IA)

            // Prevenir self-play: rechazar si el mismo userId ya está en la sala
            if (userId) {
                const alreadyPresent = [...room.players.values()].some(p => p.userId === userId);
                if (alreadyPresent) {
                    console.warn(`[Room ${roomId}] Self-play detectado — ${username} (${userId}) intentó unirse dos veces`);
                    socket.emit('self-play-error', { message: 'No puedes jugar contra ti mismo.' });
                    socket.leave(roomId);
                    socket.data.roomId = null;
                    return;
                }
            }

            room.players.set(socket.id, { userId, team: myTeam, username });

            // Cuando ambos jugadores estén registrados, crear la partida en BD
            if (room.players.size === 2 && !room.matchId && !room.matchCreating) {
                room.matchCreating = true;
                _createMatchRecord(roomId, room);
            }
        });
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

    // --- Resultado de la partida (emitido por los clientes al detectar gameOver) ---
    socket.on('game-finished', ({ winnerTeam }) => {
        const roomId = socket.data.roomId;
        if (!roomId) return;
        const room = activeRooms.get(roomId);
        if (!room || room.finished) return;

        console.log(`[Room ${roomId}] game-finished recibido — ganador: ${winnerTeam ?? 'empate'}`);
        _saveMatchResult(roomId, room, winnerTeam);
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

            // Si la partida estaba activa, declarar ganador al jugador restante
            const room = activeRooms.get(roomId);
            if (room && !room.finished) {
                const remainingSockets = io.sockets.adapter.rooms.get(roomId);
                if (remainingSockets && remainingSockets.size > 0) {
                    // Hay alguien en la sala → gana el jugador restante
                    const winnerTeam = socket.data.team === 'A' ? 'B' : 'A';
                    console.log(`[Room ${roomId}] Abandono — Equipo ${winnerTeam} gana por forfeit`);
                    _saveMatchResult(roomId, room, winnerTeam);
                } else {
                    // Nadie en la sala → marcar como abandonada sin ganador
                    if (room.matchId) {
                        const now = new Date();
                        db.query(
                            'UPDATE matches SET status=4, finished_at=?, updated_at=? WHERE id=?',
                            [now, now, room.matchId]
                        );
                    }
                    activeRooms.delete(roomId);
                }
            }
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