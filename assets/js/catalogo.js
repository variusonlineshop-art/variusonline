// Catálogo y carrito con filtro por categorías, buscador en tiempo real y shortcut Ctrl+K.

// Firebase Firestore y Storage
import { firebaseConfig } from './firebase-config.js';
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, getDoc, doc, query, orderBy, where, limit
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";
import {
  getStorage, ref as storageRef, getDownloadURL
} from "https://www.gstatic.com/firebasejs/12.4.0/firebase-storage.js";

// Inicializa Firebase
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// ----- NUEVAS VARIABLES PARA PAGINACION -----
let SHOW_ONLY_OFFERS = false;
let SEARCH_QUERY = ''; // Esta es la que te faltaba
let CATALOG_CURRENT_PAGE = 1;
let CATALOG_PAGE_SIZE = 20;

// Helpers cookies/cart
function generateCartToken() {
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
function renderCartCount() {
  const count = CART.items.reduce((s, i) => s + i.quantity, 0);
  const c1 = document.getElementById('cartCount');
  if (c1) c1.textContent = count;
}
function renderCartPanel() {
  const selectedEl = document.getElementById('selectedProducts');
  const availableEl = document.getElementById('availableProducts');
  const subtotalEl = document.getElementById('cartSubtotalInline');
  const totalEl = document.getElementById('cartTotalInline');
  const checkoutTotalHeader = document.getElementById('checkoutTotalHeader');
  const continueBtn = document.getElementById('continueWithData');
  if (!selectedEl || !availableEl) return;

  const hasItems = CART.items && CART.items.length > 0;
  if (continueBtn) {
    continueBtn.disabled = !hasItems;
    if (!hasItems) continueBtn.setAttribute('aria-disabled', 'true'); else continueBtn.removeAttribute('aria-disabled');
  }

  const items = CART.items.slice().filter(i => i.quantity > 0);
  items.sort((a, b) => {
    if (a.productId === SELECTED_PRODUCT_ID) return -1;
    if (b.productId === SELECTED_PRODUCT_ID) return 1;
    return 0;
  });

  selectedEl.innerHTML = '';
  if (!items.length) {
    selectedEl.innerHTML = '<div style="padding:12px;color:#64748b">No hay artículos seleccionados.</div>';
  } else {
    for (const it of items) {
      // Obtener info del producto para saber si está en oferta
      const p = PRODUCTS_BY_ID.get(it.productId);
      const isOffer = !!(p && (p.isOnSale || (p.discountPrice && p.discountPrice < p.price)));
      const badgeHtml = isOffer ? `<div class="offer-badge-small" aria-hidden="true">🎁 Oferta</div>` : '';

      const div = document.createElement('div');
      div.className = 'cart-item';
      div.innerHTML = `
          <div class="cart-item-product" style="width:100%;text-align:left;">
            <img src="${escapeHtml(it.image || '')}" alt="${escapeHtml(it.name)}" style="display:block;margin:0 0 1rem 0;width:100%;max-width:400px;height:170px;object-fit:contain;border-radius:18px;box-shadow:0 8px 24px #0001;">
            <div class="product-title-row">
              <div class="left">
                <div style="font-weight:700;font-size:1.1rem;margin-top:0.6rem;text-align:left;">${escapeHtml(it.name)}</div>
                ${badgeHtml}
              </div>
              <div style="color:#8c99a6;font-size:1.05rem;margin-left:12px;text-align:right;">
                ${formatCurrency(it.price)} x ${it.quantity} = <strong style="color:#222">${formatCurrency(it.subtotal)}</strong>
              </div>
            </div>

            <div class="qty-controls" style="justify-content:flex-start;gap:0.35rem;margin:0.6rem 0 0 0;">
              <button class="qty-decr" data-id="${it.productId}" aria-label="Disminuir" style="background:#cdb4ff;color:#222;font-weight:700;">−</button>
              <input class="qty-input" data-id="${it.productId}" type="number" min="0" max="999" value="${it.quantity}" style="width:56px;border-radius:10px;padding:8px 0 8px 0;text-align:center;">
              <button class="qty-incr" data-id="${it.productId}" aria-label="Aumentar" style="background:#cdb4ff;color:#222;font-weight:700;">+</button>
              <button class="btn-secondary remove-item" data-id="${it.productId}" style="margin-left:18px;border-radius:9px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor"
                class="bi bi-trash" viewBox="0 0 16 16">
                    <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/>
                    <path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/>
                </svg>
              </button>
              <button class="btn-secondary view-btn" data-id="${it.productId}" style="margin-left:10px;border-radius:9px;">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor"
                class="bi bi-eye" viewBox="0 0 16 16">
                  <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/>
                  <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/>
                </svg>
              </button>
            </div>
          </div>
        `;
      selectedEl.appendChild(div);
    }

    // Eventos controles cantidad
    selectedEl.querySelectorAll('.qty-incr').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const item = CART.items.find(x => x.productId === id);
        if (!item) return;
        updateQuantity(id, item.quantity + 1);
        renderCartPanel();
      });
    });
    selectedEl.querySelectorAll('.qty-decr').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const item = CART.items.find(x => x.productId === id);
        if (!item) return;
        updateQuantity(id, Math.max(0, item.quantity - 1));
        renderCartPanel();
      });
    });
    selectedEl.querySelectorAll('.qty-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const id = e.currentTarget.dataset.id;
        let q = parseInt(e.currentTarget.value, 10);
        if (isNaN(q) || q < 0) q = 0;
        updateQuantity(id, q);
        renderCartPanel();
      });
    });
    selectedEl.querySelectorAll('.remove-item').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        const ok = await showConfirm('Eliminar artículo del carrito?');
        if (!ok) return;
        removeItem(id);
        renderCartPanel();
      });
    });
    // Evento para botón de ver (modal)
    selectedEl.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        let p = PRODUCTS_BY_ID.get(id);
        if (!p) p = await fetchProductByIdOrSlug(id);
        if (!p) { showToast('Producto no encontrado'); return; }
        await resolveProductImages(p);
        openProductModal(p);
      });
    });
  }

  // Orden: ofertas primero (por mayor descuento) luego resto alfabéticamente
  const inCartIds = new Set(CART.items.map(i => i.productId));

  // MODIFICACIÓN CRÍTICA: aquí filtramos únicamente productos en oferta
  const availProducts = PRODUCTS.filter(p => {
    const visible = isProductVisible(p) && (typeof p.stock !== 'number' || p.stock > 0) && !inCartIds.has(p.id);

    if (SHOW_ONLY_OFFERS) {
      // Si el checkbox está marcado, aplicamos el filtro de oferta
      return visible && (p.isOnSale || (p.discountPrice && Number(p.discountPrice) < Number(p.price)));
    }
    // Si no está marcado, mostramos todos los visibles
    return visible;
  });

  availProducts.sort((a, b) => {
    const aOffer = (a.isOnSale || (a.discountPrice && a.discountPrice < a.price)) ? 1 : 0;
    const bOffer = (b.isOnSale || (b.discountPrice && b.discountPrice < b.price)) ? 1 : 0;
    if (aOffer !== bOffer) return bOffer - aOffer; // ofertas primero
    if (aOffer && bOffer) {
      const aDisc = (Number(a.price) - Number(a.discountPrice || a.price)) || 0;
      const bDisc = (Number(b.price) - Number(b.discountPrice || b.price)) || 0;
      if (aDisc !== bDisc) return bDisc - aDisc; // mayor descuento primero
    }
    return String(a.name || '').localeCompare(String(b.name || ''));
  });

  availableEl.innerHTML = '';
  if (!availProducts.length) {
    availableEl.innerHTML = '<div style="padding:12px;color:#64748b">No hay productos en oferta.</div>';
  } else {
    for (const p of availProducts) {
      const resolved = (p.__resolvedImages && p.__resolvedImages[0]) || p.image || '';
      const div = document.createElement('div');
      div.className = 'avail-item';

      let priceHtml = '';
      const isOffer = p.isOnSale || (p.discountPrice && Number(p.discountPrice) < Number(p.price));
      if (p.discountPrice && Number(p.discountPrice) < Number(p.price)) {
        priceHtml = `
                  <span class="price-old" style="font-size:0.9rem;color:#9aa1ab;text-decoration:line-through;margin-right:6px;">
                    ${formatCurrency(p.price)}
                  </span>
                  <span style="color:#9aa1ab;margin-right:6px;">→</span>
                  <span class="price-new" style="font-size:1.05rem;color:#111;font-weight:700;">
                    ${formatCurrency(p.discountPrice)}
                  </span>
                `;
      } else {
        priceHtml = `<span class="price-new" style="font-size:1.03rem;color:#111;font-weight:700;">${formatCurrency(p.price)}</span>`;
      }

      // Badge "🎁 OFERTA" cuando aplica
      const badgeHtml = isOffer ? `` : '';

      div.innerHTML = `
              ${badgeHtml}
              <img src="${escapeHtml(resolved)}" alt="${escapeHtml(p.name)}">
              <div style="flex:1">
                <div style="font-weight:700">${escapeHtml(p.name)}</div>
                <div style="color:#94a3b8">${priceHtml}</div>
                <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
                  <div class="qty-controls" style="align-items:center">
                    <button class="qty-decr avail-decr" data-id="${escapeHtml(p.id)}" aria-label="Disminuir">−</button>
                    <input class="avail-qty qty-input" data-id="${escapeHtml(p.id)}" type="number" min="0" max="999" value="0" style="width:70px;padding:6px;border-radius:8px;border:1px solid #e6eef6">
                    <button class="qty-incr avail-incr" data-id="${escapeHtml(p.id)}" aria-label="Aumentar">+</button>
                  </div>
                  <button class="btn-secondary view-btn" data-id="${escapeHtml(p.id)}" style="margin-left:8px">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eye" viewBox="0 0 16 16">
                        <path d="M16 8s-3-5.5-8-5.5S0 8 0 8s3 5.5 8 5.5S16 8 16 8M1.173 8a13 13 0 0 1 1.66-2.043C4.12 4.668 5.88 3.5 8 3.5s3.879 1.168 5.168 2.457A13 13 0 0 1 14.828 8q-.086.13-.195.288c-.335.48-.83 1.12-1.465 1.755C11.879 11.332 10.119 12.5 8 12.5s-3.879-1.168-5.168-2.457A13 13 0 0 1 1.172 8z"/>
                        <path d="M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5M4.5 8a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0"/>
                    </svg>
                  </button>
                </div>
              </div>
            `;
      availableEl.appendChild(div);
    }

    availableEl.querySelectorAll('.avail-qty').forEach(input => {
      input.addEventListener('change', (e) => {
        const id = e.currentTarget.dataset.id;
        let q = parseInt(e.currentTarget.value, 10);
        if (isNaN(q) || q < 0) q = 0;
        if (q === 0) { e.currentTarget.value = 0; return; }
        const added = addToCart(id, q);
        if (added) { renderCartPanel(); e.currentTarget.value = 0; }
        else { e.currentTarget.value = 0; }
      });
    });

    availableEl.querySelectorAll('.avail-incr').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        addToCart(id, 1);
        renderCartPanel();
      });
    });

    availableEl.querySelectorAll('.avail-decr').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.id;
        const item = CART.items.find(x => x.productId === id);
        if (!item) { showToast('No hay unidades en el carrito para este producto'); return; }
        updateQuantity(id, Math.max(0, item.quantity - 1));
        renderCartPanel();
      });
    });

    availableEl.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.dataset.id;
        let p = PRODUCTS_BY_ID.get(id);
        if (!p) p = await fetchProductByIdOrSlug(id);
        if (!p) { showToast('Producto no encontrado'); return; }
        await resolveProductImages(p);
        openProductModal(p);
      });
    });
  }

  const subtotal = CART.total || 0;
  subtotalEl.textContent = formatCurrency(subtotal);
  totalEl.textContent = formatCurrency(subtotal);
  if (checkoutTotalHeader) checkoutTotalHeader.textContent = `Total: ${formatCurrency(subtotal)}`;

  renderCartCount();
}
/* ------------------- Carrito ------------------- */
const CART_COOKIE = 'mi_tienda_cart_v1';
let CART = null;
function createEmptyCart() {
  const token = generateCartToken();
  return { cartToken: token, items: [], total: 0, timestamp: new Date().toISOString() };
}
function loadCartFromCookie() {
  const c = getCookieJSON(CART_COOKIE);
  if (!c) { CART = createEmptyCart(); persistCart(); return; }
  if (!c.cartToken || !Array.isArray(c.items)) { CART = createEmptyCart(); persistCart(); return; }
  CART = c;
  recalcCart();
}
function persistCart() { setCookieJSON(CART_COOKIE, CART, 14); renderCartCount(); try { renderCartPanel(); } catch (e) { /* ignore */ } }
function recalcCart() {
  let total = 0;
  CART.items.forEach(it => { it.subtotal = it.quantity * it.price; total += it.subtotal; });
  CART.total = total;
  CART.timestamp = new Date().toISOString();
}

