/**
 * User Preferences enums
 *
 * Corresponden a columnas TINYINT en la tabla `user_preferences`.
 */

/** graphics_quality — Calidad gráfica */
export const GraphicsQuality = Object.freeze({
    LOW:    1,
    MEDIUM: 2,
    HIGH:   3,
    ULTRA:  4,
});

export const GraphicsQualityLabel = Object.freeze({
    [GraphicsQuality.LOW]:    'low',
    [GraphicsQuality.MEDIUM]: 'medium',
    [GraphicsQuality.HIGH]:   'high',
    [GraphicsQuality.ULTRA]:  'ultra',
});

/** Valores por defecto para un usuario nuevo */
export const DefaultPreferences = Object.freeze({
    graphics_quality: GraphicsQuality.MEDIUM,
    character_color:  '#354024',
    music_volume:     80,
    sfx_volume:       80,
    show_fps:         0,
    language:         'es',
});
