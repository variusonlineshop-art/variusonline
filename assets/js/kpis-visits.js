import { initializeApp } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-app.js";
import { getFirestore, collection, query, orderBy, limit, onSnapshot, getDocs, getCountFromServer } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.0.0/firebase-auth.js"; // 🔐 Sensor de sesión activa
import { firebaseConfig } from "./firebase-config.js";
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app); // Inicializamos autenticación
let allVisits = []; 
let totalRegistrosHistoricos = 0; 
let paginaActual = 1;
const registrosPorPagina = 5;
// ⏱️ CRONÓMETRO DE RENDIMIENTO: Mide la velocidad de respuesta inicial en boxes
const tiempoInicioCarga = performance.now();
let cronometroFinalizado = false; 
let felicitacionDisparada = false;
let usuarioAutenticado = false; 
// --- MONITOR DE SESIÓN ACTIVA ---
// Detecta si el usuario está logueado con cualquier rol para que no altere la medicion
onAuthStateChanged(auth, (user) => {
    if (user) {
        usuarioAutenticado = true;
        console.log("🔐 [KPI Engine]: Usuario con sesión activa detectado (Tráfico administrativo excluido).");
    } else {
        usuarioAutenticado = false;
    }
});
function listenGlobalVisits() {
    const qRealtime = query(collection(db, "visits"), orderBy("fecha_registro", "desc"), limit(5));
    onSnapshot(qRealtime, async (querySnapshot) => {
        try {
            if (usuarioAutenticado) {
                console.log("🚫 [Bypass Activo]: Navegación interna de la escudería. Omitiendo incremento visual.");
                return;
            }
            const qContador = query(collection(db, "visits"));
            const countSnapshot = await getCountFromServer(qContador);
            totalRegistrosHistoricos = countSnapshot.data().count;
            const kpiElement = document.getElementById("kpi-visitas-carrito-value");
            if (kpiElement) kpiElement.textContent = totalRegistrosHistoricos;
            if (!cronometroFinalizado) {
                const tiempoFinCarga = performance.now();
                const tiempoTotalSegundos = ((tiempoFinCarga - tiempoInicioCarga) / 1000).toFixed(2);
                console.log(`[TELEMETRÍA]: ¡KPI "Contador de Visitas" cargado con éxito!`, "color: #10b981; font-weight: bold; font-size: 11px;");
                console.log(`Tiempo de respuesta: ${tiempoTotalSegundos} segundos para procesar ${totalRegistrosHistoricos} registros.`, "color: #3b82f6; font-weight: bold;");
                cronometroFinalizado = true;
            }
            const metaVisitas = 60000; 
            const porcentaje = Math.min((totalRegistrosHistoricos / metaVisitas) * 100, 100);
            const progressBar = document.getElementById("kpi-visitas-bar");
            if (progressBar) {
                progressBar.style.width = `${porcentaje}%`;
            }
            if (totalRegistrosHistoricos >= metaVisitas && !felicitacionDisparada) {
                window_dispararAnimacionMetaCumplida(metaVisitas);
                felicitacionDisparada = true; // Bloqueo de seguridad para evitar spam
            }
        } catch (error) {
            console.error("Error en el inyector del contador:", error);
        }
    });
}
function window_dispararAnimacionMetaCumplida(meta) {
    console.log("🏆 [VARIUS OMNICHANNEL]: ¡META GLOBAL ALCANZADA!");
    const logroHTML = `
    <div id="varius-logro-meta" class="fixed bottom-5 right-5 z-[99999] bg-slate-950 border-2 border-emerald-500 rounded-2xl p-5 shadow-2xl max-w-sm flex items-center gap-4 animate-bounce font-sans">
        <div class="bg-emerald-500/20 text-emerald-400 p-3 rounded-xl text-2xl">🏆</div>
        <div class="flex flex-col gap-0.5">
            <h4 class="text-white font-black text-xs uppercase tracking-wider">¡Meta de Tráfico Alcanzada!</h4>
            <p class="text-slate-300 text-[11px] leading-tight">
                Felicitaciones al <strong>Equipo de VariusOnline</strong> por la Meta Cumplida de <span class="text-emerald-400 font-bold">${meta.toLocaleString()}</span> visitas en el catálogo. ¡A fondo!
            </p>
        </div>
    </div>`;
    document.body.insertAdjacentHTML('beforeend', logroHTML);
    setTimeout(() => {
        const tarjetaLogro = document.getElementById('varius-logro-meta');
        if (tarjetaLogro) {
            tarjetaLogro.style.transition = "all 0.5s ease";
            tarjetaLogro.style.opacity = "0";
            tarjetaLogro.style.transform = "translateY(20px)";
            setTimeout(() => tarjetaLogro.remove(), 500);
        }
    }, 6000);
}
async function abrirModalVisitasCarrito() {
    paginaActual = 1;
    const bodyModal = document.getElementById("modalVisitasCarritoBody");
    if(bodyModal) bodyModal.innerHTML = `<div class="p-10 text-center text-xs text-slate-400 font-medium">📡 Extrayendo telemetría limpia de clientes...</div>`;
    document.getElementById("modal-visitas-carrito").classList.remove("hidden");
    try {
        const qCompleto = query(collection(db, "visits"), orderBy("fecha_registro", "desc"));
        const querySnapshot = await getDocs(qCompleto);
        allVisits = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            if (data.tipo_usuario !== "admin" && data.tipo_usuario !== "colaborador") {
                allVisits.push({ id: doc.id, ...data });
            }
        });
        renderizarEstructuraModal();
    } catch (error) {
        console.error("Error en pits al filtrar visitas:", error);
    }
}
function renderizarEstructuraModal() {
    const totalRegistros = allVisits.length || totalRegistrosHistoricos;
    const unicas = [...new Set(allVisits.map(v => v.ip).filter(Boolean))].length;
    const activas = allVisits.filter(v => v.online).length;
    const totalPaginas = Math.ceil(totalRegistros / registrosPorPagina) || 1;
    let html = `
    <div class="p-5 bg-slate-50 font-sans">
        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="bg-white p-4 rounded-xl border-l-4 border-emerald-500 shadow-sm">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Total</p>
                <h3 class="text-2xl font-black text-slate-800">${totalRegistros}</h3>
            </div>
            <div class="bg-white p-4 rounded-xl border-l-4 border-blue-500 shadow-sm">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Únicas</p>
                <h3 class="text-2xl font-black text-slate-800">${unicas}</h3>
            </div>
            <div class="bg-white p-4 rounded-xl border-l-4 border-amber-500 shadow-sm">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Online</p>
                <h3 class="text-2xl font-black text-slate-800">${activas}</h3>
            </div>
            <div class="bg-white p-4 rounded-xl border-l-4 border-rose-500 shadow-sm">
                <p class="text-[10px] font-bold text-slate-400 uppercase">Páginas</p>
                <h3 class="text-2xl font-black text-slate-800">${totalPaginas}</h3>
            </div>
        </div>
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-6">
            <div id="tabla-dinamica-container">
                ${renderizarTablaPaginada()}
            </div>
        </div>
        <div class="flex flex-col sm:flex-row gap-3 border-t border-slate-200 pt-6">
            <button onclick="window.location.href='/admin/visits.html'" 
                    class="flex-1 bg-emerald-600 text-white py-2.5 rounded-lg font-bold text-sm hover:bg-emerald-700 transition-all flex items-center justify-center gap-2">
                <i class="fa-solid fa-chart-line"></i> Ver más detalles
            </button>
            <button onclick="cerrarModalVisitas()" 
                    class="flex-1 bg-slate-200 text-slate-700 py-2.5 rounded-lg font-bold text-sm hover:bg-slate-300 transition-all">
                Cerrar
            </button>
        </div>
    </div>`;
    document.getElementById("modalVisitasCarritoBody").innerHTML = html;
}
function renderizarTablaPaginada() {
    const inicio = (paginaActual - 1) * registrosPorPagina;
    const fin = inicio + registrosPorPagina;
    const visitasPaginadas = allVisits.slice(inicio, fin);
    const totalPaginas = Math.ceil(allVisits.length / registrosPorPagina) || 1;
    return `
        <table class="w-full text-left text-xs">
            <thead class="bg-slate-50 border-b border-slate-100 text-slate-600">
                <tr>
                    <th class="p-4 font-bold uppercase tracking-tighter">Usuario / IP</th>
                    <th class="p-4 font-bold uppercase tracking-tighter text-center">Estado</th>
                </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
                ${visitasPaginadas.map(v => `
                    <tr class="hover:bg-slate-50">
                        <td class="p-4">
                            <div class="font-bold text-slate-700">${v.ip || '0.0.0.0'}</div>
                            <div class="text-[10px] text-slate-400 truncate max-w-[200px]">${v.url_pagina?.split('/').pop() || '/index.html'}</div>
                        </td>
                        <td class="p-4 text-center">
                            <span class="px-2.5 py-1 rounded-full text-[9px] font-black ${v.online ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-400'}">
                                ${v.online ? 'ONLINE' : 'OFF'}
                            </span>
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
        <div class="p-4 bg-slate-50 border-t border-slate-100 flex justify-between items-center">
            <div class="flex gap-2">
                <button onclick="cambiarPaginaModal(-1)" ${paginaActual === 1 ? 'disabled' : ''} 
                        class="px-3 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-bold hover:bg-slate-100 disabled:opacity-30">
                    Anterior
                </button>
                <button onclick="cambiarPaginaModal(1)" ${paginaActual === totalPaginas ? 'disabled' : ''} 
                        class="px-3 py-1.5 bg-white border border-slate-200 rounded text-[10px] font-bold hover:bg-slate-100 disabled:opacity-30">
                    Siguiente
                </button>
            </div>
            <span class="text-[10px] font-bold text-slate-400 uppercase">Pág. ${paginaActual} / ${totalPaginas}</span>
        </div>`;
}
window.cambiarPaginaModal = (direccion) => {
    paginaActual += direccion;
    const container = document.getElementById("tabla-dinamica-container");
    if (container) container.innerHTML = renderizarTablaPaginada();
};
window.cerrarModalVisitas = () => {
    document.getElementById("modal-visitas-carrito").classList.add("hidden");
};
window.abrirModalVisitasCarrito = abrirModalVisitasCarrito;
document.addEventListener("DOMContentLoaded", () => {
    listenGlobalVisits();
    const btnX = document.getElementById("closeModalVisitasCarrito");
    if (btnX) btnX.onclick = window.cerrarModalVisitas;
});
