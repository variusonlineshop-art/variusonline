import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.2/firebase-app.js";
import {
    getFirestore,
    collection,
    query,
    where,
    getDocs,
    addDoc,
    updateDoc,
    doc,
    serverTimestamp,
    writeBatch
} from "https://www.gstatic.com/firebasejs/9.22.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const currentUserEmail = localStorage.getItem('userEmail') || 'usuario@demo.com';
const elTotalBs = document.getElementById('total-bs');
const elTotalUsd = document.getElementById('total-usd');
const elTotalOrders = document.getElementById('total-orders');
const toastEl = document.getElementById('toast');

let ordenesDia = [];
let totalesHoy = { bs: 0, usd: 0 };

// --- VARIABLE GLOBAL PARA ALMACENAR LA TASA DEL EURO DEL DÍA ---
let tasaEuroDelDia = 45.00; // Valor de respaldo por si fallan las APIs externas

// --- CACHÉ EN MEMORIA PARA REDUCIR LECTURAS DE FIRESTORE (OPTIMIZACIÓN N+1) ---
const cacheUsuarios = new Map();

// --- INTEGRACIÓN DE LAS APIS DE DIVISAS (BCV) ---
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

            const findOficial = (arr) => arr.find(i =>
                (i.fuente && i.fuente.toLowerCase() === 'oficial') ||
                (i.casa && i.casa.toLowerCase() === 'bcv') ||
                (i.nombre && i.nombre.toLowerCase() === 'bcv')
            );

            const bcvUsd = findOficial(dataUsd);
            const bcvEur = findOficial(dataEur);

            if (!bcvUsd || !bcvEur) throw new Error("Tasas BCV no encontradas en el JSON");

            return {
                usd: bcvUsd.promedio,
                eur: bcvEur.promedio
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

// Función para cargar la tasa del Euro antes de procesar cálculos
async function consultarTasaEuro() {
    for (const source of API_SOURCES) {
        try {
            console.log(`Intentando obtener tasa BCV desde: ${source.name}`);
            const tasas = await source.fetcher();
            if (tasas && tasas.eur) {
                tasaEuroDelDia = Number(tasas.eur);
                console.log(`Tasa del EURO (BCV) cargada con éxito: Bs. ${tasaEuroDelDia}`);
                return;
            }
        } catch (err) {
            console.warn(`Falló la fuente ${source.name}:`, err.message);
        }
    }
    console.error("No se pudo obtener la tasa de Euro de ninguna API. Se usará el valor de respaldo:", tasaEuroDelDia);
}

// Pre-carga todos los usuarios de Firestore en memoria una sola vez
async function precargarUsuariosEnCache() {
    try {
        cacheUsuarios.clear();
        const usersRef = collection(db, 'users');
        const snap = await getDocs(usersRef);
        snap.forEach(doc => {
            const data = doc.data();
            if (data.name) {
                cacheUsuarios.set(data.name, data);
            }
        });
        console.log(`Caché de usuarios lista. ${cacheUsuarios.size} usuarios cargados.`);
    } catch (e) {
        console.error("Error precargando usuarios en caché:", e);
    }
}

function showAlertModal(message, cbOk) {
    let modal = document.getElementById('modal-alert');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-alert';
        modal.style.cssText = `z-index:10000;position:fixed;left:0;top:0;width:100vw;height:100vh;background:#171717bb;display:flex;align-items:center;justify-content:center;`;
        modal.innerHTML = `
      <div style=\"background:#fff;padding:2.5em 2em;min-width:320px;max-width:94vw;margin:auto;border-radius:14px;box-shadow:0 8px 40px #0007;text-align:center;position:relative;\">
        <div id=\"modal-message\" style=\"font-size:1.1em; color:#1e293b; font-weight:500;\"></div>
        <button id=\"modal-ok\" style=\"margin-top:1.5em;font-weight:bold;padding: 0.6em 1.3em;border-radius:7px;font-size:1em;background:#10b981;color:#fff;border:0;cursor:pointer;\">OK</button>
      </div>`;
        document.body.appendChild(modal);
    }
    document.getElementById('modal-message').innerHTML = message;
    modal.style.display = 'flex';
    document.getElementById('modal-ok').onclick = () => {
        modal.style.display = 'none';
        if (cbOk) cbOk();
    }
}

