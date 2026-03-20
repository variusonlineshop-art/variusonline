async function checkVPN() {
    try {
        // 1. Verificación básica por inconsistencia de Zona Horaria
        // Si el usuario tiene una zona horaria que no coincide con su IP, es sospechoso
        const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

        // 2. Consulta a API de geolocalización e integridad de IP
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();

        // Lista de flags comunes que indican VPN/Proxy
        const isProxy = data.proxy === true;

        // Comparación simple de país (Opcional: puedes bloquear si el país no es el tuyo)
        // Ejemplo: if (data.country_name !== 'Venezuela') ...

        if (isProxy) {
            showVPNModal();
        }
    } catch (error) {
        console.log("Error verificando conexión:", error);
    }
}

function showVPNModal() {
    const modal = document.getElementById('vpnModal');
    if (modal) {
        modal.style.display = 'flex';
        // Bloquear scroll del cuerpo para forzar la atención en el modal
        document.body.style.overflow = 'hidden';
    }
}

// Ejecutar la comprobación al cargar la página
window.addEventListener('load', checkVPN);