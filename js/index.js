 const ADMIN_PASSWORD = 'admin123';

    function abrirModal() {
        document.getElementById('loginModal').classList.add('active');
        document.getElementById('adminPassword').value = '';
        document.getElementById('loginError').textContent = '';
    }

    function cerrarModal() {
        document.getElementById('loginModal').classList.remove('active');
    }

    function iniciarSesion() {
        const password = document.getElementById('adminPassword').value;
        const errorDiv = document.getElementById('loginError');
        
        if (password === ADMIN_PASSWORD) {
            sessionStorage.setItem('adminAuth', 'true');
            cerrarModal();
            // Mostrar mensaje de éxito y redirigir
            alert('✅ Acceso concedido. Ahora puedes gestionar ligas y torneos.');
        } else {
            errorDiv.textContent = '❌ Contraseña incorrecta';
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