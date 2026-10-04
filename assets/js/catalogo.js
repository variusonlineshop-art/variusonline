// firebase-config e inicialización
import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, query, orderBy
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import {
  getStorage, ref as storageRef, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

/* ------------------- Variables Globales ------------------- */
let PRODUCTS = [];
let PRODUCTS_BY_ID = new Map();
let CURRENT_CATEGORY = "Todos";
let SEARCH_QUERY = "";
let CATALOG_CURRENT_PAGE = 1;
let CATALOG_PAGE_SIZE = 20;

const CART_COOKIE = 'mi_tienda_cart_v1';
let CART = null;

/* ------------------- Helpers Carrito y Cookies ------------------- */
function generateCartToken() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const rnds = crypto.getRandomValues(new Uint8Array(16));
  rnds[6] = (rnds[6] & 0x0f) | 0x40;
  rnds[8] = (rnds[8] & 0x3f) | 0x80;
  const toHex = (b) => b.toString(16).padStart(2, '0');
  const uuid = [...rnds].map(toHex).join('');
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`;
}

function setCookieJSON(name, value, days = 14) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(JSON.stringify(value))}; expires=${expires}; path=/; samesite=strict`;
}

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

function createEmptyCart() {
  return { cartToken: generateCartToken(), items: [], total: 0, timestamp: new Date().toISOString() };
}

function loadCartFromCookie() {
  const c = getCookieJSON(CART_COOKIE);
  if (!c || !c.cartToken || !Array.isArray(c.items)) {
    CART = createEmptyCart();
    persistCart();
  } else {
    CART = c;
    recalcCart();
  }
  renderCartCount();
}

function persistCart() {
  setCookieJSON(CART_COOKIE, CART, 14);
  renderCartCount();
  try { renderCartPanel(); } catch (e) { /* ignore */ }
}

function recalcCart() {
  let total = 0;
  CART.items.forEach(it => {
    it.subtotal = it.quantity * it.price;
    total += it.subtotal;
  });
  CART.total = total;
  CART.timestamp = new Date().toISOString();
}

function renderCartCount() {
  const count = CART.items.reduce((s, i) => s + i.quantity, 0);
  const el = document.getElementById('cartCount');
  if (el) el.textContent = count;
}

/* ------------------- Formato y Detección de Ofertas ------------------- */
function formatCurrency(num) {
  if (num === null || num === undefined || num === '') return '';
  const n = Number(num);
  if (!isFinite(n)) return String(num);
  return `€${n.toFixed(2)}`;
}

function isComboOrOffer(product) {
  const cat = (product.category || '').toLowerCase();
  const name = (product.name || '').toLowerCase();
  const hasDiscount = product.discountPrice && Number(product.discountPrice) < Number(product.price);
  return cat.includes('combo') || cat.includes('promocion') || name.includes('combo') || product.isOnSale || hasDiscount;
}