/* ------------------- Productos ------------------- */
let PRODUCTS = [];
let PRODUCTS_BY_ID = new Map();

function toTitleCase(str) {
  if (!str) return '';
  return String(str).trim().split(/\s+/).map(word => {
    return word.split(/([-'])/).map(seg => {
      if (seg === '-' || seg === "'") return seg;
      return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
    }).join('');
  }).join(' ');
}

function normalizeProduct(doc) {
  const data = doc.data();
  const price = Number(data.price) || 0;
  let discountPrice = null;
  if (data.discountPrice !== undefined && data.discountPrice !== null && data.discountPrice !== '') {
    const dp = Number(data.discountPrice);
    if (isFinite(dp)) discountPrice = dp;
  } else if (data.discount !== undefined && data.discount !== null && data.discount !== '') {
    const d = Number(data.discount);
    if (isFinite(d)) {
      if (d > 0 && d <= 1) {
        discountPrice = Math.max(0, price * (1 - d));
      } else if (d > 1 && d <= 100) {
        discountPrice = Math.max(0, price * (1 - d / 100));
      } else {
        discountPrice = Math.max(0, price - d);
      }
    }
  }
  if (discountPrice !== null) {
    discountPrice = Number(discountPrice);
    if (!isFinite(discountPrice) || discountPrice <= 0 || discountPrice >= price) {
      discountPrice = null;
    }
  }
  const isOnSale = !!(data.onOffer || data.isOnSale || data.onoffer || (discountPrice && discountPrice < price));
  const images = Array.isArray(data.imageUrls) && data.imageUrls.length ? data.imageUrls.slice()
    : (data.imageUrl ? [data.imageUrl] : (data.image ? [data.image] : (Array.isArray(data.imagePaths) ? data.imagePaths.slice() : [])));
  const rawName = data.name || data.title || '';
  const name = toTitleCase(rawName);

  return {
    id: doc.id,
    name,
    price,
    discountPrice: (discountPrice && Number(discountPrice) > 0) ? discountPrice : null,
    isOnSale,
    images,
    image: images && images.length ? images[0] : '',
    description: data.description || '',
    category: data.category || '',
    slug: data.slug || '',
    status: data.status || 'Activo',
    stock: (typeof data.stock !== 'undefined') ? Number(data.stock) : null,
    raw: data
  };
}
async function fetchAllProductsFromFirestore() {
  try {
    const col = collection(db, 'product');
    const q = query(col, orderBy('name', 'asc'));
    const snap = await getDocs(q);
    const arr = snap.docs.map(normalizeProduct);
    PRODUCTS = arr;
    PRODUCTS_BY_ID = new Map(arr.map(p => [p.id, p]));
    for (const p of arr) {
      if (p.slug) PRODUCTS_BY_ID.set(p.slug, p);
      const nlower = (p.name || '').toLowerCase();
      if (nlower) PRODUCTS_BY_ID.set(nlower, p);
    }
    return arr;
  } catch (err) {
    console.error('Error cargando products desde Firestore:', err);
    throw err;
  }
}
async function fetchProductByIdOrSlug(param) {
  if (PRODUCTS_BY_ID.has(param)) return PRODUCTS_BY_ID.get(param);
  try {
    const docRef = doc(db, 'product', param);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const p = normalizeProduct(snap);
      PRODUCTS.push(p);
      PRODUCTS_BY_ID.set(p.id, p);
      if (p.slug) PRODUCTS_BY_ID.set(p.slug, p);
      PRODUCTS_BY_ID.set((p.name || '').toLowerCase(), p);
      return p;
    }
  } catch (err) { console.error('Error buscando product por id:', err); }
  try {
    const col = collection(db, 'product');
    const q = query(col, where('slug', '==', param), limit(1));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const p = normalizeProduct(snap.docs[0]);
      PRODUCTS.push(p);
      PRODUCTS_BY_ID.set(p.id, p);
      if (p.slug) PRODUCTS_BY_ID.set(p.slug, p);
      PRODUCTS_BY_ID.set((p.name || '').toLowerCase(), p);
      return p;
    }
  } catch (err) { console.error('Error buscando product por slug:', err); }
  return null;
}

