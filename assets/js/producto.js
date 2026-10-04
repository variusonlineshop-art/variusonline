import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import { getStorage, ref as storageRef, getDownloadURL } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

const CART_COOKIE = 'mi_tienda_cart_v1';
let CART = null;

function getCookieJSON(name) {
    const cookies = document.cookie ? document.cookie.split('; ') : [];
    for (const c of cookies) {
        const [k, v] = c.split('=');
        if (decodeURIComponent(k) === name) {
            try { return JSON.parse(decodeURIComponent(v)); } catch (err) { return null; }
        }
    }
    return null;
}

function setCookieJSON(name, value, days = 14) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(JSON.stringify(value))}; expires=${expires}; path=/; samesite=strict`;
}

function loadCart() {
    CART = getCookieJSON(CART_COOKIE) || { cartToken: crypto.randomUUID(), items: [], total: 0 };
    updateCartBadge();
}

function updateCartBadge() {
    const el = document.getElementById('cartCount');
    if (el) el.textContent = CART.items.reduce((s, i) => s + i.quantity, 0);
}

function formatCurrency(num) {
    if (num === null || num === undefined || num === '') return '';
    return `€${Number(num).toFixed(2)}`;
}

// Búsqueda y resolución de imágenes en Storage o URLs directas
const _resolvedImageCache = new Map();
async function resolveImagePath(pathOrUrl) {
    if (!pathOrUrl) return null;
    if (_resolvedImageCache.has(pathOrUrl)) return _resolvedImageCache.get(pathOrUrl);
    if (/^https?:\/\//i.test(pathOrUrl)) { _resolvedImageCache.set(pathOrUrl, pathOrUrl); return pathOrUrl; }
    try {
        const ref = storageRef(storage, pathOrUrl);
        const url = await getDownloadURL(ref);
        _resolvedImageCache.set(pathOrUrl, url);
        return url;
    } catch (err) {
        _resolvedImageCache.set(pathOrUrl, null);
        return null;
    }
}

// Pool de reseñas aleatorias para la tarjeta destacada
const REVIEWS_POOL = [
    { name: "María G.", city: "Caracas", avatar: "https://i.pravatar.cc/100?img=5", text: "Pensé que tendría que buscar otra opción pero funcionó excelente. La atención fue excelente." },
    { name: "Carlos R.", city: "Valencia", avatar: "https://i.pravatar.cc/100?img=12", text: "Súper recomendado. La entrega en Valencia fue el mismo día y todo llegó impecable." },
    { name: "Valeria M.", city: "Maracay", avatar: "https://i.pravatar.cc/100?img=9", text: "Excelente relación precio-calidad. Cumple totalmente con lo que prometen en la descripción." }
];

async function loadProductDetail() {
    const params = new URLSearchParams(window.location.search);
    const productId = params.get('id');
    const container = document.getElementById('productDetailContainer');

    if (!productId) {
        container.innerHTML = '<div class="col-span-full text-center text-slate-400 py-12">Producto no especificado.</div>';
        return;
    }

    try {
        const docRef = doc(db, 'product', productId);
        const snap = await getDoc(docRef);

        if (!snap.exists()) {
            container.innerHTML = '<div class="col-span-full text-center text-slate-400 py-12">El producto solicitado no existe.</div>';
            return;
        }

        const p = snap.data();
        const basePrice = Number(p.price) || 0;

        // Comprobación de si el producto realmente tiene ofertas en Firestore
        const hasOffer = (p.isOffer === "on" || p.isOffer === true) && Array.isArray(p.discounts) && p.discounts.length > 0;

        let offers = [];
        if (hasOffer) {
            // Mapeo dinámico de ofertas según el arreglo "discounts" del documento
            offers = [
                { id: '1', title: 'LLEVA 1 UNIDAD', qty: 1, price: basePrice, badge: null },
                ...p.discounts.map((d, index) => {
                    // Extraer cantidad de la oferta o asumir (index + 2)
                    const qtyMatch = d.title ? d.title.match(/\d+/) : null;
                    const qty = qtyMatch ? parseInt(qtyMatch[0]) : (index + 2);
                    const discountPerc = Number(d.percentage) || 0;
                    const calculatedPrice = (basePrice * qty) * (1 - discountPerc / 100);

                    let badge = null;
                    if (index === 0) badge = '🏆 LA OPCIÓN FAVORITA';
                    else if (index === p.discounts.length - 1) badge = '🎁 EL DESCUENTO MÁXIMO';

                    return {
                        id: String(index + 2),
                        title: `${(d.title || `LLEVA ${qty}`).toUpperCase()} CON ${discountPerc}% DE DESCUENTO`,
                        qty: qty,
                        price: calculatedPrice,
                        badge: badge
                    };
                })
            ];
        }

        let selectedOffer = offers.length > 0 ? offers[0] : null;

        // Extraer y resolver URLs de imágenes
        const rawImages = Array.isArray(p.imageUrls) && p.imageUrls.length ? p.imageUrls
            : (p.imageUrl ? [p.imageUrl] : (p.image ? [p.image] : []));

        const images = (await Promise.all(rawImages.map(resolveImagePath))).filter(Boolean);
        const mainImg = images[0] || 'https://via.placeholder.com/600';

        // Selección de reseña aleatoria
        const randomReview = REVIEWS_POOL[Math.floor(Math.random() * REVIEWS_POOL.length)];

        container.innerHTML = `
            <!-- COLUMNA IZQUIERDA: Fotos, Banner y Tarjeta de Descripción -->
            <div class="lg:col-span-7 flex flex-col gap-6">
                
                <!-- 1. Imagen Principal -->
                <div class="w-full aspect-square sm:aspect-[4/3] bg-white rounded-3xl overflow-hidden border border-slate-100 shadow-sm flex items-center justify-center p-4">
                    <img id="mainProductImg" src="${mainImg}" alt="${p.name}" class="max-h-full max-w-full object-contain rounded-2xl">
                </div>

                <!-- 2. Miniaturas Debajo de la Imagen Principal (RESTURADAS) -->
                ${images.length > 1 ? `
                    <div class="flex gap-3 overflow-x-auto no-scrollbar pb-1">
                        ${images.map((img) => `
                            <button onclick="window.setMainImage('${img}')" class="w-20 h-20 flex-shrink-0 bg-white rounded-2xl border-2 border-slate-100 hover:border-red-500 overflow-hidden transition-all focus:outline-none">
                                <img src="${img}" class="w-full h-full object-cover">
                            </button>
                        `).join('')}
                    </div>
                ` : ''}

                <!-- 3. Banner de Garantía y Entregas -->
                <div class="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex items-center justify-around text-center divide-x divide-slate-100">
                    <div class="flex-1 px-2 flex flex-col items-center">
                        <div class="text-red-500 text-lg mb-1">🛡️</div>
                        <span class="text-[11px] text-slate-500 font-medium leading-tight">Garantía total por</span>
                        <strong class="text-xs text-red-600 font-bold">30 días</strong>
                    </div>

                    <div class="flex-1 px-2 flex flex-col items-center">
                        <div class="text-red-500 text-lg mb-1">📍</div>
                        <span class="text-[11px] text-slate-500 font-medium leading-tight">Entregas personales en</span>
                        <strong class="text-xs text-red-600 font-bold">Valencia</strong>
                    </div>

                    <div class="flex-1 px-2 flex flex-col items-center">
                        <div class="text-red-500 text-lg mb-1">💬</div>
                        <span class="text-[11px] text-slate-500 font-medium leading-tight">Atención por</span>
                        <strong class="text-xs text-red-600 font-bold">WhatsApp 24/7</strong>
                    </div>
                </div>

                <!-- 4. TARJETA DE TÍTULO Y DESCRIPCIÓN EXTENSA -->
                <div class="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col items-center text-center">
                    <h1 class="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight uppercase mb-3">
                        ${p.name}
                    </h1>
                    
                    <div class="w-20 h-1 bg-red-500 rounded-full mb-6"></div>

                    <div class="text-slate-600 text-xs sm:text-sm leading-relaxed whitespace-pre-line text-center max-w-2xl font-medium">
                        ${p.description || 'Sin descripción disponible.'}
                    </div>
                </div>

            </div>

            <!-- COLUMNA DERECHA: Tarjeta de Compra -->
            <div class="lg:col-span-5 flex flex-col gap-4">
                
                <!-- Encabezado de Valoraciones -->
                <div class="text-center mb-1">
                    <div class="text-amber-400 text-sm font-bold tracking-wide">
                        ★★★★★ <span class="text-slate-700 text-xs font-semibold ml-1">627 reseñas • 7864 ventas</span>
                    </div>
                    <div class="text-xs font-bold text-red-600 mt-0.5">+185 unidades vendidas esta semana</div>
                </div>

                <!-- Tarjeta Principal del Producto -->
                <div class="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-sm flex flex-col gap-5">
                    
                    <div>
                        <h2 class="text-2xl font-black text-slate-900 tracking-tight text-center uppercase border-b-2 border-red-500 pb-2 mb-3">
                            ${p.name}
                        </h2>
                        ${!hasOffer ? `
                            <div class="text-center my-2">
                                <span class="text-3xl font-black text-slate-900">${formatCurrency(basePrice)}</span>
                            </div>
                        ` : ''}
                        <p class="text-xs font-semibold text-slate-500 text-center leading-relaxed">
                            ${(p.description || '').slice(0, 100)}${(p.description || '').length > 100 ? '...' : ''}
                        </p>
                    </div>

                    <!-- Lista de Puntos Clave -->
                    <ul class="space-y-3 text-xs text-slate-700 font-medium pt-1">
                        <li class="flex items-start gap-2.5">
                            <span class="text-red-500 font-bold text-sm">✓</span>
                            <span><strong>Ataca la mugre más difícil:</strong> remueve suciedad acumulada que otros limpiadores no logran sacar.</span>
                        </li>
                        <li class="flex items-start gap-2.5">
                            <span class="text-red-500 font-bold text-sm">✓</span>
                            <span><strong>Desmancha juntas oscuras:</strong> ayuda a recuperar el aspecto limpio sin pasar horas tallando.</span>
                        </li>
                        <li class="flex items-start gap-2.5">
                            <span class="text-red-500 font-bold text-sm">✓</span>
                            <span><strong>Tu espacio vuelve a lucir limpio:</strong> sentirás la satisfacción de ver tus ambientes renovados.</span>
                        </li>
                    </ul>

                    <!-- BLOQUE DE OFERTAS DIVERSAS (SÓLO SI EXISTEN OFERTAS ACTIVAS) -->
                    ${hasOffer ? `
                        <div class="space-y-2.5 pt-2">
                            <label class="text-xs font-extrabold text-slate-700 uppercase tracking-wider block text-center mb-1">
                                Selecciona tu oferta preferida:
                            </label>
                            <div id="offersContainer" class="flex flex-col gap-2.5">
                                ${offers.map((offer, idx) => {
                                    const isSelected = idx === 0;
                                    return `
                                        <div data-offer-id="${offer.id}" 
                                             class="offer-card cursor-pointer p-3.5 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 ${isSelected ? 'border-green-600 bg-green-50/60 shadow-sm' : 'border-slate-200 hover:border-slate-300 bg-white'}">
                                            <div class="flex items-center gap-3">
                                                <img src="${mainImg}" class="w-12 h-12 object-cover rounded-xl border border-slate-200 flex-shrink-0">
                                                <div class="flex flex-col">
                                                    <span class="text-xs font-black text-slate-900 leading-snug uppercase">${offer.title}</span>
                                                    ${offer.badge ? `
                                                        <span class="inline-block mt-1 bg-green-700 text-white text-[9px] font-bold px-2 py-0.5 rounded-md w-max">
                                                            ${offer.badge}
                                                        </span>
                                                    ` : ''}
                                                </div>
                                            </div>
                                            <div class="text-right flex-shrink-0">
                                                <span class="text-sm sm:text-base font-black text-slate-900">${formatCurrency(offer.price)}</span>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        </div>
                    ` : ''}

                    <!-- Control de Cantidad y Botón de Carrito -->
                    <div class="space-y-3 pt-1">
                        <div class="flex items-center justify-between bg-slate-50 px-4 py-2 rounded-xl border border-slate-100">
                            <span class="text-xs font-bold text-slate-600">Cantidad:</span>
                            <div class="flex items-center gap-3">
                                <button id="btnDecr" class="w-7 h-7 rounded-lg bg-white shadow-sm border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-100 flex items-center justify-center">-</button>
                                <input id="qtyInput" type="number" value="${selectedOffer ? selectedOffer.qty : 1}" min="1" max="99" class="w-10 text-center text-sm font-bold bg-transparent outline-none">
                                <button id="btnIncr" class="w-7 h-7 rounded-lg bg-white shadow-sm border border-slate-200 text-slate-700 font-bold text-sm hover:bg-slate-100 flex items-center justify-center">+</button>
                            </div>
                        </div>

                        <button id="addToCartBtn" class="w-full bg-cyan-500 hover:bg-cyan-600 text-white font-extrabold py-3.5 rounded-2xl shadow-md transition-all text-sm uppercase tracking-wide flex items-center justify-center gap-2">
                            <span>🛒</span> Agregar al Carrito
                        </button>

                        <!-- NOTA DE ATENCIÓN POR WHATSAPP -->
                        <p class="text-[11px] text-slate-500 font-medium text-center leading-tight pt-1">
                            * Nuestro equipo te atenderá por WhatsApp para finalizar el envío.
                        </p>
                    </div>

                    <!-- Reseña Destacada al Pie -->
                    <div class="border-t border-slate-100 pt-4 mt-1 flex items-start gap-3">
                        <img src="${randomReview.avatar}" alt="${randomReview.name}" class="w-10 h-10 rounded-full object-cover border border-slate-200 flex-shrink-0">
                        <div class="flex-1">
                            <div class="flex items-center justify-between">
                                <h4 class="text-xs font-bold text-red-600">${randomReview.name} | <span class="text-slate-500 font-normal">${randomReview.city}</span></h4>
                                <span class="text-amber-400 text-[10px]">★★★★★</span>
                            </div>
                            <p class="text-[11px] text-slate-600 italic leading-snug mt-1">"${randomReview.text}"</p>
                        </div>
                    </div>

                </div>

            </div>
        `;

        // Lógica para cambiar la imagen principal al dar clic en miniaturas
        window.setMainImage = (url) => {
            const imgEl = document.getElementById('mainProductImg');
            if (imgEl) imgEl.src = url;
        };

        const qtyInput = document.getElementById('qtyInput');

        // Lógica de selección de ofertas si existen
        if (hasOffer) {
            const offerCards = document.querySelectorAll('.offer-card');
            offerCards.forEach(card => {
                card.addEventListener('click', () => {
                    const offerId = card.getAttribute('data-offer-id');
                    selectedOffer = offers.find(o => o.id === offerId) || selectedOffer;

                    // Actualizar estilos de las tarjetas
                    offerCards.forEach(c => {
                        c.classList.remove('border-green-600', 'bg-green-50/60', 'shadow-sm');
                        c.classList.add('border-slate-200', 'bg-white');
                    });
                    card.classList.remove('border-slate-200', 'bg-white');
                    card.classList.add('border-green-600', 'bg-green-50/60', 'shadow-sm');

                    // Sincronizar el campo de cantidad con la oferta elegida
                    if (qtyInput) {
                        qtyInput.value = selectedOffer.qty;
                    }
                });
            });
        }

        // Controles manuales de cantidad (+ / -)
        document.getElementById('btnDecr')?.addEventListener('click', () => {
            qtyInput.value = Math.max(1, parseInt(qtyInput.value || 1) - 1);
        });
        document.getElementById('btnIncr')?.addEventListener('click', () => {
            qtyInput.value = parseInt(qtyInput.value || 1) + 1;
        });

        // Evento Agregar al Carrito
        document.getElementById('addToCartBtn')?.addEventListener('click', () => {
            const qty = parseInt(qtyInput.value || 1);
            const unitPrice = (hasOffer && selectedOffer) ? (selectedOffer.price / selectedOffer.qty) : basePrice;

            const existing = CART.items.find(i => i.productId === productId);

            if (existing) {
                existing.quantity += qty;
            } else {
                CART.items.push({
                    productId,
                    name: (hasOffer && selectedOffer) ? `${p.name} (${selectedOffer.title})` : p.name,
                    price: unitPrice,
                    quantity: qty,
                    image: mainImg
                });
            }

            setCookieJSON(CART_COOKIE, CART, 14);
            updateCartBadge();

            const toast = document.getElementById('toast');
            if (toast) {
                toast.textContent = "Producto agregado al carrito";
                toast.classList.add('show');
                setTimeout(() => toast.classList.remove('show'), 2200);
            }
        });

    } catch (err) {
        console.error("Error al cargar producto:", err);
        container.innerHTML = '<div class="col-span-full text-center text-red-500 py-12">Error al cargar la información del producto.</div>';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    loadCart();
    loadProductDetail();
});