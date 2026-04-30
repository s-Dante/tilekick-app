/**
 * TileKick — Sistema global de alertas Toast
 * Uso: Toast.show({ message, type, position, title, duration })
 *
 * type:     'success' | 'error' | 'warning' | 'info'
 * position: 'top-left' | 'top-center' | 'top-right'
 *           'middle-left' | 'middle-center' | 'middle-right'
 *           'bottom-left' | 'bottom-center' | 'bottom-right'
 * duration: número en ms (default 4000), 0 = no auto-dismiss
 */

(function (global) {

  /* ── Iconos SVG por tipo ── */
  const ICONS = {
    success: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"/></svg>`,
    error:   `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>`,
    warning: `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"/></svg>`,
    info:    `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/></svg>`,
  };

  const TITLES = {
    success: 'Éxito',
    error:   'Error',
    warning: 'Atención',
    info:    'Información',
  };

  const MAX_PER_CONTAINER = 5;

  /* ── Mapa de contenedores ya creados ── */
  const containers = {};

  /**
   * Obtiene o crea el contenedor para una posición dada.
   * @param {string} pos
   * @returns {HTMLElement}
   */
  function getContainer(pos) {
    if (containers[pos]) return containers[pos];

    const el = document.createElement('div');
    el.className = 'toast-container';
    el.setAttribute('data-pos', pos);
    document.body.appendChild(el);
    containers[pos] = el;
    return el;
  }

  /**
   * Elimina el toast del DOM con animación de salida.
   * @param {HTMLElement} toast
   */
  function dismiss(toast) {
    if (toast.dataset.dismissed) return;
    toast.dataset.dismissed = '1';
    toast.classList.add('toast-hiding');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  }

  /**
   * Muestra un toast.
   * @param {object} opts
   * @param {string}  opts.message   — Texto principal (requerido)
   * @param {string}  [opts.type]    — 'success' | 'error' | 'warning' | 'info'
   * @param {string}  [opts.position]— Una de las 9 posiciones
   * @param {string}  [opts.title]   — Título custom (sino usa el default del tipo)
   * @param {number}  [opts.duration]— Ms antes de auto-dismiss (0 = manual)
   * @returns {HTMLElement} El elemento toast creado
   */
  function show({ message, type = 'info', position = 'top-right', title, duration = 4000 }) {
    const container = getContainer(position);

    /* Límite de toasts por contenedor */
    const existing = container.querySelectorAll('.toast:not(.toast-hiding)');
    if (existing.length >= MAX_PER_CONTAINER) {
      dismiss(existing[0]);
    }

    /* Construir toast */
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'assertive');

    const toastTitle = title ?? TITLES[type] ?? '';
    const durationMs = duration > 0 ? duration : 6000;

    toast.innerHTML = `
      <span class="toast-icon">${ICONS[type] ?? ICONS.info}</span>
      <div class="toast-body">
        ${toastTitle ? `<p class="toast-title">${toastTitle}</p>` : ''}
        <p class="toast-message">${message}</p>
      </div>
      <button class="toast-close" aria-label="Cerrar notificación">✕</button>
      ${duration > 0 ? `<div class="toast-progress" style="animation-duration: ${durationMs}ms;"></div>` : ''}
    `;

    /* Click para cerrar */
    toast.querySelector('.toast-close').addEventListener('click', () => dismiss(toast));

    /* Auto-dismiss */
    let timer;
    if (duration > 0) {
      timer = setTimeout(() => dismiss(toast), durationMs);
    }

    /* Pausa al hover */
    toast.addEventListener('mouseenter', () => {
      if (timer) clearTimeout(timer);
      const bar = toast.querySelector('.toast-progress');
      if (bar) bar.style.animationPlayState = 'paused';
    });

    toast.addEventListener('mouseleave', () => {
      const bar = toast.querySelector('.toast-progress');
      if (bar) bar.style.animationPlayState = 'running';
      if (duration > 0) {
        timer = setTimeout(() => dismiss(toast), 1500);
      }
    });

    container.appendChild(toast);
    return toast;
  }

  /* ── Atajos por tipo ── */
  const Toast = {
    show,
    success: (message, opts = {}) => show({ message, type: 'success', ...opts }),
    error:   (message, opts = {}) => show({ message, type: 'error',   ...opts }),
    warning: (message, opts = {}) => show({ message, type: 'warning', ...opts }),
    info:    (message, opts = {}) => show({ message, type: 'info',    ...opts }),
  };

  global.Toast = Toast;

})(window);
