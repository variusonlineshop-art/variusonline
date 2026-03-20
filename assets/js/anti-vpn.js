async function checkVPN() {
    console.log("Iniciando verificación de conexión...");
    
    try {
        // Método 1: Detección por discrepancia de Zona Horaria (Muy efectivo y rápido)
        // Compara la zona horaria del navegador con la que reporta la IP
        const response = await fetch('https://ipapi.co/json/');
        const data = await response.json();
        
        const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const ipTimezone = data.timezone;

        console.log("Zona Navegador:", browserTimezone);
        console.log("Zona IP:", ipTimezone);

        // Si hay una discrepancia o la API marca explícitamente proxy/vpn
        // Nota: Algunas extensiones de VPN no cambian la zona horaria del sistema, 
        // pero la IP sí cambia, creando una inconsistencia.
        if (data.proxy === true || data.vpn === true || (ipTimezone && browserTimezone !== ipTimezone)) {
            console.warn("VPN/Proxy Detectado");
            showVPNModal();
            return;
        }

        // Método 2: Verificación de WebRTC (Opcional/Avanzado)
        // Algunos VPNs filtran IPs reales, si no podemos obtener una IP local clara, podría ser VPN
        if (data.org && (data.org.toLowerCase().includes("hosting") || data.org.toLowerCase().includes("google llc") || data.org.toLowerCase().includes("amazon"))) {
            // Si la organización de la IP es un centro de datos (Hosting), es un VPN
            showVPNModal();
        }

    } catch (error) {
        console.error("Error en la verificación:", error);
    }
}

function showVPNModal() {
    const modal = document.getElementById('vpnModal');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden'; // Bloquea el scroll
    }
}

// Ejecutar
checkVPN();
