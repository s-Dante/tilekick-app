/**
 * Sidebar Logic — Dynamic User Data & Dropdown
 */
async function initSidebar() {
    const navUsername = document.getElementById('nav-username');
    const navAvatarImg = document.getElementById('nav-avatar-img');
    const navAvatarFallback = document.getElementById('nav-avatar-fallback');
    const profileCard = document.getElementById('nav-profile-card');
    const profileDropdown = document.getElementById('profile-dropdown');

    // Active link
    document.querySelectorAll('#sidebar-nav a, #sidebar-bottom a').forEach(link => {
        if (new URL(link.href).pathname === window.location.pathname) {
            link.classList.add('active');
        }
    });

    // Fetch user data for sidebar
    try {
        const res = await fetch('/api/me');
        if (res.ok) {
            const user = await res.json();
            if (navUsername) navUsername.textContent = user.username || user.name;
            
            if (navAvatarImg && user.avatar_url) {
                // Use cache buster to ensure it updates
                navAvatarImg.src = user.avatar_url + '?t=' + Date.now();
                navAvatarImg.style.display = 'block';
                if (navAvatarFallback) navAvatarFallback.style.display = 'none';
            } else if (navAvatarFallback) {
                if (navAvatarImg) navAvatarImg.style.display = 'none';
                navAvatarFallback.style.display = 'flex';
            }
        }
    } catch (err) {
        console.error('Error fetching sidebar user data:', err);
    }

    // Dropdown toggle
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
