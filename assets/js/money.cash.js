/**
 * Monitor de Divisas con Failover y Protección de DOM
 */

const API_SOURCES = [
    {
        name: 'DolarApi (Principal)',
        async fetcher() {
            const [resUsd, resEur] = await Promise.all([
                fetch('https://ve.dolarapi.com/v1/dolares'),
                fetch('https://ve.dolarapi.com/v1/euros')
            ]);
            if (!resUsd.ok || !resEur.ok) throw new Error("Error en respuesta de red");
            
            const dataUsd = await resUsd.json();
            const dataEur = await resEur.json();

            // Filtramos por fuente 'oficial' para cumplir con tus reglas de negocio
            return {
                usd: dataUsd.find(i => i.fuente === 'oficial')?.promedio,
                eur: dataEur.find(i => i.fuente === 'oficial')?.promedio
            };
        }
    },
    {
        name: 'PyDolar (Respaldo)',
        url: 'https://pydolarve.org/api/v1/dollar?page=bcv',
        async fetcher() {
            const res = await fetch(this.url);
            if (!res.ok) throw new Error("Error en PyDolar");
            const data = await res.json();
            return {
                usd: data.monitors?.usd?.price,
                eur: data.monitors?.eur?.price
            };
        }
    }
];

let globalTasaUsd = 0;

async function updateTopbarRates() {
    const usdElement = document.getElementById('rate-usd');
    const eurElement = document.getElementById('rate-eur');
    const cloneElement = document.getElementById('rate-usd-clone');
    let ratesFound = null;

    for (const source of API_SOURCES) {
        try {
            console.debug(`Consultando: ${source.name}`);
            const result = await source.fetcher();

            if (result.usd) {
                ratesFound = result;
                console.log(`✅ Datos obtenidos desde ${source.name}`);
                break; 
            }
        } catch (error) {
            console.warn(`⚠️ ${source.name} no disponible:`, error.message);
        }
    }

    if (ratesFound) {
        globalTasaUsd = ratesFound.usd;
        
        // Formateo según estándar local (coma para decimales)
        const usdStr = ratesFound.usd.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const eurStr = ratesFound.eur ? ratesFound.eur.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'N/A';

        if (usdElement) usdElement.textContent = `$ Bs/USD ${usdStr}`;
        if (cloneElement) cloneElement.textContent = `$ Bs/USD ${usdStr}`;
        if (eurElement) eurElement.textContent = `€ Bs./EUR ${eurStr}`;
    }
}

// Inicialización segura para evitar errores de "null" al cargar el DOM
function initFinanceModule() {
    const inputBs = document.getElementById('input-bs');
    const resultUsd = document.getElementById('result-usd');

    // Solo añade el listener si el elemento de la calculadora existe en la página
    if (inputBs) {
        inputBs.addEventListener('input', (e) => {
            const monto = parseFloat(e.target.value);
            if (monto > 0 && globalTasaUsd > 0) {
                const total = monto / globalTasaUsd;
                if (resultUsd) resultUsd.innerText = `$ ${total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            } else if (resultUsd) {
                resultUsd.innerText = `$ 0.00`;
            }
        });
    }

    updateTopbarRates();
}

// Ejecución controlada
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initFinanceModule);
} else {
    initFinanceModule();
}

// Sincronización automática cada 30 min para Varius y Tasty Station
setInterval(updateTopbarRates, 30 * 60 * 1000);
