# Guía de configuración — APIs sociales (OAuth)

Esta guía te explica paso a paso cómo obtener las credenciales de Google, Facebook y GitHub para activar el login social en TileKick.

Una vez que tengas los valores, ábrelos en el archivo `.env` del proyecto y reemplaza los placeholders.

---

## 1. Google OAuth

**Servicio:** Google Cloud Console  
**URL:** https://console.cloud.google.com

### Pasos

1. Ve a https://console.cloud.google.com y crea (o selecciona) un proyecto.
2. En el menú lateral, ve a **APIs & Services → Credentials**.
3. Haz clic en **+ CREATE CREDENTIALS → OAuth client ID**.
4. Si es la primera vez, primero configura la **pantalla de consentimiento** (OAuth consent screen):
   - Tipo de usuario: **External**
   - Rellena nombre de la app, email de soporte y dominio autorizado.
   - En **Scopes** agrega: `openid`, `email`, `profile` (normalmente ya están incluidos).
   - Guarda y publica la app (o déjala en modo de prueba para desarrollo).
5. De vuelta en **Credentials → CREATE CREDENTIALS → OAuth client ID**:
   - Tipo de aplicación: **Web application**
   - Nombre: `TileKick` (o el que quieras)
   - En **Authorized redirect URIs** agrega:
     ```
     http://localhost:3000/auth/google/callback
     ```
     > Para producción agrega también: `https://tudominio.com/auth/google/callback`
6. Haz clic en **Create** y copia los valores generados.

### Variables `.env`

```env
GOOGLE_CLIENT_ID=<valor de "Client ID">
GOOGLE_CLIENT_SECRET=<valor de "Client Secret">
```

---

## 2. Facebook OAuth

**Servicio:** Meta for Developers  
**URL:** https://developers.facebook.com

### Pasos

1. Ve a https://developers.facebook.com/apps y haz clic en **Create App**.
2. Tipo de app: **Consumer** (permite Facebook Login).
3. Ponle un nombre (p. ej. `TileKick`) y crea la app.
4. En el dashboard de la app, ve al panel izquierdo → **Add Product** → elige **Facebook Login** → **Web**.
5. En **Facebook Login → Settings**:
   - En **Valid OAuth Redirect URIs** agrega:
     ```
     http://localhost:3000/auth/facebook/callback
     ```
     > Para producción: `https://tudominio.com/auth/facebook/callback`
   - Activa **Login with the JavaScript SDK** si lo necesitas para el botón de compartir.
   - Guarda los cambios.
6. Ve a **Settings → Basic** (menú izquierdo principal) para copiar el **App ID** y el **App Secret** (haz clic en "Show" para verlo).

> **Nota de privacidad:** Mientras la app esté en modo de desarrollo, solo podrán autenticarse usuarios con rol de administrador, desarrollador o tester. Para abrir el acceso al público necesitas enviar la app a revisión y que Meta la apruebe.

### Variables `.env`

```env
FACEBOOK_APP_ID=<valor de "App ID">
FACEBOOK_APP_SECRET=<valor de "App Secret">
```

---

## 3. GitHub OAuth

**Servicio:** GitHub Developer Settings  
**URL:** https://github.com/settings/developers

### Pasos

1. Ve a https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**.
2. Rellena el formulario:
   - **Application name:** `TileKick`
   - **Homepage URL:** `http://localhost:3000`
   - **Authorization callback URL:**
     ```
     http://localhost:3000/auth/github/callback
     ```
3. Haz clic en **Register application**.
4. En la página de la app verás el **Client ID**. Para el **Client Secret** haz clic en **Generate a new client secret** y cópialo inmediatamente (solo se muestra una vez).

### Variables `.env`

```env
GITHUB_CLIENT_ID=<valor de "Client ID">
GITHUB_CLIENT_SECRET=<valor de "Client Secret">
```

---

## 4. URL base de la aplicación

Esta variable la usa el servidor para construir las URLs de callback automáticamente:

```env
# Desarrollo local
APP_URL=http://localhost:3000

# Producción (sin barra al final)
APP_URL=https://tudominio.com
```

---

## 5. Resumen del bloque OAuth en `.env`

```env
# URL base (sin barra al final)
APP_URL=http://localhost:3000

# Google
GOOGLE_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxx

# Facebook
FACEBOOK_APP_ID=000000000000000
FACEBOOK_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# GitHub
GITHUB_CLIENT_ID=Ov23liXXXXXXXXXXXXXX
GITHUB_CLIENT_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 6. Probar que todo funciona

1. Reinicia el servidor: `pnpm dev` (o `npm run dev`)
2. Abre http://localhost:3000/login
3. Haz clic en uno de los botones de login social
4. Completa el flujo en la ventana del proveedor
5. Deberías ser redirigido automáticamente a `/dashboard`

Si algo falla, revisa la consola del servidor — los errores OAuth se loguean con el prefijo `[OAuth Google]`, `[OAuth Facebook]` o `[OAuth GitHub]`.
