/**
 * Sidebar Logic — Dynamic User Data, Dropdown & Mobile Topbar
 */

function injectMobileTopbar() {
    // Collect nav links from the desktop sidebar
    const navLinks = [];
    document.querySelectorAll('#sidebar-nav li a').forEach(a => {
        navLinks.push({
            href: a.getAttribute('href'),
            text: a.querySelector('span')?.textContent.trim() || a.textContent.trim()
        });
    });

    const settingsLink = document.querySelector('#sidebar-bottom a.nav-link-bottom');
    const settingsHref = settingsLink?.getAttribute('href') || '/settings';
    const settingsText = settingsLink?.querySelector('span')?.textContent.trim() || 'Configuración';

    const topbarHTML = `
        <header id="mobile-topbar">
            <span id="mobile-logo">TILEKICK</span>
            <div id="mobile-topbar-actions">
                <button id="mobile-hamburger" aria-label="Abrir menú">
                    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <rect x="2" y="5" width="18" height="2" rx="1" fill="currentColor"/>
                        <rect x="2" y="10" width="18" height="2" rx="1" fill="currentColor"/>
                        <rect x="2" y="15" width="18" height="2" rx="1" fill="currentColor"/>
                    </svg>
                </button>
                <div class="nav-avatar" id="mobile-avatar-btn" style="cursor:pointer;">
                    <img id="mobile-avatar-img" src="" alt="" style="display:none;">
                    <span id="mobile-avatar-fallback">👤</span>
                </div>
            </div>

            <!-- Dropdown nav (hamburger) — se abre desde la izquierda -->
            <div class="profile-dropdown" id="mobile-nav-dropdown">
                ${navLinks.map(l => `<a href="${l.href}" class="dropdown-item mobile-nav-link">${l.text}</a>`).join('\n                ')}
                <div style="height:1px;background:var(--border);margin:4px 0;"></div>
                <a href="${settingsHref}" class="dropdown-item mobile-nav-link">${settingsText}</a>
            </div>

            <!-- Dropdown perfil (avatar) — se abre desde la derecha -->
            <div class="profile-dropdown" id="mobile-profile-dropdown">
                <a href="/profile" class="dropdown-item">👤 Ver perfil</a>
                <a href="/logout" class="dropdown-item logout">🚪 Cerrar sesión</a>
            </div>
        </header>
    `;

    document.body.insertAdjacentHTML('afterbegin', topbarHTML);

    // Marcar link activo en el dropdown de navegación
    const currentPath = window.location.pathname;
    document.querySelectorAll('.mobile-nav-link').forEach(link => {
        try {
            if (new URL(link.href).pathname === currentPath) link.classList.add('active');
        } catch (_) {}
    });

    // --- Hamburger → dropdown de navegación ---
    const hamburger    = document.getElementById('mobile-hamburger');
    const navDropdown  = document.getElementById('mobile-nav-dropdown');
    const profileDrop  = document.getElementById('mobile-profile-dropdown');

    hamburger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = navDropdown.classList.contains('show');
        navDropdown.classList.toggle('show', !isOpen);
        profileDrop.classList.remove('show');
    });

    // --- Avatar → dropdown de perfil ---
    const avatarBtn = document.getElementById('mobile-avatar-btn');

    avatarBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = profileDrop.classList.contains('show');
        profileDrop.classList.toggle('show', !isOpen);
        navDropdown.classList.remove('show');
    });

    // Cerrar ambos dropdowns al click fuera
    document.addEventListener('click', () => {
        navDropdown.classList.remove('show');
        profileDrop.classList.remove('show');
    });
}

function populateMobileAvatar(user) {
    const img      = document.getElementById('mobile-avatar-img');
    const fallback = document.getElementById('mobile-avatar-fallback');
    if (!img) return;

    if (user.avatar_url) {
        img.src = user.avatar_url + '?t=' + Date.now();
        img.style.display = 'block';
        if (fallback) fallback.style.display = 'none';
    } else {
        img.style.display = 'none';
        if (fallback) fallback.style.display = 'flex';
    }
}

async function initSidebar() {
    const navUsername        = document.getElementById('nav-username');
    const navAvatarImg       = document.getElementById('nav-avatar-img');
    const navAvatarFallback  = document.getElementById('nav-avatar-fallback');
    const profileCard        = document.getElementById('nav-profile-card');
    const profileDropdown    = document.getElementById('profile-dropdown');

    // Marcar links activos en sidebar de escritorio
    const currentPath = window.location.pathname;
    document.querySelectorAll('#sidebar-nav a, #sidebar-bottom a').forEach(link => {
        try {
            if (new URL(link.href).pathname === currentPath) link.classList.add('active');
        } catch (_) {}
    });

    // Inyectar topbar móvil (lee el DOM del sidebar, debe ir antes de que se oculte)
    injectMobileTopbar();

    // Obtener datos del usuario
    let user = null;
    try {
        const res = await fetch('/api/me');
        if (res.ok) user = await res.json();
    } catch (err) {
        console.error('Error fetching user data:', err);
    }

    if (user) {
        // Sidebar escritorio
        if (navUsername) navUsername.textContent = user.username || user.name;

        if (navAvatarImg && user.avatar_url) {
            navAvatarImg.src = user.avatar_url + '?t=' + Date.now();
            navAvatarImg.style.display = 'block';
            if (navAvatarFallback) navAvatarFallback.style.display = 'none';
        } else if (navAvatarFallback) {
            if (navAvatarImg) navAvatarImg.style.display = 'none';
            navAvatarFallback.style.display = 'flex';
        }

        // Topbar móvil
        populateMobileAvatar(user);
    }

    // Dropdown escritorio
    if (profileCard && profileDropdown) {
        profileCard.addEventListener('click', (e) => {
            e.stopPropagation();
            profileDropdown.classList.toggle('show');
        });

        document.addEventListener('click', () => {
            profileDropdown.classList.remove('show');
        });
    }
}

document.addEventListener('DOMContentLoaded', initSidebar);