/* ------------------- Storage resolver ------------------- */
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
    console.warn('No se pudo resolver storage path:', pathOrUrl, err);
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

/* ------------------- Utilidades UI ------------------- */
function formatCurrency(n) {
  if (n === null || typeof n === 'undefined' || n === '') return '';
  const num = Number(n);
  if (!isFinite(num)) return String(n);
  let s = (typeof n === 'string') ? n.trim() : String(num);
  let decimals = 0;
  if (s.indexOf('.') >= 0) {
    decimals = s.split('.')[1].length;
  } else {
    if (num !== Math.trunc(num)) {
      const fracStr = String(num).split('.')[1] || '';
      decimals = Math.min(6, fracStr.length || 6);
    } else {
      decimals = 0;
    }
  }
  const fractionDigits = Math.max(2, Math.min(6, decimals));
  try {
    const nf = new Intl.NumberFormat('es-VE', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits
    }).format(num);
    return `$${nf}`;
  } catch (err) {
    const fixed = num.toFixed(fractionDigits);
    return `$${fixed.replace('.', ',')}`;
  }
}

function isProductVisible(p) {
  if (!p || !p.status) return true;
  const s = String(p.status).toLowerCase().trim();
  if (s === 'suspendido' || s === 'suspended' || s === 'inactivo' || s === 'inactive') return false;
  if (typeof p.stock === 'number' && p.stock <= 0) return false;
  return true;
}
const toastEl = document.getElementById('toast');
let toastTimeout = null;

