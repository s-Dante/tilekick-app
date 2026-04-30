/**
 * Social OAuth Providers
 *
 * Corresponde a la columna `provider` TINYINT en la tabla `social_accounts`.
 * Al agregar un nuevo proveedor, solo se añade aquí y en el backend —
 * sin tocar el esquema de BD.
 */
export const SocialProvider = Object.freeze({
    GOOGLE:   1,
    FACEBOOK: 2,
    GITHUB:   3,
});

/** Mapeo numérico → string (útil para logs y respuestas API) */
export const SocialProviderLabel = Object.freeze({
    [SocialProvider.GOOGLE]:   'google',
    [SocialProvider.FACEBOOK]: 'facebook',
    [SocialProvider.GITHUB]:   'github',
});

/** Obtiene el ID numérico a partir del string del proveedor */
export function providerFromString(str) {
    const map = { google: 1, facebook: 2, github: 3 };
    return map[str?.toLowerCase()] ?? null;
}
