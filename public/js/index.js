    function abrirModal() {
        document.getElementById('loginModal').classList.add('active');
        document.getElementById('adminPassword').value = '';
        document.getElementById('loginError').textContent = '';
    }

    function cerrarModal() {
        document.getElementById('loginModal').classList.remove('active');
    }

    async function iniciarSesion() {
        const password = document.getElementById('adminPassword').value;
        const errorDiv = document.getElementById('loginError');
        const boton = document.getElementById('confirmLoginBtn');

        if (!password) {
            errorDiv.textContent = '❌ Introduce la contraseña';
            return;
        }

        boton.disabled = true;
        try {
            const data = await apiFetch('/api/login', { method: 'POST', body: { password }, autenticar: false });
            if (data.success && data.token) {
                guardarSesion(data.token);
                cerrarModal();
                mostrarEstadoSesion();
                notificar('✅ Acceso concedido. Ahora puedes gestionar ligas y torneos.');
            } else {
                errorDiv.textContent = '❌ ' + (data.error || 'Contraseña incorrecta');
            }
        } catch (error) {
            console.error('Error:', error);
            errorDiv.textContent = '❌ Error de conexión con el servidor';
        } finally {
            boton.disabled = false;
        }
    }

    // ==================== SESIÓN ====================
    // Muestra "Inicia sesión" o "Cerrar sesión" según haya un token válido
    function mostrarEstadoSesion() {
        const token = getAdminToken();
        document.getElementById('adminLoggedOut').style.display = token ? 'none' : 'block';
        document.getElementById('adminLoggedIn').style.display = token ? 'block' : 'none';
        if (token) {
            const caduca = new Date(Number(token.split('.')[0]));
            const hora = caduca.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
            document.getElementById('sessionExpiry').textContent = `(hasta las ${hora})`;
        }
    }

    async function salir() {
        const seguro = await confirmar('¿Cerrar la sesión de administrador?', { titulo: 'Cerrar sesión', iconoTitulo: 'salir', textoAceptar: 'Cerrar sesión' });
        if (!seguro) return;
        sessionStorage.removeItem(AUTH_KEY);
        mostrarEstadoSesion();
        notificar('👋 Sesión cerrada');
    }

    // ==================== INSTALAR COMO APP (PWA) ====================
    let solicitudInstalacion = null;

    window.addEventListener('beforeinstallprompt', (e) => {
        e.preventDefault();               // mostrar nuestro botón en lugar del aviso del navegador
        solicitudInstalacion = e;
        document.getElementById('installSection').style.display = 'block';
    });

    window.addEventListener('appinstalled', () => {
        solicitudInstalacion = null;
        document.getElementById('installSection').style.display = 'none';
        notificar('✅ Pádel GO instalada');
    });

    document.getElementById('installAppBtn').addEventListener('click', async () => {
        if (!solicitudInstalacion) return;
        solicitudInstalacion.prompt();
        await solicitudInstalacion.userChoice;
        solicitudInstalacion = null;
        document.getElementById('installSection').style.display = 'none';
    });

    // Eventos
    document.getElementById('adminLogoutBtn').addEventListener('click', salir);
    document.getElementById('adminLoginBtn').addEventListener('click', abrirModal);
    document.getElementById('confirmLoginBtn').addEventListener('click', iniciarSesion);
    document.getElementById('adminPassword').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') iniciarSesion();
    });

    // Cerrar modal al hacer clic fuera
    window.addEventListener('click', (e) => {
        const modal = document.getElementById('loginModal');
        if (e.target === modal) cerrarModal();
    });

    mostrarEstadoSesion();