function showToast(msg, ms = 2200) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[m]);
}

/* ------------------- Carrito: acciones ------------------- */
function addToCart(productIdOrSlug, qty = 1) {
  const p = PRODUCTS_BY_ID.get(productIdOrSlug);
  if (!p) { showToast('Producto no encontrado. Recarga la página.'); return false; }
  if (!isProductVisible(p)) { showToast('Producto no disponible'); return false; }
  if (typeof p.stock === 'number' && p.stock <= 0) { showToast('Producto sin stock'); return false; }
  const price = (p.discountPrice && Number(p.discountPrice) > 0) ? Number(p.discountPrice) : Number(p.price);
  const existing = CART.items.find(i => i.productId === p.id);
  if (existing) { existing.quantity = Math.min(999, existing.quantity + qty); }
  else {
    CART.items.push({ productId: p.id, name: p.name, price, quantity: Math.max(1, Math.min(999, qty)), subtotal: price * qty, image: (p.image || (p.__resolvedImages && p.__resolvedImages[0]) || '') });
  }
  recalcCart(); persistCart(); showToast('Producto agregado al carrito'); return true;
}
function updateQuantity(productId, qty) {
  const item = CART.items.find(i => i.productId === productId);
  if (!item) return;
  const q = Math.max(0, Math.min(999, Math.floor(qty)));
  if (q === 0) { removeItem(productId); return; }
  item.quantity = q; recalcCart(); persistCart();
}
function removeItem(productId) {
  CART.items = CART.items.filter(i => i.productId !== productId); recalcCart(); persistCart();
}
function clearCart() { CART = createEmptyCart(); persistCart(); showToast('Carrito vaciado'); }
function getCartQuantity(productId) {
  const it = CART.items.find(i => i.productId === productId);
  return it ? it.quantity : 0;
}

/* ------------------- Confirm modal ------------------- */
function showConfirm(message = '¿Estás seguro?') {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const msg = document.getElementById('confirmMessage');
    const btnAccept = document.getElementById('confirmAccept');
    const btnCancel = document.getElementById('confirmCancel');
    if (!modal || !msg || !btnAccept || !btnCancel) {
      const r = window.confirm(message);
      return resolve(r);
    }
    msg.textContent = message;
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    btnAccept.focus();
    function cleanup() {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
      btnAccept.removeEventListener('click', onAccept);
      btnCancel.removeEventListener('click', onCancel);
      document.removeEventListener('keydown', onKey);
    }
    function onAccept() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }
    function onKey(e) { if (e.key === 'Escape') { cleanup(); resolve(false); } }
    btnAccept.addEventListener('click', onAccept);
    btnCancel.addEventListener('click', onCancel);
    document.addEventListener('keydown', onKey);
  });
}


/* ------------------- RENDER: filtro, grid y categorías ------------------- */
let CURRENT_CATEGORY = "TODOS";
let CURRENT_SEARCH = "";

function getCategories() {
  const cats = new Set(PRODUCTS.map(p => toTitleCase(p.category || '')).filter(Boolean));
  return ["TODOS", ...Array.from(cats)];
}

function renderCategoryButtons() {
  const catEl = document.getElementById('catalogCategories');
  if (!catEl) return;
  const cats = getCategories();
  catEl.innerHTML = "";
  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = "px-6 py-2 rounded-full hover:bg-green-50 text-slate-500 text-sm" + (CURRENT_CATEGORY === cat ? " bg-green-100" : "");
    btn.textContent = cat;
    btn.setAttribute("data-cat", cat);
    btn.onclick = () => {
      CURRENT_CATEGORY = cat;
      CATALOG_CURRENT_PAGE = 1; // <-- vuelve a página 1
      renderProductsGridFiltered();
      renderCategoryButtons();
    };
    catEl.appendChild(btn);
  });
}

