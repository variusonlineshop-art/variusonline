import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, updateDoc, doc } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-storage.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

const auth = getAuth(app);
signInAnonymously(auth)
    .then(() => {
        console.log("Usuario autenticado anónimamente");
    })
    .catch((error) => {
        console.error("Error autenticando:", error);
    });

let productos = [];
let paginaActual = 1;
const itemsPorPagina = 20;
let sliderInterval;
let sortableObj = null; // fuera de la función

import { query, orderBy, limit, startAfter } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";

let lastVisible = null;

// --- DROPZONE MANEJO DE IMÁGENES ---
let currentImages = []; // {file, url, isUploaded, progress, storageUrl}

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('fileInput');
const previewContainer = document.getElementById('previewContainer');

if (dropzone && fileInput && previewContainer) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => {
        e.preventDefault();
        dropzone.classList.add('dropzone-active');
    });
    dropzone.addEventListener('dragleave', e => {
        e.preventDefault();
        dropzone.classList.remove('dropzone-active');
    });
    dropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropzone.classList.remove('dropzone-active');
        processFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => processFiles(fileInput.files));
}

async function processFiles(fileList) {
    for (let file of fileList) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 10 * 1024 * 1024) {
            alert('La imagen es muy grande (máx 10MB).');
            continue;
        }
        const compressedFile = await imageCompression(file, {
            maxSizeMB: 0.2,
            maxWidthOrHeight: 1280,
            useWebWorker: true
        });
        const localUrl = URL.createObjectURL(compressedFile);
        currentImages.push({ file: compressedFile, url: localUrl, isUploaded: false, progress: 0, storageUrl: null });
    }
    renderPreviewImages();
}


function renderPreviewImages() {
    previewContainer.innerHTML = '';
    currentImages.forEach((imgObj, idx) => {
        const div = document.createElement('div');
        div.className = 'image-preview-card relative w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden shadow border border-slate-200 flex items-center justify-center group';

        // Imagen
        const image = document.createElement('img');
        image.className = 'object-cover w-full h-full';
        image.src = imgObj.url;
        div.appendChild(image);

        // Remove button
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.title = 'Eliminar';
        btn.className = 'remove-btn absolute top-0 right-0 flex items-center justify-center w-7 h-7 rounded-br-lg rounded-tl-lg bg-red-600 bg-opacity-80 text-white text-xs z-10';
        btn.innerHTML = '<i class="fas fa-times"></i>';
        btn.onclick = () => {
            URL.revokeObjectURL(imgObj.url);
            currentImages.splice(idx, 1);
            renderPreviewImages();
        };
        div.appendChild(btn);

        // Barra de carga
        if (imgObj.progress && imgObj.progress < 100) {
            const progress = document.createElement('div');
            progress.className = 'absolute bottom-0 left-0 h-2 bg-blue-500';
            progress.style.width = `${imgObj.progress}%`;
            div.appendChild(progress);
        }
        previewContainer.appendChild(div);
    });

    // ---- GESTIÓN SINGLETON SORTABLE ----
    if (sortableObj) {
        sortableObj.destroy(); // Destruye cualquier instancia previa
        sortableObj = null;
    }
    if (currentImages.length > 1) {
        sortableObj = Sortable.create(previewContainer, {
            animation: 180,
            onEnd: (e) => {
                const moved = currentImages.splice(e.oldIndex, 1)[0];
                currentImages.splice(e.newIndex, 0, moved);
                // No vuelvas a renderizar aquí
            }
        });
    }
}