function showToast(msg, timeout = 3000) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    setTimeout(() => {
        toastEl.classList.remove('show');
        toastEl.textContent = '';
    }, timeout);
}
function formatBs(value) {
    try { return 'Bs ' + Number(value).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch (e) { return 'Bs 0,00'; }
}
function formatUsd(value) {
    try { return '$' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    catch (e) { return '$0.00'; }
}

// --- LÓGICA DE CÁLCULO DE COMISIONES BIMONETARIAS BASADA EN EURO BCV ---
function resolverEstructuraComision(userConfig, orderTotals, tasaCambioEuro = tasaEuroDelDia) {
    let comisionBs = 0;
    let comisionUsd = 0;
    const tipo = userConfig?.commissionType || 'amount';
    const valor = Number(userConfig?.commissionValue || 0);

    if (tipo === 'amount') {
        comisionUsd = valor;
        if (valor >= 1) {
            comisionBs = valor * tasaCambioEuro;
        } else {
            comisionBs = 0; 
        }
    } else if (tipo === 'percent') {
        comisionUsd = Number(orderTotals.usd) * (valor / 100);
        comisionBs = Number(orderTotals.bs) * (valor / 100);
    }

    return {
        commissionType: tipo,
        commissionValue: valor,
        comisionBs: isNaN(comisionBs) ? 0 : comisionBs,
        comisionUsd: isNaN(comisionUsd) ? 0 : comisionUsd
    };
}

function tiempoEntrega(inicio, fin) {
    if (!inicio || !fin) return '--';
    const tIni = (inicio.seconds ? inicio.seconds * 1000 : Number(inicio)) || 0;
    const tFin = (fin.seconds ? fin.seconds * 1000 : Number(fin)) || 0;
    if (!tIni || !tFin || isNaN(tIni) || isNaN(tFin)) return '--';
    const diffMs = Math.abs(tFin - tIni);
    const minutos = Math.round(diffMs / (1000 * 60));
    return `${minutos} min`;
}

function getOrderTotalInBsAndUsd(metodos) {
    let bs = 0, usd = 0;
    for (const method of (metodos || [])) {
        const conv = method.conversion ?? {};
        const currencyRaw = (conv.currency || method.currency || '').toLowerCase();
        if (currencyRaw.includes('bs') || currencyRaw.includes('ves') || currencyRaw.includes('bolivar')) {
            bs += Number(method.bsAmount || conv.bsAmount || (conv.rate && conv.originalAmount ? conv.originalAmount * conv.rate : 0) || 0);
        } else if (currencyRaw.includes('usd') || currencyRaw.includes('dolar')) {
            usd += Number(conv.originalAmount ?? conv.usdEquivalent ?? method.originalAmount ?? 0);
        }
    }
    return { bs, usd };
}

function getUserCommissionInfoFromCache(userName) {
    if (!userName || !cacheUsuarios.has(userName)) {
        return { commissionType: "amount", commissionValue: 0 };
    }
    return cacheUsuarios.get(userName);
}

function resolveAgent(order, role) {
    if (role === "vendedor") return order.assignedSellerName || '';
    if (role === "motorizado") return order.assignedMotorizedName || '';
    return '';
}
function isoDateFromValue(v) {
    if (!v) return null;
    if (typeof v === 'string') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    if (typeof v === 'number') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
    if (typeof v.toDate === 'function') { try { return v.toDate(); } catch (e) { return null; } }
    return null;
}
function isSameIsoDay(dateObj, compareTo = new Date()) {
    if (!dateObj) return false;
    try {
        const d1 = dateObj.toISOString().slice(0, 10);
        const d2 = compareTo.toISOString().slice(0, 10);
        return d1 === d2;
    } catch (e) {
        return false;
    }
}

// ----------------- GENERADORES DE HTML TAILWIND ----------------- //

function formatProductItem(item) {
    const total = `$${(item.quantity * item.price).toFixed(2)}`;
    return `
    <div class="py-2 flex items-center justify-between text-xs">
        <div class="flex items-center gap-3">
            <div class="w-8 h-8 bg-slate-100 rounded flex items-center justify-center text-slate-400"><i class="fa-solid fa-box-open"></i></div>
            <div>
                <p class="font-semibold text-slate-800">${item.name}</p>
                <p class="text-slate-400 font-medium">Cant: ${item.quantity} x $${item.price.toFixed(2)}</p>
            </div>
        </div>
        <span class="font-bold text-slate-800">${total}</span>
    </div>`;
}

function commissionBadgeTW(label, bs, usd, color) {
    let bg, text, border;
    if(color === 'blue') { bg = 'bg-blue-50'; border = 'border-blue-100'; text = 'text-blue-700'; }
    else if(color === 'purple') { bg = 'bg-purple-50'; border = 'border-purple-100'; text = 'text-purple-700'; }
    else { bg = 'bg-emerald-50'; border = 'border-emerald-100'; text = 'text-emerald-700'; }
    
    return `<span class="px-2 py-1 ${bg} border ${border} text-[10px] font-bold ${text} rounded uppercase tracking-wide">
        ${label}: {Bs ${Number(bs).toLocaleString('es-VE', { minimumFractionDigits: 2 })} / $${Number(usd).toLocaleString('en-US', { minimumFractionDigits: 2 })}}
    </span>`;
}

function buildOrderCard(order, vendedorInfo, motorizadoInfo, orderTotals, tiempoEnt) {
    const statusEntrega = (order.shippingStatus || '').toUpperCase() === 'ENTREGADO'
        ? `<span class="inline-block mt-2 px-2 py-0.5 text-[9px] font-bold bg-emerald-100 text-emerald-800 rounded">ENTREGADO</span>` : '';

    const vendName = resolveAgent(order, 'vendedor') || '---';
    const motName = resolveAgent(order, 'motorizado') || '---';

    let liquidacionHTML = (order.payment?.methods || []).map(m => {
        const conv = m.conversion ?? {};
        const raw = (conv.currency || m.currency || '').toLowerCase();
        let label = m.method === "cash" && raw.includes('usd') ? "Efectivo USD"
            : m.method === "cash" && raw.includes('bs') ? "Efectivo BS"
            : m.method === "mobile" ? "Pago Móvil"
            : m.method === "paypal" ? "PAYPAL" : m.method;
        
        let value = '', sym = '';
        if (raw.includes('usd')) {
            value = (conv.originalAmount ?? conv.usdEquivalent ?? m.originalAmount ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2 });
            sym = '$';
        } else {
            value = (m.bsAmount || conv.bsAmount || (conv.originalAmount && conv.rate ? conv.originalAmount * conv.rate : 0) || 0).toLocaleString("es-VE", { minimumFractionDigits: 2 });
            sym = 'Bs';
        }
        return `<div class="flex justify-between items-center border-b border-slate-800/50 pb-1 mb-1 text-xs">
            <span class="text-slate-400 font-bold uppercase">${label}</span>
            <span class="font-mono font-bold text-emerald-400">${sym} ${value}</span>
        </div>`;
    }).join('');

    return `
    <div class="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden mb-4">
        <div class="p-4 bg-slate-50/60 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none hover:bg-slate-100/50 transition-colors"
            onclick="window.toggleDetails('order-${order.id}')">
            <div class="flex items-center gap-3">
                <div class="p-2 bg-amber-50 text-amber-600 rounded-lg text-xs"><i class="fa-solid fa-box"></i></div>
                <div>
                    <span class="text-xs font-mono font-bold text-slate-800">${order.id || '---'}</span>
                    <span class="mx-1.5 text-slate-300">•</span>
                    <span class="text-xs font-bold text-slate-500 uppercase">${order.customerData?.Customname ?? ''}</span>
                    <div class="flex gap-3 mt-0.5 text-[11px] text-slate-500">
                        <span><i class="fa-solid fa-user text-slate-400 mr-1"></i> V: ${vendName}</span>
                        <span><i class="fa-solid fa-motorcycle text-slate-400 mr-1"></i> M: ${motName}</span>
                    </div>
                </div>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-right">
                ${commissionBadgeTW('Cobrado', orderTotals.bs, orderTotals.usd, 'blue')}
                ${commissionBadgeTW(`Com. Vend (${vendedorInfo.commissionType === 'percent' ? vendedorInfo.commissionValue + '%' : 'Fijo $' + vendedorInfo.commissionValue})`, vendedorInfo.comisionBs, vendedorInfo.comisionUsd, 'purple')}
                ${commissionBadgeTW(`Com. Mot (${motorizadoInfo.commissionType === 'percent' ? motorizadoInfo.commissionValue + '%' : 'Fijo $' + motorizadoInfo.commissionValue})`, motorizadoInfo.comisionBs, motorizadoInfo.comisionUsd, 'green')}
                <button class="p-1 text-slate-400"><i id="icon-order-${order.id}" class="fa-solid fa-chevron-down transition-transform duration-200"></i></button>
            </div>
        </div>

        <div id="order-${order.id}" class="hidden p-5 grid grid-cols-1 lg:grid-cols-12 gap-6 transition-all">
            <div class="lg:col-span-4 space-y-4">
                <div>
                    <h4 class="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5"><i class="fa-solid fa-user text-[10px] mr-1"></i> DATOS DEL CLIENTE</h4>
                    <div class="bg-slate-50/80 p-3.5 rounded-lg border border-slate-200/60 text-xs">
                        <p class="font-bold text-slate-800">${order.customerData?.Customname ?? ''}</p>
                        <p class="font-mono text-slate-500 mt-0.5">${order.customerData?.phone ?? ''}</p>
                        <p class="text-slate-500 mt-1.5 leading-relaxed">${order.customerData?.readable_address ?? ''}</p>
                    </div>
                </div>
                <div>
                    <h4 class="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5"><i class="fa-solid fa-truck text-[10px] mr-1"></i> LOGÍSTICA DE ENTREGA</h4>
                    <div class="bg-slate-50/80 p-3.5 rounded-lg border border-slate-200/60 text-xs flex justify-between items-center">
                        <div>
                            <p class="text-slate-500">Motorizado: <span class="font-medium text-slate-700">${motName}</span></p>
                            ${statusEntrega}
                        </div>
                        <div class="text-right text-slate-500 font-medium">
                            <i class="fa-regular fa-clock mr-1"></i> ${tiempoEnt}
                        </div>
                    </div>
                </div>
            </div>

            <div class="lg:col-span-5">
                <h4 class="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5"><i class="fa-solid fa-basket-shopping text-[10px] mr-1"></i> PRODUCTOS DEL PEDIDO</h4>
                <div class="divide-y divide-slate-100 border border-slate-100 rounded-lg p-2 bg-white shadow-inner">
                    ${(order.items || []).map(formatProductItem).join('')}
                </div>
            </div>

            <div class="lg:col-span-3">
                <h4 class="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">RESUMEN DE LIQUIDACIÓN</h4>
                <div class="bg-slate-900 text-white p-4 rounded-xl flex flex-col justify-between min-h-[155px] shadow-sm">
                    <div>
                        ${liquidacionHTML}
                    </div>
                    <div class="mt-4">
                        <p class="text-[9px] text-slate-400 font-bold uppercase tracking-wider">GRAN TOTAL COBRADO</p>
                        <p class="text-base font-bold font-mono text-white">$${orderTotals.usd.toLocaleString("en-US", { minimumFractionDigits: 2 })} + Bs ${orderTotals.bs.toLocaleString("es-VE", { minimumFractionDigits: 2 })}</p>
                    </div>
                </div>
            </div>
        </div>
    </div>`;
}

// ----------------- FLUJO PRINCIPAL Y RENDERS ----------------- //

async function renderOrders(orders, skipFiltros = false) {
    const ordersListDiv = document.getElementById('orders-list');
    if (!ordersListDiv || !orders) return;

    const yaCerrado = orders.some(ord => ord.cierreCaja && ord.cierreCaja.fecha);

    let html = '';
    let totalComiVendBs = 0, totalComiVendUsd = 0, totalComiMotBs = 0, totalComiMotUsd = 0;

    for (const ord of orders) {
        const vendedor = resolveAgent(ord, 'vendedor');
        const motorizado = resolveAgent(ord, 'motorizado');
        
        const rawVendedorConfig = getUserCommissionInfoFromCache(vendedor);
        const rawMotorizadoConfig = getUserCommissionInfoFromCache(motorizado);
        
        const orderTotals = getOrderTotalInBsAndUsd((ord.payment && ord.payment.methods) || []);
        
        const vendedorInfo = resolverEstructuraComision(rawVendedorConfig, orderTotals);
        const motorizadoInfo = resolverEstructuraComision(rawMotorizadoConfig, orderTotals);
        
        const tiempoEnt = tiempoEntrega(ord.timestamp, ord.paymentUpdatedAt);
        
        html += buildOrderCard(ord, vendedorInfo, motorizadoInfo, orderTotals, tiempoEnt);

        totalComiVendBs += vendedorInfo.comisionBs;
        totalComiVendUsd += vendedorInfo.comisionUsd;
        totalComiMotBs += motorizadoInfo.comisionBs;
        totalComiMotUsd += motorizadoInfo.comisionUsd;
    }
    
    if(orders.length === 0) {
        html = `<div class="p-8 text-center text-slate-400 bg-white rounded-xl border border-slate-200">No hay pedidos pagados registrados para hoy.</div>`;
    }
    
    ordersListDiv.innerHTML = html;

    const bottomGrid = document.getElementById('bottom-grid');
    if (bottomGrid) {
        let conciliacionHTML = '';
        if (yaCerrado) {
            conciliacionHTML = `
            <div class="lg:col-span-5 bg-emerald-50 p-5 rounded-xl border border-emerald-200 shadow-sm flex flex-col items-center justify-center gap-2 text-center">
                <i class="fa-solid fa-circle-check text-4xl text-emerald-500 mb-2"></i>
                <div class="text-emerald-800 font-bold tracking-wide">CIERRE DE CAJA COMPLETADO</div>
                <div class="text-xs text-emerald-600">Las órdenes de hoy ya fueron conciliadas.</div>
            </div>`;
        } else {
            conciliacionHTML = `
            <div class="lg:col-span-5 bg-white p-5 rounded-xl border border-slate-200/80 shadow-sm flex flex-col justify-between gap-4">
                <div>
                    <h3 class="text-xs font-bold text-slate-800 uppercase tracking-wider mb-4 flex items-center gap-2">
                        <i class="fa-solid fa-calculator text-emerald-500"></i> CONCILIACIÓN DE EFECTIVO
                    </h3>
                    <div class="grid grid-cols-2 gap-4">
                        <div>
                            <label class="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">FISICO EN BS</label>
                            <input type="number" id="fisico-bs" placeholder="0.00" class="w-full font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500">
                        </div>
                        <div>
                            <label class="block text-[11px] font-bold text-slate-400 uppercase mb-1.5">FISICO EN USD</label>
                            <input type="number" id="fisico-usd" placeholder="0.00" class="w-full font-mono text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:border-emerald-500">
                        </div>
                    </div>
                </div>
                <button onclick="guardarConciliacion()" class="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-sm active:scale-[0.99]">
                    <i class="fa-solid fa-floppy-disk"></i> GUARDAR CONCILIACIÓN
                </button>
            </div>`;
        }

        bottomGrid.innerHTML = conciliacionHTML + `
        <div class="lg:col-span-7 bg-blue-700 text-white p-5 rounded-xl shadow-sm flex flex-col justify-between gap-4">
            <div>
                <h3 class="text-xs font-bold uppercase tracking-wider mb-4 opacity-90">RESUMEN TOTAL DE COMISIONES (Tasa Euro BCV: ${Number(tasaEuroDelDia).toFixed(2)})</h3>
                <div class="grid grid-cols-2 gap-4 border-b border-blue-600/60 pb-4">
                    <div>
                        <p class="text-[10px] uppercase font-bold tracking-wider opacity-75 mb-1">VENDEDORES</p>
                        <p class="text-lg font-bold font-mono">Bs ${totalComiVendBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p>
                        <p class="text-xs opacity-75 font-mono">$${totalComiVendUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                        <p class="text-[10px] uppercase font-bold tracking-wider opacity-75 mb-1">MOTORIZADOS</p>
                        <p class="text-lg font-bold font-mono">Bs ${totalComiMotBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p>
                        <p class="text-xs opacity-75 font-mono">$${totalComiMotUsd.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                    </div>
                </div>
            </div>
            <div class="flex items-center justify-between pt-2">
                <span class="text-xs font-bold uppercase tracking-wider opacity-90">IMPACTO TOTAL</span>
                <div class="text-right">
                    <p class="text-xl font-bold font-mono text-white">Bs ${(totalComiVendBs + totalComiMotBs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p>
                    <p class="text-xs opacity-85 font-mono text-blue-200">$${(totalComiVendUsd + totalComiMotUsd).toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                </div>
            </div>
        </div>`;
    }

    const btnFinalize = document.querySelector('.btn-finalize');
    if (btnFinalize) {
        btnFinalize.style.display = yaCerrado ? 'none' : 'inline-flex';
    }

    if (!skipFiltros) renderFiltros(orders);

    setTimeout(() => {
        if (!yaCerrado) {
            if (document.getElementById("fisico-bs")) document.getElementById("fisico-bs").value = totalesHoy.bs || 0;
            if (document.getElementById("fisico-usd")) document.getElementById("fisico-usd").value = totalesHoy.usd || 0;
        }
    }, 200);
}

async function loadTotalsForToday() {
    let bsTotal = 0, usdTotal = 0, ordersCount = 0;
    const today = new Date();
    ordenesDia = [];

    try {
        await consultarTasaEuro();
        await precargarUsuariosEnCache();

        const ordersRef = collection(db, 'orders');
        const q = query(ordersRef, where('paymentStatus', '==', 'pagado'));
        const snap = await getDocs(q);

        snap.forEach(doc => {
            const data = doc.data ? doc.data() : doc;
            const paymentDateRaw = data.paymentUpdatedAt ?? data.orderDate ?? null;
            const paymentDate = isoDateFromValue(paymentDateRaw);

            // FILTRADO ESTRICTO EXCLUSIVO PARA EL DÍA EN CURSO (RESUMEN)
            if (!isSameIsoDay(paymentDate, today)) return;

            const payment = data.payment ?? {}, methods = payment.methods || [];
            let sumInThisOrder = false;
            
            if (Array.isArray(methods) && methods.length > 0) {
                methods.forEach(method => {
                    const conv = method.conversion ?? {};
                    const currencyRaw = (conv.currency || method.currency || '').toString().trim().toLowerCase();
                    const currency = (currencyRaw === 'bs' || currencyRaw === 'ves' || currencyRaw === 'bolivar' || currencyRaw === 'bolívares') ? 'BS'
                        : (currencyRaw === 'usd' || currencyRaw === 'dolar' || currencyRaw === 'dólar') ? 'USD' : (currencyRaw || '').toUpperCase();
                    
                    if (currency === 'USD') {
                        const usd = Number(conv.originalAmount ?? conv.usdEquivalent ?? method.originalAmount ?? 0);
                        if (!isNaN(usd)) usdTotal += usd;
                        if (usd > 0) sumInThisOrder = true;
                    } else if (currency === 'BS') {
                        const bs = Number(method.bsAmount ?? conv.bsAmount ?? (conv.originalAmount && conv.rate ? conv.originalAmount * Number(conv.rate) : 0));
                        if (!isNaN(bs)) bsTotal += bs;
                        if (bs > 0) sumInThisOrder = true;
                    }
                });
                if (sumInThisOrder) ordersCount++;
                ordenesDia.push({ ...data, id: doc.id });
            }
        });

        totalesHoy.bs = bsTotal;
        totalesHoy.usd = usdTotal;

        if (elTotalBs) elTotalBs.textContent = formatBs(bsTotal);
        if (elTotalUsd) elTotalUsd.textContent = formatUsd(usdTotal);
        if (elTotalOrders) elTotalOrders.textContent = String(ordersCount);

        const headerDateRow = document.getElementById('header-date-row');
        if (headerDateRow) {
            const dias = ['DOMINGO', 'LUNES', 'MARTES', 'MIÉRCOLES', 'JUEVES', 'VIERNES', 'SÁBADO'];
            const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
            const actual = new Date();
            const fechaFormateada = `${dias[actual.getDay()]}, ${actual.getDate()} DE ${meses[actual.getMonth()]} DE ${actual.getFullYear()}`;
            headerDateRow.innerHTML = `
                <span class="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2"><i class="fa-regular fa-calendar-days text-slate-400"></i> ${fechaFormateada}</span>
                <span class="px-2.5 py-0.5 text-[11px] font-bold bg-slate-200 text-slate-700 rounded-md">${ordersCount} PEDIDO${ordersCount === 1 ? '' : 'S'}</span>
            `;
        }

        await renderOrders(ordenesDia);

    } catch (err) {
        console.error('Error cargando totales de cierre de caja:', err);
        showToast('Error cargando totales.');
    }
}

window.guardarConciliacion = async function () {
    const yaCerrado = ordenesDia.some(ord => ord.cierreCaja && ord.cierreCaja.fecha);
    if (yaCerrado) return showAlertModal("La caja ya ha sido conciliada para estas órdenes.");

    const fisicoBs = Number(document.getElementById("fisico-bs")?.value) || 0;
    const fisicoUsd = Number(document.getElementById("fisico-usd")?.value) || 0;
    const totalBs = totalesHoy.bs;
    const totalUsd = totalesHoy.usd;

    try {
        const conciliacionData = {
            fisicoBs, fisicoUsd, totalBs, totalUsd,
            diferenciaBs: fisicoBs - totalBs, diferenciaUsd: fisicoUsd - totalUsd,
            usuario: currentUserEmail,
            fecha: serverTimestamp(),
            ordenes: ordenesDia.map(o => o.id),
            tasaEuroAplicada: tasaEuroDelDia
        };
        const colRef = collection(db, 'conciliaciones');
        const res = await addDoc(colRef, conciliacionData);

        const batch = writeBatch(db);
        ordenesDia.forEach((order) => {
            batch.update(doc(db, 'orders', order.id), {
                cierreCaja: { fecha: serverTimestamp(), conciliadoPor: currentUserEmail, conciliacionId: res.id }
            });
        });
        await batch.commit();
        showAlertModal('¡Conciliación guardada correctamente!', () => window.location.reload());
    } catch (err) {
        showAlertModal('¡ERROR al guardar conciliación! ' + err);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.querySelector('.btn-finalize');
    if (btn) {
        btn.addEventListener('click', async () => {
            showAlertModal('¿Confirmar cierre y finalizar caja del día?', async () => {
                try {
                    const batch = writeBatch(db);
                    ordenesDia.forEach((order) => {
                        batch.update(doc(db, 'orders', order.id), {
                            cierreCaja: { fecha: serverTimestamp(), finalizadoPor: currentUserEmail }
                        });
                    });
                    await batch.commit();
                    showAlertModal("¡Caja del día finalizada!", () => window.location.reload());
                } catch (e) {
                    showAlertModal("Error finalizando caja: " + e.message);
                }
            });
        });
    }
});

// ------------- FILTROS -----------
function renderFiltros(ordenes) {
    let vendedores = [...new Set(ordenes.map(o => resolveAgent(o, 'vendedor')).filter(Boolean))];
    let motorizados = [...new Set(ordenes.map(o => resolveAgent(o, 'motorizado')).filter(Boolean))];
    let pagos = [];
    ordenes.forEach(o => (o.payment?.methods || []).forEach(m => {
        let label = m.method === "cash" && ((m.conversion?.currency || m.currency || '').toLowerCase().includes('usd')) ? "Efectivo USD"
            : m.method === "cash" && ((m.conversion?.currency || m.currency || '').toLowerCase().includes('bs')) ? "Efectivo BS"
            : m.method === 'mobile' ? "Pago Móvil" : m.method;
        if (!pagos.includes(label)) pagos.push(label);
    }));

    const selectV = document.getElementById('filter-vendedor');
    if (selectV) selectV.innerHTML = `<option value="">Vendedores (Todos)</option>` + vendedores.map(v => `<option value="${v}">${v}</option>`).join('');
    const selectM = document.getElementById('filter-motorizado');
    if (selectM) selectM.innerHTML = `<option value="">Motorizados (Todos)</option>` + motorizados.map(m => `<option value="${m}">${m}</option>`).join('');
    const selectP = document.getElementById('filter-pago');
    if (selectP) selectP.innerHTML = `<option value="">Forma de Pago (Todas)</option>` + pagos.map(p => `<option value="${p}">${p}</option>`).join('');
}

window.filterOrders = function () {
    const q = document.getElementById('search-input')?.value?.toLowerCase() || '';
    const v = document.getElementById('filter-vendedor')?.value || '';
    const m = document.getElementById('filter-motorizado')?.value || '';
    const mp = document.getElementById('filter-pago')?.value || '';

    let filtered = ordenesDia.filter(ord => {
        if (v && resolveAgent(ord, 'vendedor') !== v) return false;
        if (m && resolveAgent(ord, 'motorizado') !== m) return false;
        if (mp) {
            let found = false;
            (ord.payment?.methods || []).forEach(method => {
                let label = method.method === "cash" && ((method.conversion?.currency || method.currency || '').toLowerCase().includes('usd')) ? "Efectivo USD"
                    : method.method === "cash" && ((method.conversion?.currency || method.currency || '').toLowerCase().includes('bs')) ? "Efectivo BS"
                    : method.method === 'mobile' ? "Pago Móvil" : method.method;
                if (label === mp) found = true;
            });
            if (!found) return false;
        }
        const text = JSON.stringify(ord).toLowerCase();
        if (q && !text.includes(q)) return false;
        return true;
    });
    renderOrders(filtered, true);
}
window.clearFilters = function () {
    if(document.getElementById('search-input')) document.getElementById('search-input').value = '';
    if(document.getElementById('filter-vendedor')) document.getElementById('filter-vendedor').selectedIndex = 0;
    if(document.getElementById('filter-motorizado')) document.getElementById('filter-motorizado').selectedIndex = 0;
    if(document.getElementById('filter-pago')) document.getElementById('filter-pago').selectedIndex = 0;
    renderOrders(ordenesDia, true);
}

// ------------- CALENDARIO DE AUDITORÍA CON SELECCIÓN MÚLTIPLE (DÍAS / SEMANAS) -----------
function pad2(n) { return n < 10 ? '0' + n : '' + n; }

async function getCierresCajaForMonth(year, month) {
    const ini = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const fin = new Date(year, month, 0, 23, 59, 59, 999);
    let dias = {};
    try {
        const q = query(collection(db, "conciliaciones"));
        const snap = await getDocs(q);
        snap.forEach(doc => {
            const data = doc.data();
            let fechaTs = data.fecha;
            let fecha = null;
            if (fechaTs && typeof fechaTs.toDate === "function") fecha = fechaTs.toDate();
            else if (fechaTs && fechaTs.seconds) fecha = new Date(fechaTs.seconds * 1000);
            else if (typeof fechaTs === "string") fecha = new Date(fechaTs);
            if (!fecha || fecha < ini || fecha > fin) return;
            const key = fecha.toISOString().slice(0, 10);
            dias[key] = { id: doc.id, ...data, fecha };
        });
        return dias;
    } catch (e) {
        console.error("Error leyendo conciliaciones:", e);
        return {};
    }
}

async function renderCalendar(month, year, cierresDelMes, onDayClick, selectedKeysSet) {
    const grid = document.getElementById("calendar-grid");
    const label = document.getElementById("calendar-month-label");
    
    const headerHTML = `<div class="grid grid-cols-7 gap-1.5 text-[10px] font-bold text-slate-400 mb-2">
        <span>D</span><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span>
    </div>`;
    
    const meses = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    if (label) label.textContent = `${meses[month - 1]} ${year}`;
    
    const firstDay = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();
    
    let daysHTML = `<div class="grid grid-cols-7 gap-1.5">`;
    
    for (let d = 0; d < firstDay; d++) daysHTML += `<span></span>`;
    
    for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${pad2(month)}-${pad2(d)}`;
        const cerrado = cierresDelMes[key] ? true : false;
        const isSelected = selectedKeysSet.has(key);
        
        let cls = "h-8 flex items-center justify-center rounded-lg text-xs font-semibold cursor-pointer transition-all ";
        if(isSelected) {
            cls += "bg-blue-600 text-white shadow-md scale-105 font-bold";
        } else if (cerrado) {
            cls += "text-emerald-600 hover:bg-emerald-50";
        } else {
            cls += "text-red-400 hover:bg-red-50";
        }

        daysHTML += `<div class="${cls}" data-date="${key}">${d}</div>`;
    }
    daysHTML += `</div>`;
    
    grid.innerHTML = headerHTML + daysHTML;

    grid.querySelectorAll("[data-date]").forEach(dayDiv => {
        dayDiv.onclick = () => onDayClick(dayDiv.dataset.date);
    });
}

// Obtención masiva optimizada para soportar múltiples días seleccionados
async function getOrdersForMultipleDays(fechasArray) {
    if (fechasArray.length === 0) return [];
    try {
        const q = query(collection(db, 'orders'), where('paymentStatus', '==', 'pagado'));
        const snap = await getDocs(q);
        let lista = [];
        
        snap.forEach(doc => {
            const data = doc.data ? doc.data() : doc;
            const orderDateRaw = data.orderDate ?? data.createdAt ?? null;
            const dateObj = isoDateFromValue(orderDateRaw);
            
            if (dateObj) {
                const ordenKey = dateObj.toISOString().slice(0, 10);
                if (fechasArray.includes(ordenKey)) {
                    lista.push({ ...data, id: doc.id });
                }
            }
        });
        return lista;
    } catch (e) {
        console.error("Error obteniendo órdenes para múltiples días", e);
        return [];
    }
}

async function renderAuditDaysAcumulado(fechasSet, cierresDelMes, orders) {
    const titleEl = document.getElementById("selectedDateTitle");
    const pill = document.getElementById("statusPill");
    
    if (fechasSet.size === 0) {
        if (titleEl) titleEl.textContent = "Sin selección";
        if (pill) pill.innerHTML = '<span class="px-2.5 py-0.5 bg-slate-200 text-slate-500 text-[10px] font-bold rounded-full uppercase tracking-wide">● SELECCIONE DÍAS</span>';
        return;
    }

    // Título dinámico para auditoría (un día vs rango de fechas)
    if (fechasSet.size === 1) {
        const [unicaFecha] = fechasSet;
        const parts = unicaFecha.split('-');
        const d = new Date(parts[0], parts[1] - 1, parts[2]);
        const diasSemana = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        if (titleEl) titleEl.textContent = `${diasSemana[d.getDay()]} ${d.getDate()}/${parts[1]}/${parts[0]}`;
    } else {
        if (titleEl) titleEl.textContent = `Rango Seleccionado (${fechasSet.size} días)`;
    }

    // Comprobamos si todos los días seleccionados están cerrados
    const todosCerrados = Array.from(fechasSet).every(f => cierresDelMes[f]);
    if (pill) {
        if (todosCerrados) {
            pill.innerHTML = '<span class="px-2.5 py-0.5 bg-emerald-50 border border-emerald-100 text-emerald-700 text-[10px] font-bold rounded-full uppercase tracking-wide">● Período Conciliado</span>';
        } else {
            pill.innerHTML = '<span class="px-2.5 py-0.5 bg-amber-50 border border-amber-100 text-amber-700 text-[10px] font-bold rounded-full uppercase tracking-wide">● Cierres Pendientes detectados</span>';
        }
    }

    let vendedores = {}, motorizados = {};
    let totalV_bs = 0, totalV_usd = 0, totalM_bs = 0, totalM_usd = 0;

    for (const ord of orders) {
        const orderDateRaw = ord.orderDate ?? ord.createdAt ?? null;
        const dateObj = isoDateFromValue(orderDateRaw);
        const ordenKey = dateObj ? dateObj.toISOString().slice(0, 10) : '';
        
        // Cada orden usa la tasa histórica del día en que se guardó su conciliación, o la del día de hoy en su defecto.
        const tasaAplicadaDeLaOrden = cierresDelMes[ordenKey]?.tasaEuroAplicada || tasaEuroDelDia;

        // Vendedores
        const vendedor = resolveAgent(ord, 'vendedor');
        if (vendedor && vendedor.length > 1) {
            const rawConfig = getUserCommissionInfoFromCache(vendedor);
            const orderTotals = getOrderTotalInBsAndUsd((ord.payment && ord.payment.methods) || []);
            const vendedorInfo = resolverEstructuraComision(rawConfig, orderTotals, tasaAplicadaDeLaOrden);

            if (!vendedores[vendedor]) vendedores[vendedor] = { count: 0, comisionBs: 0, comisionUsd: 0 };
            vendedores[vendedor].count += 1;
            vendedores[vendedor].comisionBs += vendedorInfo.comisionBs;
            vendedores[vendedor].comisionUsd += vendedorInfo.comisionUsd;
            totalV_bs += vendedorInfo.comisionBs;
            totalV_usd += vendedorInfo.comisionUsd;
        }

        // Motorizados
        const motorizado = resolveAgent(ord, 'motorizado');
        if (motorizado && motorizado.length > 1) {
            const rawConfig = getUserCommissionInfoFromCache(motorizado);
            const orderTotals = getOrderTotalInBsAndUsd((ord.payment && ord.payment.methods) || []);
            const motorizadoInfo = resolverEstructuraComision(rawConfig, orderTotals, tasaAplicadaDeLaOrden);

            if (!motorizados[motorizado]) motorizados[motorizado] = { count: 0, comisionBs: 0, comisionUsd: 0 };
            motorizados[motorizado].count += 1;
            motorizados[motorizado].comisionBs += motorizadoInfo.comisionBs;
            motorizados[motorizado].comisionUsd += motorizadoInfo.comisionUsd;
            totalM_bs += motorizadoInfo.comisionBs;
            totalM_usd += motorizadoInfo.comisionUsd;
        }
    }

    const listDiv = document.getElementById("audit-orders-list");
    let html = '';
    
    if (Object.keys(vendedores).length > 0) {
        html += `<h3 class="text-xs font-bold text-blue-600 uppercase tracking-wider flex items-center gap-2 mt-4 mb-2"><i class="fa-solid fa-user text-[11px]"></i> Vendedores</h3><div class="space-y-2">`;
        for (const vName in vendedores) {
            const v = vendedores[vName];
            html += `
            <div class="flex items-center justify-between p-3 border border-slate-100 rounded-xl text-xs bg-white hover:bg-slate-50/50 transition-colors">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 bg-blue-50 text-blue-500 rounded-lg flex items-center justify-center text-sm"><i class="fa-solid fa-user"></i></div>
                    <div>
                        <p class="font-bold text-slate-800">${vName} <span class="text-slate-400 font-normal text-[11px] ml-1">• Vendedor</span></p>
                        <p class="text-[10px] text-blue-600 font-semibold uppercase tracking-wider mt-0.5">PEDIDOS TOTALES: ${v.count}</p>
                    </div>
                </div>
                <div class="text-right bg-purple-50/60 border border-purple-100 px-3 py-1 rounded-lg">
                    <p class="text-[9px] font-bold text-purple-400 uppercase tracking-wider">Acumulado</p>
                    <p class="font-bold text-purple-700 font-mono">Bs ${v.comisionBs.toLocaleString('es-VE', {minimumFractionDigits:2})} / $ ${v.comisionUsd.toLocaleString('en-US', {minimumFractionDigits:2})}</p>
                </div>
            </div>`;
        }
        html += `</div>`;
    }

    if (Object.keys(motorizados).length > 0) {
        html += `<h3 class="text-xs font-bold text-emerald-600 uppercase tracking-wider flex items-center gap-2 mt-4 mb-2"><i class="fa-solid fa-motorcycle text-[11px]"></i> Motorizados</h3><div class="space-y-2">`;
        for (const mName in motorizados) {
            const m = motorizados[mName];
            html += `
            <div class="flex items-center justify-between p-3 border border-slate-100 rounded-xl text-xs bg-white hover:bg-slate-50/50 transition-colors">
                <div class="flex items-center gap-3">
                    <div class="w-8 h-8 bg-emerald-50 text-emerald-500 rounded-lg flex items-center justify-center text-sm"><i class="fa-solid fa-motorcycle"></i></div>
                    <div>
                        <p class="font-bold text-slate-800">${mName} <span class="text-slate-400 font-normal text-[11px] ml-1">• Motorizado</span></p>
                        <p class="text-[10px] text-emerald-600 font-semibold uppercase tracking-wider mt-0.5">PEDIDOS TOTALES: ${m.count}</p>
                    </div>
                </div>
                <div class="text-right bg-emerald-50/60 border border-emerald-100 px-3 py-1 rounded-lg">
                    <p class="text-[9px] font-bold text-emerald-400 uppercase tracking-wider">Acumulado</p>
                    <p class="font-bold text-emerald-700 font-mono">Bs ${m.comisionBs.toLocaleString('es-VE', {minimumFractionDigits:2})} / $ ${m.comisionUsd.toLocaleString('en-US', {minimumFractionDigits:2})}</p>
                </div>
            </div>`;
        }
        html += `</div>`;
    }

    if (!Object.keys(vendedores).length && !Object.keys(motorizados).length) {
        html = `<div class="p-4 text-center text-slate-400 border border-slate-100 rounded-xl">No hay información de comisiones en los días seleccionados.</div>`;
    }
    
    if (listDiv) listDiv.innerHTML = html;

    const summaryDiv = document.getElementById("audit-summary-row");
    if (summaryDiv) {
        summaryDiv.innerHTML = `
        <div class="bg-slate-50 border border-slate-200/60 p-3.5 rounded-xl shadow-sm">
            <p class="text-xs font-bold text-slate-500 flex items-center gap-1.5"><i class="fa-solid fa-user text-[10px] text-slate-400"></i> Total Vendedores</p>
            <p class="text-sm font-bold text-slate-800 font-mono mt-1">Bs ${totalV_bs.toLocaleString('es-VE', {minimumFractionDigits:2})}</p>
            <p class="text-xs font-medium text-slate-400 font-mono">$${totalV_usd.toLocaleString('en-US', {minimumFractionDigits:2})}</p>
        </div>
        <div class="bg-slate-50 border border-slate-200/60 p-3.5 rounded-xl shadow-sm">
            <p class="text-xs font-bold text-slate-500 flex items-center gap-1.5"><i class="fa-solid fa-motorcycle text-[10px] text-slate-400"></i> Total Motorizados</p>
            <p class="text-sm font-bold text-slate-800 font-mono mt-1">Bs ${totalM_bs.toLocaleString('es-VE', {minimumFractionDigits:2})}</p>
            <p class="text-xs font-medium text-slate-400 font-mono">$${totalM_usd.toLocaleString('en-US', {minimumFractionDigits:2})}</p>
        </div>`;
    }

    let totalBs = totalV_bs + totalM_bs, totalUsd = totalV_usd + totalM_usd;
    const footerDiv = document.getElementById("audit-dark-footer");
    if (footerDiv) {
        footerDiv.innerHTML = `
        <div class="bg-slate-900 text-white p-5 rounded-xl flex justify-between items-center relative overflow-hidden shadow-md mt-6">
            <div class="z-10">
                <p class="text-[11px] opacity-60 font-semibold uppercase tracking-wider mb-0.5">Suma total de comisiones del período</p>
                <p class="text-2xl font-mono font-bold text-blue-400">Bs ${totalBs.toLocaleString('es-VE', {minimumFractionDigits:2})}</p>
            </div>
            <div class="text-right z-10">
                <p class="text-3xl font-mono font-bold text-emerald-400">$${totalUsd.toLocaleString('en-US', {minimumFractionDigits:2})}</p>
                <p class="text-[10px] opacity-50 uppercase tracking-widest mt-1">Impacto total acumulado</p>
            </div>
        </div>`;
    }
}

function calendarioInit() {
    const ahora = new Date();
    let stateMonth = ahora.getMonth() + 1;
    let stateYear = ahora.getFullYear();
    
    // --- NUEVO MANEJO DE SELECCIÓN MÚLTIPLE DE DÍAS ---
    let stateSelectedSet = new Set(); 
    let cierresMes = {};

    async function renderMainCalendar() {
        cierresMes = await getCierresCajaForMonth(stateYear, stateMonth);
        stateSelectedSet.clear(); // Limpiamos al cambiar de mes
        await renderCalendar(stateMonth, stateYear, cierresMes, onDayClick, stateSelectedSet);

        if (document.getElementById("selectedDateTitle")) document.getElementById("selectedDateTitle").textContent = "Sin selección";
        if (document.getElementById("statusPill")) document.getElementById("statusPill").innerHTML = '<span class="px-2.5 py-0.5 bg-slate-200 text-slate-500 text-[10px] font-bold rounded-full uppercase tracking-wide">● SELECCIONE UN DÍA</span>';
        if (document.getElementById("audit-orders-list")) document.getElementById("audit-orders-list").innerHTML = "";
        if (document.getElementById("audit-summary-row")) document.getElementById("audit-summary-row").innerHTML = "";
        if (document.getElementById("audit-dark-footer")) document.getElementById("audit-dark-footer").innerHTML = "";
    }

    async function onDayClick(fechaIso) {
        if (stateSelectedSet.has(fechaIso)) {
            stateSelectedSet.delete(fechaIso); // Si ya estaba seleccionado, se deselecciona
        } else {
            stateSelectedSet.add(fechaIso); // Si no estaba, se agrega
        }
        
        await renderCalendar(stateMonth, stateYear, cierresMes, onDayClick, stateSelectedSet);
        
        const arrayFechas = Array.from(stateSelectedSet);
        const orders = await getOrdersForMultipleDays(arrayFechas);
        await renderAuditDaysAcumulado(stateSelectedSet, cierresMes, orders);
    }

    setTimeout(() => {
        const prev = document.getElementById("prev-month");
        const next = document.getElementById("next-month");
        if (prev) prev.onclick = async () => {
            stateMonth -= 1; if (stateMonth < 1) { stateMonth = 12; stateYear--; }
            await renderMainCalendar();
        };
        if (next) next.onclick = async () => {
            stateMonth += 1; if (stateMonth > 12) { stateMonth = 1; stateYear++; }
            await renderMainCalendar();
        };
    }, 200);

    renderMainCalendar();
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadTotalsForToday();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) loadTotalsForToday();
    });
    calendarioInit();
});