function filterProducts() {
  return PRODUCTS.filter(p => {
    // 1. Validar Categoría (Si no existe o es 'TODOS', pasa)
    const category = (typeof CURRENT_CATEGORY !== 'undefined') ? CURRENT_CATEGORY : 'TODOS';
    const matchesCategory = (category === 'TODOS' || p.category === category);
    
    // 2. Validar Búsqueda (Si no hay búsqueda, pasa)
    const search = (typeof SEARCH_QUERY !== 'undefined') ? SEARCH_QUERY.toLowerCase() : '';
    const productName = (p.name || "").toLowerCase();
    const matchesSearch = productName.includes(search);
    
    // 3. Validar Ofertas
    let matchesOffer = true;
    if (typeof SHOW_ONLY_OFFERS !== 'undefined' && SHOW_ONLY_OFFERS) {
      // Verifica si tiene precio de oferta o el flag activo
      const hasDiscount = p.discountPrice && Number(p.discountPrice) < Number(p.price);
      matchesOffer = (p.isOnSale === true || hasDiscount);
    }

    // El producto debe cumplir las 3 condiciones
    return matchesCategory && matchesSearch && matchesOffer;
  });
}

// --- Renderizar paginado ---
async function renderProductsGridFiltered() {
  const el = document.getElementById('productsGrid');
  if (!el) return;

  // Mostramos un estado de carga visual opcional
  el.innerHTML = '<div class="spinner">Cargando productos...</div>';

  // FILTRADO
  const visibleProducts = filterProducts();

  // PAGINADO
  const totalProducts = visibleProducts.length;
  const totalPages = Math.ceil(totalProducts / CATALOG_PAGE_SIZE) || 1;

  if (CATALOG_CURRENT_PAGE > totalPages) CATALOG_CURRENT_PAGE = totalPages;
  if (CATALOG_CURRENT_PAGE < 1) CATALOG_CURRENT_PAGE = 1;

  const startIdx = (CATALOG_CURRENT_PAGE - 1) * CATALOG_PAGE_SIZE;
  const paginatedProducts = visibleProducts.slice(startIdx, startIdx + CATALOG_PAGE_SIZE);

  el.innerHTML = '';

  if (paginatedProducts.length === 0) {
    el.innerHTML = '<div class="no-results">No se encontraron productos con estos filtros.</div>';
    renderCatalogPagination(totalPages);
    return;
  }

  // Resolver imágenes antes de renderizar
  await Promise.all(paginatedProducts.map(async (p) => {
    try { await resolveProductImages(p); } catch (err) { console.warn("Error imagen:", p.id); }
  }));

  // Renderizado de tarjetas
  for (const p of paginatedProducts) {
    const resolved = p.__resolvedImages && p.__resolvedImages.length ? p.__resolvedImages : (p.image ? [p.image] : []);
    const card = document.createElement('article');
    card.innerHTML = createProductCardHtml(p, resolved);
    el.appendChild(card);
    if (typeof initCardSliderDOM === 'function') initCardSliderDOM(card);
  }

  // Eventos de botones
  el.querySelectorAll('.add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.currentTarget.dataset.id;
      addToCart(id, 1);
      if (typeof renderCartPanel === 'function') renderCartPanel();
    });
  });

  el.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const id = e.currentTarget.dataset.id;
      let p = PRODUCTS_BY_ID.get(id);
      if (!p && typeof fetchProductByIdOrSlug === 'function') p = await fetchProductByIdOrSlug(id);
      if (p) {
        await resolveProductImages(p);
        openProductModal(p);
      }
    });
  });

  renderCatalogPagination(totalPages);
}

function renderCatalogPagination(totalPages) {
  const el = document.getElementById('catalogPagination');
  if (!el) return;
  el.innerHTML = '';
  if (totalPages <= 1) return; // No mostrar si hay solo una página

  // Botón anterior
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '←';
  prevBtn.disabled = CATALOG_CURRENT_PAGE === 1;
  prevBtn.onclick = () => {
    if (CATALOG_CURRENT_PAGE > 1) {
      CATALOG_CURRENT_PAGE--;
      renderProductsGridFiltered();
    }
  };
  el.appendChild(prevBtn);

  // Botones de página (máximo 8 cuando son muchas páginas)
  let firstPage = Math.max(1, CATALOG_CURRENT_PAGE - 3);
  let lastPage = Math.min(totalPages, CATALOG_CURRENT_PAGE + 3);

  if (CATALOG_CURRENT_PAGE <= 4) {
    firstPage = 1;
    lastPage = Math.min(totalPages, 7);
  } else if (CATALOG_CURRENT_PAGE >= totalPages - 3) {
    lastPage = totalPages;
    firstPage = Math.max(1, totalPages - 6);
  }

  for (let i = firstPage; i <= lastPage; i++) {
    const btn = document.createElement('button');
    btn.textContent = i;
    btn.className = (i === CATALOG_CURRENT_PAGE) ? 'active' : '';
    btn.disabled = i === CATALOG_CURRENT_PAGE;
    btn.onclick = () => {
      CATALOG_CURRENT_PAGE = i;
      renderProductsGridFiltered();
    };
    el.appendChild(btn);
  }

  // Botón siguiente
  const nextBtn = document.createElement('button');
  nextBtn.textContent = '→';
  nextBtn.disabled = CATALOG_CURRENT_PAGE === totalPages;
  nextBtn.onclick = () => {
    if (CATALOG_CURRENT_PAGE < totalPages) {
      CATALOG_CURRENT_PAGE++;
      renderProductsGridFiltered();
    }
  };
  el.appendChild(nextBtn);
}