async function subirTodasLasImagenes(productSkuOrId) {
    let urlsOrdenadas = [];
    const spinner = document.getElementById('img-upload-spinner');
    if (spinner) spinner.classList.remove('hidden');

    try {
        if (!auth.currentUser) {
            await signInAnonymously(auth);
        }

        // Iteramos sobre currentImages que YA están en el orden que pusiste en el UI
        for (let i = 0; i < currentImages.length; i++) {
            let imgObj = currentImages[i];

            if (!imgObj.isUploaded) {
                // Es una imagen nueva (archivo local)
                const imgRef = storageRef(storage, `products/${productSkuOrId}/${Date.now()}_${i}.jpg`);

                await new Promise((resolve, reject) => {
                    const uploadTask = uploadBytesResumable(imgRef, imgObj.file);

                    uploadTask.on('state_changed',
                        (snap) => {
                            imgObj.progress = Math.floor((snap.bytesTransferred / snap.totalBytes) * 100);
                            renderPreviewImages();
                        },
                        reject,
                        async () => {
                            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                            imgObj.isUploaded = true;
                            imgObj.storageUrl = downloadUrl;
                            urlsOrdenadas.push(downloadUrl); // Guardamos en el orden actual
                            resolve();
                        }
                    );
                });
            } else {
                // Es una imagen que ya estaba en Firebase o ya se subió
                // Usamos storageUrl que es la URL real de Firebase
                urlsOrdenadas.push(imgObj.storageUrl);
            }
        }
    } catch (e) {
        console.error("Error subiendo imágenes:", e);
        alert("Error subiendo imágenes: " + e.message);
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }

    return urlsOrdenadas; // Retorna las URLs en el orden exacto del array currentImages
}

// --- FUNCIONES DE COPIADO ---
function buildAddLinkForPublic(productId) {
    const origin = window.location.origin;
    const publicPath = '/carrito.html';
    const params = new URLSearchParams({
        add: productId,
        openCart: '1',
        hideProducts: '1',
        utm_source: 'instagram'
    });
    return `${origin}${publicPath}?${params.toString()}`;
}

async function copyProductLink(id) {
    const link = buildAddLinkForPublic(id);
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(link);
        } else {
            const ta = document.createElement('textarea');
            ta.value = link;
            ta.style.position = 'fixed';
            ta.style.left = '-9999px';
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
        mostrarModalExito("¡Enlace copiado!", "El enlace ha sido copiado al portapapeles.");
    } catch (err) {
        console.error('copy error', err);
        alert('No se pudo copiar enlace');
    }
}

// Obtiene productos desde Firestore
async function cargarProductosFirebase(itemsPorPagina = 20, ultimoDoc = null) {
    try {
        let q = query(
            collection(db, "product"),
            orderBy("name"), // Puedes cambiar a otra propiedad si prefieres
            limit(itemsPorPagina)
        );
        if (ultimoDoc) {
            q = query(
                collection(db, "product"),
                orderBy("name"),
                startAfter(ultimoDoc),
                limit(itemsPorPagina)
            );
        }
        const snapshot = await getDocs(q);
        const productosData = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            productosData.push({
                id: doc.id,
                name: data.name || "Sin nombre",
                sku: data.sku || "N/A",
                category: data.category || "General",
                price: data.price || 0,
                stock: data.stock || 0,
                status: (data.status || "Activo").toUpperCase(),
                onOffer: data.onOffer === true,
                discount: data.discount || 0,
                images: (data.imageUrls && data.imageUrls.length > 0) ? data.imageUrls : ["https://via.placeholder.com/400x300"],
                description: data.description || "",
                sharedVideo: data.sharedVideo || null
            });
        });
        lastVisible = snapshot.docs[snapshot.docs.length - 1];
        return productosData;
    } catch (error) {
        console.error("Error cargando Firebase:", error);
        return [];
    }
}

// -- NUEVO: Cargar sólo categorías activas --
async function cargarCategoriasDesdeFirebase() {
    try {
        const categoriaRef = collection(db, "category");
        const snapshot = await getDocs(categoriaRef);
        const categorias = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.active) {
                categorias.push({
                    id: doc.id,
                    name: data.name || "Sin nombre",
                    color: data.color || "",
                    desc: data.desc || ""
                });
            }
        });
        return categorias;
    } catch (error) {
        console.error("Error cargando categorías:", error);
        return [];
    }
}

