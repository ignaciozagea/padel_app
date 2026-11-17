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
            const data = await apiFetch('/api/login', { method: 'POST', body: { password } });
            if (data.success && data.token) {
                guardarSesion(data.token);
                cerrarModal();
                alert('✅ Acceso concedido. Ahora puedes gestionar ligas y torneos.');
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

    // Eventos
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
