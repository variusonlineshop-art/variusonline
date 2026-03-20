/**
 * Script de Topbar con redundancia (Failover)
 * Intenta obtener la tasa de dos fuentes distintas.
 */

const API_SOURCES = [
    {
        name: 'DolarVzla API',
        url: 'https://api.dolarvzla.com/public/exchange-rate',
        parser: (data) => ({
            usd: data?.current?.usd,
            eur: data?.current?.eur
        })
    },
    {
        name: 'Exchangerr API (Fallback)',
        // Usamos una alternativa común o tu propio endpoint de respaldo
        url: 'https://api.exchangerr.com/v1/latest?base=USD&symbols=VES', 
        parser: (data) => ({
            usd: data?.rates?.VES,
            eur: null // Dependerá de la estructura de la API secundaria
        })
    }
];

async function updateTopbarRates() {
    const usdElement = document.getElementById('rate-usd');
    const eurElement = document.getElementById('rate-eur');
    let ratesFound = null;

    for (const source of API_SOURCES) {
        try {
            console.debug(`Intentando obtener tasas de: ${source.name}`);
            
            // Cache-busting para evitar datos viejos
            const fetchUrl = `${source.url}${source.url.includes('?') ? '&' : '?'}_=${Date.now()}`;
            
            const response = await fetch(fetchUrl, {
                method: 'GET',
                mode: 'cors',
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(5000) // Timeout de 5s para no bloquear el slider
            });

            if (!response.ok) throw new Error(`HTTP Error ${response.status}`);

            const data = await response.json();
            const parsed = source.parser(data);

            if (parsed.usd) {
                ratesFound = parsed;
                console.log(`✅ Tasas obtenidas con éxito desde ${source.name}`);
                break; // Salimos del bucle si tenemos éxito
            }
        } catch (error) {
            console.warn(`❌ Error en ${source.name}:`, error.message);
            // El bucle continuará con la siguiente fuente
        }
    }

    if (ratesFound) {
        // Formateo usando tu estándar local (coma para decimales)
        const usdStr = Number(ratesFound.usd).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        
        if (usdElement) usdElement.textContent = `$ Bs/USD ${usdStr}`;
        
        if (ratesFound.eur && eurElement) {
            const eurStr = Number(ratesFound.eur).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            eurElement.textContent = `€ Bs./EUR ${eurStr}`;
        }
    } else {
        console.error("No se pudo obtener la tasa de ninguna de las fuentes configuradas.");
    }
}

// Iniciar al cargar y refrescar cada 30 min
document.addEventListener('DOMContentLoaded', updateTopbarRates);
setInterval(updateTopbarRates, 30 * 60 * 1000);