function setupCatalogPageSizeSelector() {
  const select = document.getElementById('catalogPageSize');
  if (!select) return;
  select.value = String(CATALOG_PAGE_SIZE);
  select.onchange = function (e) {
    CATALOG_PAGE_SIZE = parseInt(e.target.value, 10) || 10;
    CATALOG_CURRENT_PAGE = 1;
    renderProductsGridFiltered();
  };
}


function setupCatalogSearch() {
  const searchEl = document.getElementById('catalogSearch');
  if (!searchEl) return;
  searchEl.value = CURRENT_SEARCH;
  searchEl.oninput = function (e) {
    CURRENT_SEARCH = e.target.value;
    CATALOG_CURRENT_PAGE = 1; // <-- vuelve a página 1
    renderProductsGridFiltered();
  };
  document.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "k") {
      searchEl.focus();
      ev.preventDefault();
    }
  });
}

/* ------------------- Product cards + slider ------------------- */
function createProductCardHtml(p, resolvedImages = []) {
  const isOffer = !!(p.isOnSale || (p.discountPrice && p.discountPrice < p.price));

  // 1. Lógica de Precios con Tailwind
  let priceHtml = '';
  if (isOffer) {
    priceHtml = `
      <div class="flex items-center gap-2">
        <span class="text-sm text-gray-400 line-through" aria-hidden="true">
          ${formatCurrency(p.price)}
        </span>
        <span class="text-gray-400 text-xs">→</span>
        <span class="text-lg font-bold text-gray-900">
          ${formatCurrency(p.discountPrice)}
        </span>
      </div>
    `;
  } else {
    priceHtml = `<span class="text-lg font-bold text-gray-900">${formatCurrency(p.price)}</span>`;
  }

  // 2. Slider / Imagen con Tailwind
  // Nota: He añadido 'aspect-square' para que todas las fotos midan lo mismo
  const imagesHtml = resolvedImages.length
    ? resolvedImages.map((u, i) => `
        <img src="${escapeHtml(u)}" 
             alt="${escapeHtml(p.name)} ${i + 1}" 
             class="absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${i === 0 ? 'opacity-100' : 'opacity-0'}">
      `).join('')
    : `<img src="${escapeHtml(p.image || '')}" alt="${escapeHtml(p.name)}" class="w-full aspect-square object-cover transition-transform duration-500 group-hover:scale-110">`;

  const sliderHtml = `
    <div class="relative w-full aspect-square overflow-hidden bg-gray-100" role="img" aria-label="${escapeHtml(p.name)}">
      ${imagesHtml}
    </div>
  `;

  // 3. Retorno del HTML completo
  return `
    <div class="relative group flex flex-col h-full bg-white rounded-2xl overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
      
      ${isOffer ? `
        <div class="absolute top-3 left-3 z-10 bg-red-500 text-white text-[10px] font-bold uppercase px-2 py-1 rounded-lg shadow-sm" aria-hidden="true">
          Oferta
        </div>
      ` : ''}

      ${sliderHtml}

      <div class="p-4 flex flex-col flex-grow">
        <span class="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">
          ${escapeHtml(p.category || 'General')}
        </span>
        
        <h3 class="text-gray-800 font-semibold text-base mb-2 line-clamp-2 min-h-[3rem]">
          ${escapeHtml(p.name)}
        </h3>

        <div class="mt-auto mb-4">
          ${priceHtml}
        </div>

        <div class="flex items-center gap-2">
          <button class="view-btn flex items-center justify-center p-2.5 text-cyan-600 bg-cyan-100 hover:bg-cyan-200 rounded-xl transition-colors" 
                  data-id="${escapeHtml(p.id)}" 
                  aria-label="Ver producto ${escapeHtml(p.name)}">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
            </svg>
          </button>
          
          <button class="add-btn flex-1 bg-green-200 hover:bg-green-300 hover:text-green-600 text-green-600 font-bold py-2.5 px-4 rounded-xl transition-all active:scale-95 shadow-sm hover:shadow-indigo-200" 
                  data-id="${escapeHtml(p.id)}" 
                  aria-label="Agregar ${escapeHtml(p.name)}">
            Agregar
          </button>
        </div>
      </div>
    </div>
  `;
}

function initCardSliderDOM(cardEl) {
  const imgs = Array.from(cardEl.querySelectorAll('.card-slider img'));
  if (!imgs.length) return;
  if (imgs.length <= 1) return;
  let idx = 0;
  setInterval(() => {
    const prev = idx;
    idx = (idx + 1) % imgs.length;
    imgs[prev].style.opacity = '0';
    imgs[idx].style.opacity = '1';
  }, 2400);
}

/* ------------------- Modal producto ------------------- */
let _productModalCurrentIndex = 0;
let _productModalImages = [];
let _productModalCurrentProduct = null;