// -- Poblar selects de categorías (filtro y form) --
async function poblarCategorias() {
    const categorias = await cargarCategoriasDesdeFirebase();

    // Para filtro
    const selectFiltro = document.getElementById('categoryFilter');
    if (selectFiltro) {
        selectFiltro.innerHTML = '<option value="">Todas las Categorías</option>';
        categorias.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.name;
            option.textContent = cat.name;
            selectFiltro.appendChild(option);
        });
    }

    // Para formulario
    const selectForm = document.querySelector('#productForm select[name="category"]');
    if (selectForm) {
        selectForm.innerHTML = '';
        categorias.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.name;
            option.textContent = cat.name;
            selectForm.appendChild(option);
        });
        // Valor inicial
        if (!selectForm.value || !categorias.some(cat => cat.name === selectForm.value)) {
            selectForm.value = categorias[0]?.name || "";
        }
    }
}

/****
 * 
 * 
 * GESTION DE VIDEO PARA COMPARTIR
 * 
 * *****/
// —————— COMPARTIR PRODUCTO: MODAL, PREVIEW Y GUARDADO ——————

// Variable global para saber qué producto estamos compartiendo
let compartirProductoId = null;

// Abre el modal de compartir, precargando red social y url si existen
function abrirModalCompartir(id) {
    compartirProductoId = id;
    const p = productos.find(pr => pr.id === id);
    let red = '';
    let videoUrl = '';
    if (p && p.sharedVideo) {
        red = p.sharedVideo.network || '';
        videoUrl = p.sharedVideo.url || '';
    }
    document.getElementById('selectRedSocial').value = red;
    document.getElementById('inputUrlVideo').value = videoUrl;
    renderPrevisualizacionVideo();
    document.getElementById('modal-compartir').classList.remove('hidden');
}

// Cierra el modal de compartir
function cerrarModalCompartir() {
    compartirProductoId = null;
    document.getElementById('modal-compartir').classList.add('hidden');
}

