/**
 * Script para actualizar las tasas en la Topbar
 * Basado en la lógica de fetchRates de payment-modal.js
 */

const EXCHANGE_API_URL = 'https://api.dolarvzla.com/public/exchange-rate';

async function updateTopbarRates() {
    const usdElement = document.getElementById('rate-usd');
    const eurElement = document.getElementById('rate-eur');

    try {
        // Añadimos cache-busting igual que en tu archivo de referencia
        const url = `${EXCHANGE_API_URL}?_=${Date.now()}`;

        const response = await fetch(url, {
            method: 'GET',
            mode: 'cors',
            headers: { 'Accept': 'application/json' }
        });

        if (!response.ok) throw new Error('Error en API');

        const data = await response.json();
        const current = data?.current;

        if (current) {
            // Extraemos y formateamos (usando tu lógica de 2 decimales con coma)
            const usd = Number(current.usd).toLocaleString('es-ES', { minimumFractionDigits: 2 });
            const eur = Number(current.eur).toLocaleString('es-ES', { minimumFractionDigits: 2 });

            // Actualizamos el texto del slider
            if (usdElement) usdElement.textContent = `$ Bs/USD ${usd}`;
            if (eurElement) eurElement.textContent = `€ Bs./EUR ${eur}`;

            console.log("Topbar: Tasas actualizadas correctamente.");
        }
    } catch (error) {
        console.warn('No se pudieron cargar las tasas para la topbar:', error);
        // Opcional: Mostrar un valor fijo o "Cargando..." si falla
    }
}

// Ejecutar al cargar la página
document.addEventListener('DOMContentLoaded', updateTopbarRates);

// Opcional: Actualizar cada 30 minutos
setInterval(updateTopbarRates, 30 * 60 * 1000);