function openProductModal(product) {
  const modal = document.getElementById('productModal');
  if (!modal) return;
  const title = document.getElementById('productModalTitle');
  const category = document.getElementById('productModalCategory');
  const desc = document.getElementById('productModalDescription');
  const prices = document.getElementById('productModalPrices');
  const thumbs = document.getElementById('productModalThumbs');
  const slider = document.getElementById('productModalSlider');
  const ribbon = document.getElementById('productRibbon');
  const addBtn = document.getElementById('productModalAdd');
  const qtyEl = document.getElementById('productModalQty');
  const viewFull = document.getElementById('productModalViewFull');

  _productModalImages = product.__resolvedImages && product.__resolvedImages.length ? product.__resolvedImages.slice() : (product.image ? [product.image] : []);
  _productModalCurrentIndex = 0;
  _productModalCurrentProduct = product;

  if (title) title.textContent = product.name || '';
  if (category) category.textContent = product.category || '';
  if (desc) desc.textContent = product.description || '';
  if (ribbon) {
    if (product.isOnSale || (product.discountPrice && product.discountPrice < product.price)) {
      ribbon.setAttribute('aria-hidden', 'false');
      ribbon.style.display = '';
    } else {
      ribbon.setAttribute('aria-hidden', 'true');
      ribbon.style.display = 'none';
    }
  }
  if (prices) {
    const isOffer = (product.isOnSale || (product.discountPrice && product.discountPrice < product.price));
    if (isOffer) {
      prices.innerHTML = `
              <span class="price-old" style="font-size:0.95rem;color:#9aa1ab;text-decoration:line-through;margin-right:6px;">
                ${formatCurrency(product.price)}
              </span>
              <span style="color:#9aa1ab;margin-right:6px;">→</span>
              <strong class="price-new" style="font-size:1.05rem;color:#111;font-weight:700;">
                ${formatCurrency(product.discountPrice)}
              </strong>
            `;
    } else {
      prices.innerHTML = `<strong class="price-new" style="font-size:1.03rem;color:#111;font-weight:700;">${formatCurrency(product.price)}</strong>`;
    }
  }

  slider.innerHTML = '';
  thumbs.innerHTML = '';
  _productModalImages.forEach((u, i) => {
    const img = document.createElement('img');
    img.src = u;
    img.alt = `${product.name} ${i + 1}`;
    img.dataset.index = String(i);
    if (i === 0) img.classList.add('active');
    slider.appendChild(img);

    const t = document.createElement('img');
    t.src = u;
    t.alt = `${product.name} thumb ${i + 1}`;
    t.dataset.index = String(i);
    if (i === 0) t.classList.add('active');
    t.addEventListener('click', () => { setProductModalIndex(i); });
    thumbs.appendChild(t);
  });

  try {
    if (qtyEl) {
      let wrapper = qtyEl.closest('.modal-qty-wrapper');
      let minusBtn = null;
      let plusBtn = null;

      if (!wrapper) {
        wrapper = document.createElement('div');
        wrapper.className = 'modal-qty-wrapper';
        wrapper.style.display = 'inline-flex';
        wrapper.style.alignItems = 'center';
        wrapper.style.gap = '8px';

        minusBtn = document.createElement('button');
        minusBtn.type = 'button';
        minusBtn.className = 'modal-qty-decr';
        minusBtn.setAttribute('aria-label', 'Disminuir cantidad');
        minusBtn.textContent = '−';
        minusBtn.style.padding = '8px 12px';
        minusBtn.style.borderRadius = '10px';
        minusBtn.style.background = '#e9d5ff';
        minusBtn.style.border = 'none';
        minusBtn.style.cursor = 'pointer';

        plusBtn = document.createElement('button');
        plusBtn.type = 'button';
        plusBtn.className = 'modal-qty-incr';
        plusBtn.setAttribute('aria-label', 'Aumentar cantidad');
        plusBtn.textContent = '+';
        plusBtn.style.padding = '8px 12px';
        plusBtn.style.borderRadius = '10px';
        plusBtn.style.background = '#c8f7ee';
        plusBtn.style.border = 'none';
        plusBtn.style.cursor = 'pointer';

        const parent = qtyEl.parentElement;
        const next = qtyEl.nextSibling;
        parent.insertBefore(wrapper, next);
        wrapper.appendChild(minusBtn);
        wrapper.appendChild(qtyEl);
        wrapper.appendChild(plusBtn);
      } else {
        minusBtn = wrapper.querySelector('.modal-qty-decr');
        plusBtn = wrapper.querySelector('.modal-qty-incr');
      }

      wrapper.dataset.productId = product.id;

      qtyEl.type = 'number';
      qtyEl.min = '0';
      qtyEl.max = '999';
      qtyEl.style.width = '70px';
      qtyEl.style.padding = '8px';
      qtyEl.style.borderRadius = '8px';
      qtyEl.style.textAlign = 'center';

      qtyEl.value = String(getCartQuantity(product.id) || 0);

      if (addBtn) addBtn.style.display = 'none';

      if (minusBtn && !minusBtn.dataset.listener) {
        minusBtn.addEventListener('click', (ev) => {
          const w = ev.currentTarget.closest('.modal-qty-wrapper');
          const pid = w?.dataset?.productId || _productModalCurrentProduct?.id;
          if (!pid) return;
          const current = getCartQuantity(pid);
          if (!current || current <= 0) {
            showToast('No hay unidades en el carrito para este producto');
            qtyEl.value = '0';
            return;
          }
          updateQuantity(pid, Math.max(0, current - 1));
          renderCartPanel();
          qtyEl.value = String(getCartQuantity(pid));
        });
        minusBtn.dataset.listener = '1';
      }

      if (plusBtn && !plusBtn.dataset.listener) {
        plusBtn.addEventListener('click', (ev) => {
          const w = ev.currentTarget.closest('.modal-qty-wrapper');
          const pid = w?.dataset?.productId || _productModalCurrentProduct?.id;
          if (!pid) return;
          addToCart(pid, 1);
          renderCartPanel();
          qtyEl.value = String(getCartQuantity(pid));
        });
        plusBtn.dataset.listener = '1';
      }

      if (!qtyEl.dataset.listener) {
        qtyEl.addEventListener('change', (ev) => {
          const w = ev.currentTarget.closest('.modal-qty-wrapper');
          const pid = w?.dataset?.productId || _productModalCurrentProduct?.id;
          if (!pid) return;
          let q = parseInt(ev.currentTarget.value, 10);
          if (isNaN(q) || q < 0) q = 0;
          const existing = getCartQuantity(pid);
          if (q === 0) {
            removeItem(pid);
          } else {
            if (existing === 0) {
              addToCart(pid, q);
            } else {
              updateQuantity(pid, q);
            }
          }
          renderCartPanel();
          qtyEl.value = String(getCartQuantity(pid));
        });
        qtyEl.dataset.listener = '1';
      }
    }
  } catch (err) {
    console.warn('Error al init controles de cantidad del modal', err);
  }

  if (addBtn) {
    addBtn.onclick = () => {
      const q = Math.max(1, Math.min(999, parseInt(qtyEl.value, 10) || 1));
      const added = addToCart(product.id, q);
      if (added) {
        renderCartPanel();
        showToast('Producto agregado');
        closeProductModal();
      }
    };
  }

  viewFull.style.display = 'none';
  viewFull.onclick = () => { window.location.href = `product.html?product=${encodeURIComponent(product.id)}`; };

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  document.getElementById('productModalPrev')?.addEventListener('click', productModalPrev);
  document.getElementById('productModalNext')?.addEventListener('click', productModalNext);

  document.getElementById('productModalClose')?.addEventListener('click', closeProductModal);
  modal.addEventListener('click', onProductModalOutsideClick);
  document.addEventListener('keydown', onProductModalKeydown);

  const firstFocusable = modal.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  if (firstFocusable) firstFocusable.focus();
}