function isProductVisible(p) {
  if (!p || !p.status) return true;
  const s = String(p.status).toLowerCase().trim();
  if (s === 'suspendido' || s === 'suspended' || s === 'inactivo' || s === 'inactive') return false;
  if (typeof p.stock === 'number' && p.stock <= 0) return false;
  return true;
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

function showToast(msg, ms = 2200) {
  const toastEl = document.getElementById('toast');
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ------------------- Normalización y Storage ------------------- */
function normalizeProduct(docSnap) {
  const data = docSnap.data();
  const price = Number(data.price) || 0;
  let discountPrice = null;

  if (data.discountPrice !== undefined && data.discountPrice !== null && data.discountPrice !== '') {
    const dp = Number(data.discountPrice);
    if (isFinite(dp)) discountPrice = dp;
  }

  const isOnSale = !!(data.onOffer || data.isOnSale || (discountPrice && discountPrice < price));
  const images = Array.isArray(data.imageUrls) && data.imageUrls.length ? data.imageUrls.slice()
    : (data.imageUrl ? [data.imageUrl] : (data.image ? [data.image] : (Array.isArray(data.imagePaths) ? data.imagePaths.slice() : [])));

  // Verificación del campo isNew (booleano o string "true")
  const isNew = data.isNew === true || data.isNew === "true";

  return {
    id: docSnap.id,
    name: data.name || data.title || '',
    price,
    discountPrice: (discountPrice && Number(discountPrice) > 0) ? discountPrice : null,
    isOnSale,
    isNew,
    images,
    image: images && images.length ? images[0] : '',
    description: data.description || '',
    category: data.category || 'General',
    status: data.status || 'Activo',
    stock: (typeof data.stock !== 'undefined') ? Number(data.stock) : null
  };
}

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

async function resolveProductImages(product) {
  if (!product) return [];
  if (product.__resolvedImages) return product.__resolvedImages;
  const imgs = Array.isArray(product.images) ? product.images : (product.image ? [product.image] : []);
  const promises = imgs.map(p => resolveImagePath(p));
  const urls = (await Promise.all(promises)).filter(Boolean);
  product.__resolvedImages = urls;
  if (!product.image && urls.length) product.image = urls[0];
  return urls;
}

async function fetchProducts() {
  const col = collection(db, 'product');
  const snap = await getDocs(query(col, orderBy('name', 'asc')));
  PRODUCTS = snap.docs.map(normalizeProduct);
  PRODUCTS_BY_ID = new Map(PRODUCTS.map(p => [p.id, p]));
  await Promise.all(PRODUCTS.map(p => resolveProductImages(p)));
}

/* ------------------- Carrito: Acciones ------------------- */
function addToCart(productId, qty = 1) {
  const p = PRODUCTS_BY_ID.get(productId);
  if (!p) { showToast('Producto no encontrado'); return false; }
  if (!isProductVisible(p)) { showToast('Producto no disponible'); return false; }

  const price = (p.discountPrice && Number(p.discountPrice) > 0) ? Number(p.discountPrice) : Number(p.price);
  const existing = CART.items.find(i => i.productId === p.id);
  const resolvedImg = (p.__resolvedImages && p.__resolvedImages[0]) || p.image || '';

  if (existing) {
    existing.quantity = Math.min(999, existing.quantity + qty);
  } else {
    CART.items.push({
      productId: p.id,
      name: p.name,
      price,
      quantity: Math.max(1, Math.min(999, qty)),
      subtotal: price * qty,
      image: resolvedImg
    });
  }

  recalcCart();
  persistCart();
  showToast('Producto agregado al carrito');
  return true;
}

function updateQuantity(productId, qty) {
  const item = CART.items.find(i => i.productId === productId);
  if (!item) return;
  const q = Math.max(0, Math.min(999, Math.floor(qty)));
  if (q === 0) { removeItem(productId); return; }
  item.quantity = q;
  recalcCart();
  persistCart();
}

function removeItem(productId) {
  CART.items = CART.items.filter(i => i.productId !== productId);
  recalcCart();
  persistCart();
}

window.addToCart = addToCart;
window.updateQuantity = updateQuantity;
window.removeItem = removeItem;

/* ------------------- Render: Slider de Productos Nuevos ------------------- */
function renderNewProductsSlider() {
  const container = document.getElementById('newProductsSliderContainer');
  const section = document.getElementById('newProductsSliderSection');
  if (!container || !section) return;

  const newProducts = PRODUCTS.filter(p => p.isNew && isProductVisible(p));
  if (newProducts.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = newProducts.map(p => {
    const img = (p.__resolvedImages && p.__resolvedImages[0]) || p.image || '';
    return `
      <div class="min-w-[260px] sm:min-w-[300px] bg-white rounded-2xl p-3 border border-cyan-100 shadow-sm hover:shadow-md transition-all flex flex-col justify-between cursor-pointer" onclick="window.location.href='producto.html?id=${p.id}'">
        <div class="relative w-full h-40 bg-slate-100 rounded-xl overflow-hidden mb-3">
          <span class="absolute top-2 left-2 bg-cyan-500 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase z-10 shadow-sm">
            ✨ NUEVO
          </span>
          <img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" class="w-full h-full object-cover">
        </div>
        <div>
          <h3 class="text-sm font-bold text-slate-800 line-clamp-1">${escapeHtml(p.name)}</h3>
          <div class="flex items-center gap-2 mt-1">
            ${p.discountPrice 
              ? `<span class="text-xs text-slate-400 line-through">${formatCurrency(p.price)}</span><span class="text-base font-bold text-cyan-600">${formatCurrency(p.discountPrice)}</span>` 
              : `<span class="text-base font-bold text-slate-800">${formatCurrency(p.price)}</span>`}
          </div>
        </div>
        <div class="mt-3 flex gap-2">
          <button class="flex-1 bg-cyan-50 hover:bg-cyan-100 text-cyan-700 font-semibold py-2 rounded-xl text-xs transition-colors" onclick="event.stopPropagation(); window.location.href='producto.html?id=${p.id}'">
            Ver Detalle
          </button>
          <button class="bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold px-3 py-2 rounded-xl text-xs transition-colors" onclick="event.stopPropagation(); addToCart('${p.id}', 1)">
            🛒
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/* ------------------- Render: Slider de Ofertas ------------------- */
function renderOffersSlider() {
  const container = document.getElementById('offersSliderContainer');
  const section = document.getElementById('offersSliderSection');
  if (!container || !section) return;

  const offers = PRODUCTS.filter(p => isComboOrOffer(p) && isProductVisible(p));
  if (offers.length === 0) {
    section.classList.add('hidden');
    return;
  }

  section.classList.remove('hidden');
  container.innerHTML = offers.map(p => {
    const img = (p.__resolvedImages && p.__resolvedImages[0]) || p.image || '';
    return `
      <div class="min-w-[260px] sm:min-w-[300px] bg-white rounded-2xl p-3 border border-red-100 shadow-sm hover:shadow-md transition-all flex flex-col justify-between cursor-pointer" onclick="window.location.href='producto.html?id=${p.id}'">
        <div class="relative w-full h-40 bg-slate-100 rounded-xl overflow-hidden mb-3">
          <span class="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-md uppercase z-10">Combo / Oferta</span>
          <img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" class="w-full h-full object-cover">
        </div>
        <div>
          <h3 class="text-sm font-bold text-slate-800 line-clamp-1">${escapeHtml(p.name)}</h3>
          <div class="flex items-center gap-2 mt-1">
            ${p.discountPrice 
              ? `<span class="text-xs text-slate-400 line-through">${formatCurrency(p.price)}</span><span class="text-base font-bold text-red-600">${formatCurrency(p.discountPrice)}</span>` 
              : `<span class="text-base font-bold text-slate-800">${formatCurrency(p.price)}</span>`}
          </div>
        </div>
        <div class="mt-3 flex gap-2">
          <button class="flex-1 bg-red-50 hover:bg-red-100 text-red-600 font-semibold py-2 rounded-xl text-xs transition-colors" onclick="event.stopPropagation(); window.location.href='producto.html?id=${p.id}'">
            Ver Detalle
          </button>
          <button class="bg-green-100 hover:bg-green-200 text-green-700 font-bold px-3 py-2 rounded-xl text-xs transition-colors" onclick="event.stopPropagation(); addToCart('${p.id}', 1)">
            🛒
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/* ------------------- Render: Categorías ------------------- */
function renderCategories() {
  const container = document.getElementById('catalogCategories');
  if (!container) return;

  const categories = ["Todos", ...new Set(PRODUCTS.filter(p => !isComboOrOffer(p)).map(p => p.category))];
  container.innerHTML = categories.map(cat => `
    <button class="px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${CURRENT_CATEGORY === cat ? 'bg-cyan-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}" onclick="window.selectCategory('${cat}')">
      ${escapeHtml(cat)}
    </button>
  `).join('');
}

window.selectCategory = (cat) => {
  CURRENT_CATEGORY = cat;
  CATALOG_CURRENT_PAGE = 1;
  renderCategories();
  renderProductsGrid();
};

/* ------------------- Render: Grilla Principal ------------------- */
function filterProducts() {
  return PRODUCTS.filter(p => {
    if (!isProductVisible(p)) return false;
    if (isComboOrOffer(p)) return false;

    const matchesCategory = (CURRENT_CATEGORY === 'Todos' || p.category === CURRENT_CATEGORY);
    const matchesSearch = (p.name || '').toLowerCase().includes(SEARCH_QUERY);

    return matchesCategory && matchesSearch;
  });
}

function renderProductsGrid() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;

  const filtered = filterProducts();
  const totalProducts = filtered.length;
  const totalPages = Math.ceil(totalProducts / CATALOG_PAGE_SIZE) || 1;

  if (CATALOG_CURRENT_PAGE > totalPages) CATALOG_CURRENT_PAGE = totalPages;
  if (CATALOG_CURRENT_PAGE < 1) CATALOG_CURRENT_PAGE = 1;

  const startIdx = (CATALOG_CURRENT_PAGE - 1) * CATALOG_PAGE_SIZE;
  const paginated = filtered.slice(startIdx, startIdx + CATALOG_PAGE_SIZE);

  if (paginated.length === 0) {
    grid.innerHTML = '<div class="col-span-full text-center py-12 text-slate-400">No se encontraron productos disponibles.</div>';
    renderCatalogPagination(totalPages);
    return;
  }

  grid.innerHTML = paginated.map(p => {
    const img = (p.__resolvedImages && p.__resolvedImages[0]) || p.image || '';
    return `
      <article class="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between cursor-pointer group" onclick="window.location.href='producto.html?id=${p.id}'">
        <div class="relative w-full aspect-square bg-slate-50 overflow-hidden">
          ${p.isNew ? `<span class="absolute top-2 left-2 bg-cyan-500 text-white text-[9px] font-extrabold px-2 py-0.5 rounded-md uppercase z-10 shadow-sm">NUEVO</span>` : ''}
          <img src="${escapeHtml(img)}" alt="${escapeHtml(p.name)}" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
        </div>
        <div class="p-4 flex flex-col flex-grow">
          <span class="text-[10px] uppercase font-semibold text-slate-400 mb-1">${escapeHtml(p.category)}</span>
          <h3 class="text-sm font-bold text-slate-800 line-clamp-2 mb-2 hover:text-cyan-600 transition-colors">${escapeHtml(p.name)}</h3>
          <div class="mt-auto flex items-center justify-between pt-2">
            <span class="text-base font-bold text-slate-900">${formatCurrency(p.price)}</span>
            <button class="p-2 bg-cyan-50 hover:bg-cyan-100 text-cyan-600 rounded-xl transition-colors font-bold" onclick="event.stopPropagation(); addToCart('${p.id}', 1)" aria-label="Agregar al carrito">
              🛒
            </button>
          </div>
        </div>
      </article>
    `;
  }).join('');

  renderCatalogPagination(totalPages);
}

/* ------------------- Paginación ------------------- */
function renderCatalogPagination(totalPages) {
  const el = document.getElementById('catalogPagination');
  if (!el) return;
  el.innerHTML = '';
  if (totalPages <= 1) return;

  const prevBtn = document.createElement('button');
  prevBtn.textContent = '←';
  prevBtn.className = 'px-3 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50';
  prevBtn.disabled = CATALOG_CURRENT_PAGE === 1;
  prevBtn.onclick = () => {
    if (CATALOG_CURRENT_PAGE > 1) {
      CATALOG_CURRENT_PAGE--;
      renderProductsGrid();
    }
  };
  el.appendChild(prevBtn);

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = `px-3 py-1 rounded ${i === CATALOG_CURRENT_PAGE ? 'bg-cyan-500 text-white font-bold' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`;
    btn.onclick = () => {
      CATALOG_CURRENT_PAGE = i;
      renderProductsGrid();
    };
    el.appendChild(btn);
  }

  const nextBtn = document.createElement('button');
  nextBtn.textContent = '→';
  nextBtn.className = 'px-3 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50';
  nextBtn.disabled = CATALOG_CURRENT_PAGE === totalPages;
  nextBtn.onclick = () => {
    if (CATALOG_CURRENT_PAGE < totalPages) {
      CATALOG_CURRENT_PAGE++;
      renderProductsGrid();
    }
  };
  el.appendChild(nextBtn);
}

/* ------------------- Render Panel Lateral Carrito ------------------- */
function renderCartPanel() {
  const selectedEl = document.getElementById('selectedProducts');
  if (!selectedEl) return;

  if (!CART.items.length) {
    selectedEl.innerHTML = '<div style="padding:12px;color:#64748b">No hay artículos seleccionados.</div>';
    return;
  }

  selectedEl.innerHTML = CART.items.map(it => `
    <div class="cart-item flex items-center gap-3 p-2 border-b border-slate-100">
      <img src="${escapeHtml(it.image)}" alt="${escapeHtml(it.name)}" class="w-12 h-12 object-cover rounded-lg">
      <div class="flex-1">
        <div class="font-bold text-xs text-slate-800 line-clamp-1">${escapeHtml(it.name)}</div>
        <div class="text-xs text-slate-500">${formatCurrency(it.price)} x ${it.quantity}</div>
      </div>
      <div class="flex items-center gap-1">
        <button onclick="updateQuantity('${it.productId}', ${it.quantity - 1})" class="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-bold">-</button>
        <span class="text-xs px-1">${it.quantity}</span>
        <button onclick="updateQuantity('${it.productId}', ${it.quantity + 1})" class="px-2 py-0.5 bg-slate-100 rounded text-slate-700 font-bold">+</button>
      </div>
    </div>
  `).join('');
}

/* ------------------- Inicialización ------------------- */
async function init() {
  loadCartFromCookie();
  try {
    await fetchProducts();
    renderNewProductsSlider();
    renderOffersSlider();
    renderCategories();
    renderProductsGrid();
  } catch (err) {
    console.error("Error al cargar productos:", err);
  }

  const searchInput = document.getElementById('catalogSearch');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      SEARCH_QUERY = e.target.value.toLowerCase().trim();
      CATALOG_CURRENT_PAGE = 1;
      renderProductsGrid();
    });
  }
}

window.addEventListener('DOMContentLoaded', init);