// Cambia preview en el modal dependiendo de la red y la URL
function renderPrevisualizacionVideo() {
    const red = document.getElementById('selectRedSocial').value;
    const url = document.getElementById('inputUrlVideo').value.trim();
    const cont = document.getElementById('previewVideoContainer');
    cont.innerHTML = '<span class="text-slate-400">Cargando previsualización...</span>';
    if (!url || !red) return;

    let embedHtml = '';
    try {
        if (red === 'youtube') {
            let videoId = null;
            let matchNormal = url.match(/(?:youtube\.com.*(?:\?|&)v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
            let matchShort = url.match(/(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i);

            if (matchNormal && matchNormal[1]) videoId = matchNormal[1];
            else if (matchShort && matchShort[1]) videoId = matchShort[1];

            if (videoId) {
                embedHtml = `<iframe width="100%" height="520" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen class="rounded-xl"></iframe>`;
            }
        } else if (red === 'facebook') {
            embedHtml = `<iframe src="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0&width=560" width="100%" height="230" style="border:none;overflow:hidden" scrolling="no" frameborder="0" allowfullscreen class="rounded-xl"></iframe>`;
        } else if (red === 'instagram') {
            embedHtml = `
            <blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14" style="width:100%; min-width:200px; max-width:500px; margin:auto;">
                <a href="${url}" target="_blank" rel="noopener">Ver en Instagram</a>
            </blockquote>
            `;
            if (window.instgrm) setTimeout(() => window.instgrm.Embeds.process(), 100);
        }
        cont.innerHTML = embedHtml || '<span class="text-slate-400">No se pudo previsualizar el video</span>';
    } catch (err) {
        cont.innerHTML = '<span class="text-red-500">Error al cargar previsualización.</span>';
        console.error('Error renderizando video:', err);
    }
}

// Listeners para actualizar el preview en tiempo real
document.getElementById('selectRedSocial').addEventListener('change', renderPrevisualizacionVideo);
document.getElementById('inputUrlVideo').addEventListener('input', renderPrevisualizacionVideo);

// Guardar la red y url elegida en el producto correspondiente en Firestore
document.getElementById('productForm').onsubmit = async function (e) {
    e.preventDefault();
    const form = e.target;
    const isEdit = form.getAttribute('data-type') === 'edit';
    const idExistente = form.getAttribute('data-id');

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // Asegurar SKU y Tipos de datos
    data.sku = document.getElementById('skuInput').value;
    data.onOffer = form.isOffer?.checked || false;
    data.discount = data.onOffer ? parseInt(data.discount || "0") : 0;
    data.price = parseFloat((data.price || "0").replace(/\./g, "").replace(",", "."));
    data.stock = parseInt(data.stock || "0");

    // El campo 'status' a veces viene del select, aseguramos que exista
    data.status = data.status || 'ACTIVE';

    // Subir imágenes usando el SKU como carpeta
    let imageUrls = await subirTodasLasImagenes(data.sku);
    data.imageUrls = imageUrls;

    try {
        if (isEdit && idExistente) {
            // ACTUALIZACIÓN
            await updateDoc(doc(db, "product", idExistente), data);
            mostrarModalExito("¡Actualización exitosa!", "El producto se ha actualizado correctamente.");
        } else {
            // CREACIÓN NUEVA
            await addDoc(collection(db, "product"), data);
            mostrarModalExito("¡Guardado exitoso!", "El producto se ha guardado correctamente.");
        }

        cerrarModal();

        // Limpieza crítica para evitar duplicidad visual por persistencia de variables
        form.removeAttribute('data-type');
        form.removeAttribute('data-id');

        // Recargar datos frescos de la DB
        productos = await cargarProductosFirebase();
        renderizarTabla();

    } catch (err) {
        console.error("Error en el guardado:", err);
        alert("Error guardando producto: " + (err?.message ?? err));
    }
};

// Exponer globalmente para los onclick del HTML
window.abrirModalCompartir = abrirModalCompartir;
window.cerrarModalCompartir = cerrarModalCompartir;

/**FINALIZACION DE LAS FUNCIONES DE COMPARTIR */

function renderizarTabla(datos = productos) {
    const tbody = document.getElementById('productTableBody');
    if (!tbody) return;

    clearInterval(sliderInterval);

    const inicio = (paginaActual - 1) * itemsPorPagina;
    const fin = inicio + itemsPorPagina;
    const dataPagina = datos.slice(inicio, fin);

    tbody.innerHTML = '';
    dataPagina.forEach(p => {
        let claseFila = '';
        const statusU = p.status.toUpperCase();
        if (['SUSPENDED', 'PAUSADO', 'SUSPENDIDO'].includes(statusU)) claseFila = 'row-suspended';
        else if (p.stock === 0) claseFila = 'row-out-of-stock';
        else if (p.stock < 5) claseFila = 'row-low-stock';

        const fotosHTML = p.images.map((img, idx) =>
            `<img src="${img}" class="${idx === 0 ? 'active' : ''} w-12 h-12 rounded-lg object-cover absolute top-0 left-0 transition-opacity duration-1000">`
        ).join('');

        tbody.innerHTML += `
            <tr class="border-b border-slate-50 transition-all ${claseFila}">
                <td class="px-6 py-4">
                    <div class="flex items-center gap-4">
                        <div class="img-slider relative w-12 h-12 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg shadow-sm" 
                             onclick='abrirGaleria(${JSON.stringify(p.images)})'>
                            ${fotosHTML}
                        </div>
                        <div>
                            <div class="font-medium text-slate-800">${p.name}</div>
                            <div class="text-[10px] text-slate-400 font-bold uppercase">${p.sku}</div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 text-slate-500 text-sm font-medium">${p.category}</td>
                <td class="px-6 py-4">
                    <div class="font-bold text-slate-800">$ ${(typeof p.price === 'number' ? p.price : 0).toLocaleString('de-DE', { minimumFractionDigits: 2 })}</div>
                    ${p.onOffer ? `<span class="text-[10px] font-bold text-emerald-500">-${p.discount}% Rebajado</span>` : ''}
                </td>
                <td class="px-6 py-4">
                    <span class="font-bold ${p.stock === 0 ? 'text-red-500' : 'text-slate-700'}">${p.stock} Und</span>
                </td>
                <td class="px-6 py-4">
                    <span class="px-3 py-1 rounded-full text-[10px] font-extrabold ${getEstiloEstado(p.status)}">
                        ${traducirEstado(p.status)}
                    </span>
                </td>
                <td class="px-6 py-4">
                    <div class="flex justify-center gap-2">
                        <button onclick="copyProductLink('${p.id}')" title="Copiar enlace" class="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-500 hover:bg-indigo-500 hover:text-white transition-all"><i class="fas fa-link text-xs"></i></button>

                        <button onclick="abrirModal('edit', '${p.id}')" class="admin-only w-8 h-8 rounded-lg bg-blue-50 text-blue-500 hover:bg-blue-500 hover:text-white transition-all"><i class="fas fa-pen text-xs"></i></button>                        
                        
                        <button onclick="abrirModalCompartir('${p.id}')" class="admin-only w-8 h-8 rounded-lg bg-yellow-50 text-yellow-500 hover:bg-yellow-400 hover:text-white transition-all" title="Compartir producto">
                            <i class="fas fa-share-alt text-xs"></i>
                        </button>
                        
                        <button onclick="suspender('${p.id}')" class="admin-only w-8 h-8 rounded-lg bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all"><i class="fas fa-ban text-xs"></i></button>
                    </div>
                </td>
            </tr>
        `;
    });

    iniciarAutoplaySliders();
    actualizarPaginacion(datos.length);
    actualizarMetricas(datos);
}

function iniciarAutoplaySliders() {
    sliderInterval = setInterval(() => {
        document.querySelectorAll('.img-slider').forEach(slider => {
            const imgs = slider.querySelectorAll('img');
            if (imgs.length <= 1) return;
            let activeIdx = Array.from(imgs).findIndex(img => img.classList.contains('active'));
            imgs[activeIdx].classList.remove('active');
            imgs[activeIdx].style.opacity = "0";
            let nextIdx = (activeIdx + 1) % imgs.length;
            imgs[nextIdx].classList.add('active');
            imgs[nextIdx].style.opacity = "1";
        });
    }, 3000);
}

function aplicarFiltros() {
    const busqueda = document.getElementById('searchInput').value.toLowerCase();
    const categoria = document.getElementById('categoryFilter').value;

    const filtrados = productos.filter(p => {
        const coincideNombre = p.name.toLowerCase().includes(busqueda) || p.sku.toLowerCase().includes(busqueda);
        const coincideCategoria = categoria === "" || p.category === categoria;
        return coincideNombre && coincideCategoria;
    });

    paginaActual = 1;
    renderizarTabla(filtrados);
}

function limpiarFiltros() {
    document.getElementById('searchInput').value = '';
    document.getElementById('categoryFilter').value = '';
    paginaActual = 1;
    renderizarTabla(productos);
}

// --- FUNCIONES DE MODAL ---
function abrirModal(tipo, id = null) {
    const modal = document.getElementById('productModal');
    const form = document.getElementById('productForm');
    const titulo = document.getElementById('modalTitle');
    const skuInput = document.getElementById('skuInput');

    // Selectores basados en tu HTML
    const isOfferCheckbox = form.querySelector('input[name="isOffer"]');
    const discountInput = form.querySelector('input[name="discount"]');

    // 1. Limpieza total antes de empezar
    form.reset();
    currentImages = [];
    if (typeof renderPreviewImages === 'function') renderPreviewImages();

    // Quitar rastros de ediciones anteriores
    form.removeAttribute('data-type');
    form.removeAttribute('data-id');

    if (tipo === 'edit' && id) {
        // --- MODO EDICIÓN ---
        const p = productos.find(prod => prod.id === id);

        if (p) {
            titulo.innerText = "Editar Producto";
            form.setAttribute('data-type', 'edit');
            form.setAttribute('data-id', id);

            // Rellenar campos básicos
            form.name.value = p.name || "";
            if (skuInput) skuInput.value = p.sku || "";
            form.category.value = p.category || "";
            form.price.value = p.price || 0;
            form.stock.value = p.stock || 0;
            form.description.value = p.description || "";

            if (form.status) form.status.value = p.status || 'ACTIVE';

            // Lógica de Oferta
            if (isOfferCheckbox) {
                // p.onOffer es como se suele guardar en Firebase en tu lógica anterior
                isOfferCheckbox.checked = p.onOffer || false;
                if (discountInput) discountInput.value = p.discount || "";

                // IMPORTANTE: Llamar a toggleOferta para que aparezca el input si hay oferta
                toggleOferta();
            }

            // Cargar imágenes existentes para edición
            if (p.images && Array.isArray(p.images)) {
                currentImages = p.images.map(url => ({
                    url: url,
                    isUploaded: true,
                    progress: 100,
                    storageUrl: url
                }));
                if (typeof renderPreviewImages === 'function') renderPreviewImages();
            }
        }
    } else {
        // --- MODO NUEVO ---
        titulo.innerText = "Nuevo Producto";
        form.setAttribute('data-type', 'new');

        if (skuInput) skuInput.value = "";

        // Asegurarnos que el contenedor de oferta esté oculto al iniciar
        if (isOfferCheckbox) {
            isOfferCheckbox.checked = false;
            toggleOferta();
        }
    }

    // Mostrar el modal
    modal.classList.remove('hidden');
}

function cerrarModal() {
    document.getElementById('productModal').classList.add('hidden');
    currentImages.forEach(img => {
        if (img.url && !img.isUploaded) URL.revokeObjectURL(img.url);
    });
    currentImages = [];
    renderPreviewImages();
    document.getElementById('productForm').reset();
    document.getElementById('offerInputContainer').style.display = 'none';
}

function parsePrecio(valor) {
    // Quita símbolos y espacios 
    valor = String(valor).replace(/[^\d.,]/g, '').trim();
    // Si es "2.999,50", elimina los puntos de miles y cambia la coma por punto
    if (valor.includes(",") && valor.includes(".")) {
        valor = valor.replace(/\./g, ""); // quita puntos de miles
        valor = valor.replace(",", ".");  // cambia decimal
    } else if (valor.includes(",")) {
        valor = valor.replace(",", ".");
    }
    return parseFloat(valor) || 0;
}
// Guardar producto (Nuevo + Editar) ★★★★★
document.getElementById('productForm').onsubmit = async function (e) {
    e.preventDefault();
    const form = e.target;
    const submitBtn = form.querySelector('button[type="submit"]');

    // Identificar si es edición o nuevo
    const isEdit = form.getAttribute('data-type') === 'edit';
    const idExistente = form.getAttribute('data-id');

    // Bloquear botón para evitar múltiples clics
    submitBtn.disabled = true;
    submitBtn.innerText = "Guardando...";

    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    // 1. Procesamiento de datos y formatos
    data.sku = document.getElementById('skuInput').value;
    data.onOffer = form.isOffer ? form.isOffer.checked : false;
    data.discount = data.onOffer ? (parseInt(data.discount) || 0) : 0;

    // Limpiar precio de puntos/comas para guardar como número puro
    data.price = parsePrecio(data.price);
    data.stock = parseInt(data.stock) || 0;
    data.status = data.status || 'ACTIVE';

    try {
        // 2. Manejo de Imágenes
        // Subimos las nuevas y mantenemos las que ya estaban (storageUrl)
        let urlsFinales = await subirTodasLasImagenes(data.sku);
        data.imageUrls = urlsFinales;
        delete data.images;

        // 3. Operación en Firebase
        if (isEdit && idExistente) {
            const docRef = doc(db, "product", idExistente);
            await updateDoc(docRef, data);
        } else {
            await addDoc(collection(db, "product"), data);
        }

        // 4. Limpieza Total del Estado (Evita Duplicados)
        cerrarModal();
        form.reset();
        form.removeAttribute('data-type');
        form.removeAttribute('data-id');
        currentImages = []; // Limpiar array global de imágenes

        // 5. Notificación y Refresco
        mostrarModalExito(
            isEdit ? "¡Actualización Exitosa!" : "¡Producto Guardado!",
            isEdit ? "Los cambios se aplicaron correctamente." : "El producto ya está en tu inventario."
        );

        // Recargar la lista desde Firebase para asegurar sincronización
        productos = await cargarProductosFirebase();
        renderizarTabla();

    } catch (err) {
        console.error("Error en onsubmit:", err);
        alert("Hubo un error al procesar la solicitud: " + err.message);
    } finally {
        // Restaurar botón
        submitBtn.disabled = false;
        submitBtn.innerText = "Guardar";
    }
};

// --- MODAL DE ÉXITO ---
function mostrarModalExito(titulo = "¡Guardado exitoso!", mensaje = "El producto se ha guardado correctamente.") {
    document.getElementById('modal-success-title').innerText = titulo;
    document.getElementById('modal-success-body').innerText = mensaje;
    document.getElementById('modal-success').classList.remove('hidden');
}
function ocultarModalExito() {
    document.getElementById('modal-success').classList.add('hidden');
}

// --- OTROS HELPERS ---
function actualizarSKU() {
    const select = document.querySelector('#productForm select[name="category"]');
    let cat = select?.value?.trim() || "";
    if (!cat) {
        document.getElementById('skuInput').value = "";
        return;
    }
    // SKU: 3 letras mayúsculas de categoría sin tildes, -número 6 cifras, 4 random mayúsculas/números
    let prefix = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
    if (prefix.length < 3) prefix = (prefix + 'XXX').slice(0, 3);
    const num = Math.floor(100000 + Math.random() * 900000); // 6 cifras
    const sufijo = Math.random().toString(36).substring(2, 6).toUpperCase(); // 4 caracteres
    document.getElementById('skuInput').value = `${prefix}-${num}${sufijo}`;
}

function traducirEstado(est) {
    const m = { 'ACTIVE': 'ACTIVO', 'ACTIVO': 'ACTIVO', 'INACTIVE': 'INACTIVO', 'INACTIVO': 'INACTIVO', 'SUSPENDED': 'PAUSADO', 'PAUSADO': 'PAUSADO', 'SUSPENDIDO': 'PAUSADO' };
    return m[est.toUpperCase()] || est;
}

function getEstiloEstado(est) {
    const u = est.toUpperCase();
    if (['ACTIVE', 'ACTIVO'].includes(u)) return 'bg-emerald-100 text-emerald-600';
    if (['INACTIVE', 'INACTIVO'].includes(u)) return 'bg-slate-100 text-slate-400';
    return 'bg-red-100 text-red-600';
}

function formatearPrecio(input) {
    // Elimina cualquier carácter que no sea dígito
    let valor = input.value.replace(/[^\d]/g, "");
    if (valor === "") valor = "0";
    let n = parseFloat(valor) / 100;
    // Actualiza el valor del input usando formato europeo
    input.value = n.toLocaleString('de-DE', { minimumFractionDigits: 2 });
}

function toggleOferta() {
    // Buscamos los elementos por el ID exacto de tu HTML
    const isOfferCheckbox = document.querySelector('input[name="isOffer"]');
    const offerContainer = document.getElementById('offerInputContainer');
    const discountInput = document.querySelector('input[name="discount"]');

    if (isOfferCheckbox && offerContainer) {
        if (isOfferCheckbox.checked) {
            // Mostrar el input de descuento
            offerContainer.classList.remove('hidden');
            if (discountInput) discountInput.required = true;
        } else {
            // Ocultar el input de descuento
            offerContainer.classList.add('hidden');
            if (discountInput) {
                discountInput.required = false;
                discountInput.value = ""; // Limpiar el valor si se desactiva
            }
        }
    }
}


function suspender(id) {
    const p = productos.find(x => x.id === id);
    if (p) {
        const u = p.status.toUpperCase();
        p.status = ['SUSPENDED', 'PAUSADO', 'SUSPENDIDO'].includes(u) ? 'ACTIVE' : 'SUSPENDED';
        renderizarTabla();
    }
}

function abrirGaleria(images) {
    const lightbox = document.getElementById('lightbox');
    const mainImg = document.getElementById('lightboxImg');
    const thumbsContainer = document.getElementById('lightboxThumbs');

    mainImg.src = images[0];
    thumbsContainer.innerHTML = '';
    images.forEach((imgUrl, idx) => {
        const thumb = document.createElement('img');
        thumb.src = imgUrl;
        thumb.className = `w-16 h-16 object-cover rounded-lg cursor-pointer transition-all border-2 ${idx === 0 ? 'border-emerald-500 scale-110' : 'border-transparent opacity-60 hover:opacity-100'}`;
        thumb.onclick = (e) => {
            e.stopPropagation();
            mainImg.src = imgUrl;
            thumbsContainer.querySelectorAll('img').forEach(t => t.classList.remove('border-emerald-500', 'scale-110'));
            thumb.classList.add('border-emerald-500', 'scale-110');
        };
        thumbsContainer.appendChild(thumb);
    });
    lightbox.classList.remove('hidden');
}

function cambiarPagina(p) { paginaActual = p; aplicarFiltros(); }

function actualizarMetricas(data = productos) {
    document.getElementById('kpi-total').innerText = data.length;
    document.getElementById('kpi-active').innerText = data.filter(p => ['ACTIVE', 'ACTIVO'].includes(p.status.toUpperCase())).length;
    document.getElementById('kpi-offer').innerText = data.filter(p => p.onOffer && p.discount > 0).length;
    document.getElementById('kpi-stock').innerText = data.filter(p => p.stock === 0).length;
}

function actualizarPaginacion(total) {
    const paginas = Math.ceil(total / itemsPorPagina);
    const cont = document.getElementById('paginationControls');
    if (!cont) return;
    cont.innerHTML = '';
    for (let i = 1; i <= paginas; i++) {
        cont.innerHTML += `<button onclick="cambiarPagina(${i})" class="w-10 h-10 rounded-xl font-bold ${paginaActual === i ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:bg-slate-50'}">${i}</button>`;
    }
}

// --- EXPOSICIÓN GLOBAL (CRÍTICO PARA LOS ONCLICK EN EL HTML) ---
window.copyProductLink = copyProductLink;
window.abrirModal = abrirModal;
window.cerrarModal = cerrarModal;
window.aplicarFiltros = aplicarFiltros;
window.limpiarFiltros = limpiarFiltros;
window.formatearPrecio = formatearPrecio;
window.toggleOferta = toggleOferta;
window.actualizarSKU = actualizarSKU;
window.abrirGaleria = abrirGaleria;
window.suspender = suspender;
window.cambiarPagina = cambiarPagina;
window.ocultarModalExito = ocultarModalExito;

// --- CARGA INICIAL ---
window.onload = async () => {
    productos = await cargarProductosFirebase();
    await poblarCategorias();
    renderizarTabla();

    // LISTENERS PARA FILTRO EN TIEMPO REAL
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    if (searchInput) searchInput.addEventListener('input', aplicarFiltros);
    if (categoryFilter) categoryFilter.addEventListener('change', aplicarFiltros);
};