function setProductModalIndex(i) {
  _productModalCurrentIndex = Math.max(0, Math.min(_productModalImages.length - 1, i));
  const slider = document.getElementById('productModalSlider');
  const thumbs = document.getElementById('productModalThumbs');
  if (!slider) return;
  Array.from(slider.querySelectorAll('img')).forEach(img => img.classList.remove('active'));
  Array.from(thumbs.querySelectorAll('img')).forEach(img => img.classList.remove('active'));
  slider.querySelector(`img[data-index="${_productModalCurrentIndex}"]`)?.classList.add('active');
  thumbs.querySelector(`img[data-index="${_productModalCurrentIndex}"]`)?.classList.add('active');
}
function productModalPrev() { setProductModalIndex(_productModalCurrentIndex - 1); }
function productModalNext() { setProductModalIndex(_productModalCurrentIndex + 1); }
function closeProductModal() {
  const modal = document.getElementById('productModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  document.getElementById('productModalPrev')?.removeEventListener('click', productModalPrev);
  document.getElementById('productModalNext')?.removeEventListener('click', productModalNext);
  modal.removeEventListener('click', onProductModalOutsideClick);
  document.removeEventListener('keydown', onProductModalKeydown);
}
function onProductModalOutsideClick(e) {
  const modal = document.getElementById('productModal');
  if (!modal) return;
  if (e.target === modal) closeProductModal();
}
function onProductModalKeydown(e) {
  if (e.key === 'Escape') closeProductModal();
  if (e.key === 'ArrowLeft') productModalPrev();
  if (e.key === 'ArrowRight') productModalNext();
}

/* ------------------- Boot ------------------- */
async function boot() {
  // 1. Cargar datos persistentes (Carrito)
  loadCartFromCookie();
  renderCartCount();

  // 2. Configurar el Filtro de Ofertas (Checkbox)
  const offerToggle = document.getElementById('offerToggle');
  if (offerToggle) {
    // Sincronizamos el estado inicial por si el navegador recordó el check
    SHOW_ONLY_OFFERS = offerToggle.checked;

    offerToggle.addEventListener('change', (e) => {
      SHOW_ONLY_OFFERS = e.target.checked;
      
      // Resetear a la primera página para evitar que quede en blanco 
      // si en la página actual no hay ofertas
      CATALOG_CURRENT_PAGE = 1; 
      
      // Refrescar la cuadrícula de productos
      renderProductsGridFiltered();
    });
  }

  // 3. Cargar productos desde Firebase
  try {
    // Mostramos un mensaje de carga inicial
    const productsGrid = document.getElementById('productsGrid');
    if (productsGrid) {
      productsGrid.innerHTML = '<div class="spinner">Cargando catálogo...</div>';
    }

    await fetchAllProductsFromFirestore();
    
    // Inicializar componentes de la interfaz
    renderCategoryButtons();
    setupCatalogSearch();
    setupCatalogPageSizeSelector(); 

    // Resolver imágenes de todos los productos (opcional hacerlo aquí o por página)
    await Promise.all(PRODUCTS.map(p => resolveProductImages(p)));

    // Primera renderización con los filtros iniciales
    renderProductsGridFiltered();

  } catch (err) {
    console.error("Error en el arranque del catálogo:", err);
    const productsGrid = document.getElementById('productsGrid');
    if (productsGrid) {
      productsGrid.innerHTML = `
        <div style="padding:16px; color:#ef4444; text-align:center;">
          <p>No se pudieron cargar los productos.</p>
          <small>Error: ${err.message}</small>
        </div>`;
    }
    showToast('Error cargando productos. Revisa la consola.', 4000);
  }
}

window.addEventListener('load', boot);

export { };
