// assets/js/kpis.js
import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
    getFirestore,
    collection,
    query,
    onSnapshot,
    orderBy,
    where
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);

// Estado global para el modal de stock
let productosBajoStock = [];

/**
 * 1. KPI: STOCK CRÍTICO
 * Escucha productos con stock menor a 6
 */
function listenStockCritico() {
    const productsCol = collection(db, 'product');
    const q = query(productsCol, where('stock', '<', 6), orderBy('stock', 'asc'));

    onSnapshot(q, (snapshot) => {
        productosBajoStock = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            productosBajoStock.push({
                id: doc.id,
                name: data.name || data.title || 'Producto sin nombre',
                stock: data.stock || 0,
                sku: data.sku || data.code || 'S/N'
            });
        });

        // Actualizar el número en el KPI (ID: kpi-stock)
        const kpiValue = document.getElementById('kpi-stock');
        if (kpiValue) {
            kpiValue.textContent = productosBajoStock.length;
        }

        // Actualizar barra de progreso visual
        const card = document.getElementById('kpi-stock')?.closest('.bg-white');
        const progressBar = card?.querySelector('.bg-red-500');
        if (progressBar) {
            const porcentaje = Math.min((productosBajoStock.length / 20) * 100, 100);
            progressBar.style.width = `${porcentaje}%`;
        }
    });
}

/**
 * 2. KPI: PEDIDOS HOY
 * Filtra por la fecha actual (orderDate) y excluye estados no deseados.
 */
function listenOrdersToday() {
    // 1. Obtener la fecha de hoy en formato YYYY-MM-DD (Ej: "2026-04-11")
    const hoy = new Date().toISOString().split('T')[0];

    const q = query(
        collection(db, "orders"),
        where("orderDate", "==", hoy) // Filtra solo los del día actual
    );

    onSnapshot(q, (snapshot) => {
        const kpiOrders = document.getElementById('kpi-orders');
        
        // 2. Definir los estados que queremos EXCLUIR
        const estadosExcluidos = ['anulado', 'suspendido', 'cancelado'];

        // 3. Contar manualmente los que cumplen la condición de estatus
        let contadorValido = 0;
        snapshot.forEach(doc => {
            const data = doc.data();
            // Convertimos a minúsculas para una comparación segura
            const status = (data.status || "").toLowerCase();
            
            if (!estadosExcluidos.includes(status)) {
                contadorValido++;
            }
        });

        if (kpiOrders) {
            kpiOrders.textContent = contadorValido;
        }
    });
}

/**
 * 3. KPI: VENTAS DEL DÍA
 */
function listenSalesToday() {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const q = query(
        collection(db, "orders"),
        where("createdAt", ">=", startOfDay)
    );

    onSnapshot(q, (snapshot) => {
        let total = 0;
        snapshot.forEach(doc => {
            const data = doc.data();
            total += parseFloat(data.total || 0);
        });

        const kpiSales = document.getElementById('kpi-sales');
        if (kpiSales) {
            kpiSales.textContent = `$ ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        }
    });
}

/**
 * --- LÓGICA DEL MODAL DE STOCK ---
 */

window.abrirModalStock = function() {
    const modal = document.getElementById('modal-stock-critico');
    const body = document.getElementById('modal-stock-body');
    
    if (!modal || !body) {
        console.error("No se encontró el modal en el HTML");
        return;
    }

    if (productosBajoStock.length === 0) {
        body.innerHTML = `
            <div class="flex flex-col items-center text-center py-10">
                <div class="w-20 h-20 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner">
                    <i class="fa-solid fa-check-double"></i>
                </div>
                <h3 class="text-lg font-black text-gray-800 mb-2">¡Inventario Impecable!</h3>
                <p class="text-sm text-gray-500 max-w-xs leading-relaxed">No se encuentra ningún producto con stock bajo. Felicidades por mantener un stock en movimiento.</p>
            </div>
        `;
    } else {
        let html = `<div class="grid gap-3">`;
        productosBajoStock.forEach(p => {
            html += `
                <div class="flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all">
                    <div class="flex flex-col">
                        <span class="text-sm font-bold text-gray-800 uppercase leading-tight">${p.name}</span>
                        <span class="text-[10px] font-medium text-gray-400 mt-1">SKU: ${p.sku}</span>
                    </div>
                    <div class="flex flex-col items-end">
                        <span class="text-xl font-black ${p.stock <= 2 ? 'text-red-600' : 'text-amber-500'}">${p.stock}</span>
                        <span class="text-[9px] font-bold uppercase text-gray-400">unidades</span>
                    </div>
                </div>
            `;
        });
        html += `</div>`;
        body.innerHTML = html;
    }

    modal.classList.remove('hidden');
    modal.classList.add('flex'); // Asegura que se vea centrado con flex
    document.body.style.overflow = 'hidden';
};

window.cerrarModalStock = function() {
    const modal = document.getElementById('modal-stock-critico');
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
    document.body.style.overflow = 'auto';
};

/**
 * INICIALIZACIÓN DE EVENTOS
 */
document.addEventListener("DOMContentLoaded", () => {
    // Iniciar suscripciones
    listenStockCritico();
    listenOrdersToday();
    listenSalesToday();

    // Vincular Click a la Tarjeta de Stock Crítico
    const kpiLabel = Array.from(document.querySelectorAll('p')).find(el => el.textContent.trim() === 'Stock Crítico');
    if (kpiLabel) {
        const card = kpiLabel.closest('.bg-white');
        if (card) {
            card.style.cursor = 'pointer';
            card.addEventListener('click', (e) => {
                // Evitar que abra si se hace click en algún botón interno específico si existiera
                if (e.target.closest('button')) return;
                window.abrirModalStock();
            });
        }
    }

    // Cerrar modal al hacer click en el overlay oscuro
    const modal = document.getElementById('modal-stock-critico');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal || e.target.classList.contains('bg-slate-900/60')) {
                window.cerrarModalStock();
            }
        });
    }
});
