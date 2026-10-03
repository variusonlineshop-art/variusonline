import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import { getFirestore, collection, getDocs, addDoc, updateDoc, doc, query, orderBy, limit, startAfter } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-firestore.js";
import { getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-storage.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-auth.js";
import { firebaseConfig } from "./firebase-config.js";

// Inicialización de Firebase
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

// Variables Globales
let productos = [];
let paginaActual = 1;
const itemsPorPagina = 20;
let sliderInterval = null;
let sortableObj = null;
let comboSortableObj = null;
let lastVisible = null;
let currentImages = []; // { file, url, isUploaded, progress, storageUrl }
let currentComboImages = [];
let compartirProductoId = null;

// ELEMENTOS DOM PARA DROPZONE DE PRODUCTO
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
        processFiles(e.dataTransfer.files, currentImages, renderPreviewImages);
    });
    fileInput.addEventListener('change', () => processFiles(fileInput.files, currentImages, renderPreviewImages));
}

// ELEMENTOS DOM PARA DROPZONE DE COMBO
const comboDropzone = document.getElementById('comboDropzone');
const comboFileInput = document.getElementById('comboFileInput');
const comboPreviewContainer = document.getElementById('comboPreviewContainer');

if (comboDropzone && comboFileInput && comboPreviewContainer) {
    comboDropzone.addEventListener('click', () => comboFileInput.click());
    comboDropzone.addEventListener('dragover', e => {
        e.preventDefault();
        comboDropzone.classList.add('dropzone-active');
    });
    comboDropzone.addEventListener('dragleave', e => {
        e.preventDefault();
        comboDropzone.classList.remove('dropzone-active');
    });
    comboDropzone.addEventListener('drop', async (e) => {
        e.preventDefault();
        comboDropzone.classList.remove('dropzone-active');
        processFiles(e.dataTransfer.files, currentComboImages, renderComboPreviewImages);
    });
    comboFileInput.addEventListener('change', () => processFiles(comboFileInput.files, currentComboImages, renderComboPreviewImages));
}

async function processFiles(fileList, targetArray, renderCallback) {
    for (let file of fileList) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 10 * 1024 * 1024) {
            alert('La imagen es muy grande (máx 10MB).');
            continue;
        }
        try {
            const compressedFile = await imageCompression(file, {
                maxSizeMB: 0.2,
                maxWidthOrHeight: 1280,
                useWebWorker: true
            });
            const localUrl = URL.createObjectURL(compressedFile);
            targetArray.push({ file: compressedFile, url: localUrl, isUploaded: false, progress: 0, storageUrl: null });
        } catch (error) {
            console.error("Error al comprimir la imagen:", error);
        }
    }
    renderCallback();
}

function renderPreviewImages() {
    if (!previewContainer) return;
    previewContainer.innerHTML = '';

    currentImages.forEach((imgObj, idx) => {
        const div = createPreviewCard(imgObj, () => {
            URL.revokeObjectURL(imgObj.url);
            currentImages.splice(idx, 1);
            renderPreviewImages();
        });
        previewContainer.appendChild(div);
    });

    if (sortableObj) sortableObj.destroy();
    if (currentImages.length > 1 && window.Sortable) {
        sortableObj = Sortable.create(previewContainer, {
            animation: 180,
            onEnd: (e) => {
                const moved = currentImages.splice(e.oldIndex, 1)[0];
                currentImages.splice(e.newIndex, 0, moved);
            }
        });
    }
}

function renderComboPreviewImages() {
    if (!comboPreviewContainer) return;
    comboPreviewContainer.innerHTML = '';

    currentComboImages.forEach((imgObj, idx) => {
        const div = createPreviewCard(imgObj, () => {
            URL.revokeObjectURL(imgObj.url);
            currentComboImages.splice(idx, 1);
            renderComboPreviewImages();
        });
        comboPreviewContainer.appendChild(div);
    });

    if (comboSortableObj) comboSortableObj.destroy();
    if (currentComboImages.length > 1 && window.Sortable) {
        comboSortableObj = Sortable.create(comboPreviewContainer, {
            animation: 180,
            onEnd: (e) => {
                const moved = currentComboImages.splice(e.oldIndex, 1)[0];
                currentComboImages.splice(e.newIndex, 0, moved);
            }
        });
    }
}

function createPreviewCard(imgObj, removeCallback) {
    const div = document.createElement('div');
    div.className = 'image-preview-card relative w-24 h-24 flex-shrink-0 rounded-lg overflow-hidden shadow border border-slate-200 flex items-center justify-center group';

    const image = document.createElement('img');
    image.className = 'object-cover w-full h-full';
    image.src = imgObj.url;
    div.appendChild(image);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Eliminar';
    btn.className = 'remove-btn absolute top-0 right-0 flex items-center justify-center w-7 h-7 rounded-br-lg rounded-tl-lg bg-red-600 text-white text-xs z-10';
    btn.innerHTML = '<i class="fas fa-times"></i>';
    btn.onclick = removeCallback;
    div.appendChild(btn);

    if (imgObj.progress && imgObj.progress < 100) {
        const progress = document.createElement('div');
        progress.className = 'absolute bottom-0 left-0 h-2 bg-blue-500 transition-all';
        progress.style.width = `${imgObj.progress}%`;
        div.appendChild(progress);
    }
    return div;
}

async function subirTodasLasImagenes(productSkuOrId, imagesArray) {
    let urlsOrdenadas = [];
    const spinner = document.getElementById('img-upload-spinner');
    if (spinner) spinner.classList.remove('hidden');

    try {
        if (!auth.currentUser) {
            await signInAnonymously(auth);
        }

        for (let i = 0; i < imagesArray.length; i++) {
            let imgObj = imagesArray[i];

            if (!imgObj.isUploaded) {
                const imgRef = storageRef(storage, `products/${productSkuOrId}/${Date.now()}_${i}.jpg`);

                await new Promise((resolve, reject) => {
                    const uploadTask = uploadBytesResumable(imgRef, imgObj.file);

                    uploadTask.on('state_changed',
                        (snap) => {
                            imgObj.progress = Math.floor((snap.bytesTransferred / snap.totalBytes) * 100);
                            renderPreviewImages();
                            renderComboPreviewImages();
                        },
                        reject,
                        async () => {
                            const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
                            imgObj.isUploaded = true;
                            imgObj.storageUrl = downloadUrl;
                            urlsOrdenadas.push(downloadUrl);
                            resolve();
                        }
                    );
                });
            } else {
                urlsOrdenadas.push(imgObj.storageUrl);
            }
        }
    } catch (e) {
        console.error("Error subiendo imágenes:", e);
        alert("Error subiendo imágenes: " + e.message);
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }

    return urlsOrdenadas;
}

// FUNCIONES DE COPIADO DE ENLACE
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
        alert('No se pudo copiar el enlace');
    }
}

// CONSULTAS A FIREBASE
async function cargarProductosFirebase(items = 50, ultimoDoc = null) {
    try {
        let q = query(
            collection(db, "product"),
            orderBy("name"),
            limit(items)
        );
        if (ultimoDoc) {
            q = query(
                collection(db, "product"),
                orderBy("name"),
                startAfter(ultimoDoc),
                limit(items)
            );
        }
        const snapshot = await getDocs(q);
        const productosData = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            
            // Compatibilidad retroactiva para descuentos antiguos e individuales
            let discounts = [];
            if (Array.isArray(data.discounts) && data.discounts.length > 0) {
                discounts = data.discounts;
            } else if (data.discount && parseInt(data.discount) > 0) {
                discounts = [{ title: "Oferta", percentage: parseInt(data.discount) }];
            }

            productosData.push({
                id: docSnap.id,
                name: data.name || "Sin nombre",
                sku: data.sku || "N/A",
                category: data.category || "General",
                price: typeof data.price === 'number' ? data.price : parsePrecio(data.price),
                stock: parseInt(data.stock || 0),
                status: (data.status || "ACTIVE").toUpperCase(),
                isCombo: data.isCombo === true || data.category === 'Combos',
                comboItems: data.comboItems || [],
                onOffer: data.onOffer === true || discounts.length > 0,
                discounts: discounts,
                discount: discounts.length > 0 ? discounts[0].percentage : 0, // Mantenemos referencia de 1er descuento para KPIs
                images: (data.imageUrls && data.imageUrls.length > 0) ? data.imageUrls : ["https://via.placeholder.com/400x300"],
                description: data.description || "",
                sharedVideo: data.sharedVideo || null
            });
        });
        lastVisible = snapshot.docs[snapshot.docs.length - 1];
        return productosData;
    } catch (error) {
        console.error("Error cargando productos desde Firebase:", error);
        return [];
    }
}

async function cargarCategoriasDesdeFirebase() {
    try {
        const categoriaRef = collection(db, "category");
        const snapshot = await getDocs(categoriaRef);
        const categorias = [];
        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            if (data.active !== false) {
                categorias.push({
                    id: docSnap.id,
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

async function poblarCategorias() {
    const categorias = await cargarCategoriasDesdeFirebase();

    const selectFiltro = document.getElementById('categoryFilter');
    if (selectFiltro) {
        selectFiltro.innerHTML = '<option value="">Todas las Categorías</option><option value="Combos">🔥 Combos / Packs</option>';
        categorias.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.name;
            option.textContent = cat.name;
            selectFiltro.appendChild(option);
        });
    }

    const selectForm = document.querySelector('#productForm select[name="category"]');
    if (selectForm) {
        selectForm.innerHTML = '';
        categorias.forEach(cat => {
            const option = document.createElement('option');
            option.value = cat.name;
            option.textContent = cat.name;
            selectForm.appendChild(option);
        });
    }
}

// GESTIÓN DE COMBOS
function abrirModalCombo(tipo = 'new', id = null) {
    const modal = document.getElementById('comboModal');
    const form = document.getElementById('comboForm');
    const title = document.getElementById('comboModalTitle');
    const skuInput = document.getElementById('comboSkuInput');

    if (!modal || !form) return;

    form.reset();
    currentComboImages = [];
    renderComboPreviewImages();

    form.removeAttribute('data-type');
    form.removeAttribute('data-id');

    poblarListaProductosCombo();

    if (tipo === 'edit' && id) {
        const combo = productos.find(p => p.id === id);
        if (combo) {
            title.innerHTML = `<span class="bg-purple-100 text-purple-600 p-2 rounded-lg"><i class="fas fa-edit"></i></span> Editar Combo`;
            form.setAttribute('data-type', 'edit');
            form.setAttribute('data-id', id);

            document.getElementById('comboName').value = combo.name || '';
            skuInput.value = combo.sku || '';
            document.getElementById('comboDescription').value = combo.description || '';
            document.getElementById('comboPrice').value = (combo.price || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 });
            document.getElementById('comboStock').value = combo.stock || 0;
            document.getElementById('comboStatus').value = combo.status || 'ACTIVE';

            // Cargar items seleccionados previamente
            if (combo.comboItems && Array.isArray(combo.comboItems)) {
                combo.comboItems.forEach(item => {
                    const check = document.querySelector(`.combo-chk[data-id="${item.productId}"]`);
                    const qtyInput = document.querySelector(`.combo-qty[data-id="${item.productId}"]`);
                    if (check) check.checked = true;
                    if (qtyInput) {
                        qtyInput.disabled = false;
                        qtyInput.value = item.quantity || 1;
                    }
                });
            }

            if (combo.images && Array.isArray(combo.images)) {
                currentComboImages = combo.images.map(url => ({
                    url: url,
                    isUploaded: true,
                    progress: 100,
                    storageUrl: url
                }));
                renderComboPreviewImages();
            }
        }
    } else {
        title.innerHTML = `<span class="bg-purple-100 text-purple-600 p-2 rounded-lg"><i class="fas fa-cubes"></i></span> Crear Nuevo Combo`;
        form.setAttribute('data-type', 'new');
        skuInput.value = `CMB-${Math.floor(100000 + Math.random() * 900000)}`;
    }

    calcularSumaCombo();
    modal.classList.remove('hidden');
}

function cerrarModalCombo() {
    const modal = document.getElementById('comboModal');
    if (modal) modal.classList.add('hidden');

    currentComboImages.forEach(img => {
        if (img.url && !img.isUploaded) URL.revokeObjectURL(img.url);
    });
    currentComboImages = [];
    renderComboPreviewImages();

    const form = document.getElementById('comboForm');
    if (form) {
        form.reset();
        form.removeAttribute('data-type');
        form.removeAttribute('data-id');
    }
}

function poblarListaProductosCombo() {
    const cont = document.getElementById('comboProductsContainer');
    if (!cont) return;

    // Filtramos productos individuales (no otros combos)
    const productosIndividuales = productos.filter(p => !p.isCombo);

    if (productosIndividuales.length === 0) {
        cont.innerHTML = `<p class="text-slate-400 text-sm text-center py-4">No hay productos disponibles para armar un combo.</p>`;
        return;
    }

    cont.innerHTML = productosIndividuales.map(p => `
        <div class="flex items-center justify-between p-2 hover:bg-slate-50 rounded-lg border border-slate-100 transition-colors">
            <div class="flex items-center gap-3">
                <input type="checkbox" value="${p.id}" data-id="${p.id}" data-price="${p.price}" onchange="toggleComboQty(this)"
                    class="combo-chk w-4 h-4 accent-purple-600 rounded cursor-pointer">
                <div class="text-sm">
                    <span class="font-medium text-slate-800">${p.name}</span>
                    <span class="text-xs text-slate-400 ml-2">($ ${(p.price || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 })})</span>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-xs text-slate-400">Cant:</span>
                <input type="number" min="1" value="1" data-id="${p.id}" disabled oninput="calcularSumaCombo()"
                    class="combo-qty w-16 px-2 py-1 text-xs text-center border border-slate-200 rounded-lg outline-none focus:ring-1 focus:ring-purple-500 disabled:bg-slate-100 disabled:text-slate-400">
            </div>
        </div>
    `).join('');
}

function toggleComboQty(chk) {
    const prodId = chk.getAttribute('data-id');
    const qtyInput = document.querySelector(`.combo-qty[data-id="${prodId}"]`);
    if (qtyInput) {
        qtyInput.disabled = !chk.checked;
        if (!chk.checked) qtyInput.value = 1;
    }
    calcularSumaCombo();
}

function calcularSumaCombo() {
    const checkboxes = document.querySelectorAll('.combo-chk:checked');
    let total = 0;

    checkboxes.forEach(chk => {
        const prodId = chk.getAttribute('data-id');
        const precio = parseFloat(chk.getAttribute('data-price')) || 0;
        const qtyInput = document.querySelector(`.combo-qty[data-id="${prodId}"]`);
        const cantidad = qtyInput ? (parseInt(qtyInput.value) || 1) : 1;
        total += (precio * cantidad);
    });

    const labelSuma = document.getElementById('comboSumText');
    if (labelSuma) {
        labelSuma.innerText = `Suma valor ind.: $ ${total.toLocaleString('de-DE', { minimumFractionDigits: 2 })}`;
    }
}

const comboForm = document.getElementById('comboForm');
if (comboForm) {
    comboForm.onsubmit = async function (e) {
        e.preventDefault();
        const submitBtn = document.getElementById('submitComboBtn');
        const isEdit = comboForm.getAttribute('data-type') === 'edit';
        const idExistente = comboForm.getAttribute('data-id');

        const checkboxes = document.querySelectorAll('.combo-chk:checked');
        if (checkboxes.length < 2) {
            alert("Por favor selecciona al menos 2 productos para conformar el combo.");
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = "Guardando Combo...";
        }

        const comboItems = [];
        checkboxes.forEach(chk => {
            const prodId = chk.getAttribute('data-id');
            const qtyInput = document.querySelector(`.combo-qty[data-id="${prodId}"]`);
            comboItems.push({
                productId: prodId,
                quantity: parseInt(qtyInput ? qtyInput.value : 1) || 1
            });
        });

        const sku = document.getElementById('comboSkuInput').value;
        const name = document.getElementById('comboName').value.trim();
        const description = document.getElementById('comboDescription').value.trim();
        const price = parsePrecio(document.getElementById('comboPrice').value);
        const stock = parseInt(document.getElementById('comboStock').value) || 0;
        const status = document.getElementById('comboStatus').value || 'ACTIVE';

        try {
            let urlsFinales = await subirTodasLasImagenes(sku, currentComboImages);

            const comboData = {
                name: name,
                sku: sku,
                category: 'Combos',
                price: price,
                stock: stock,
                status: status,
                isCombo: true,
                comboItems: comboItems,
                description: description,
                imageUrls: urlsFinales.length > 0 ? urlsFinales : ["https://via.placeholder.com/400x300"]
            };

            if (isEdit && idExistente) {
                await updateDoc(doc(db, "product", idExistente), comboData);
            } else {
                await addDoc(collection(db, "product"), comboData);
            }

            cerrarModalCombo();
            mostrarModalExito(
                isEdit ? "¡Combo Actualizado!" : "¡Combo Creado!",
                isEdit ? "Los datos del combo han sido modificados." : "El combo ya está disponible en el inventario."
            );

            productos = await cargarProductosFirebase();
            renderizarTabla();

        } catch (err) {
            console.error("Error guardando combo:", err);
            alert("Hubo un error al guardar el combo: " + err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = "Guardar Combo";
            }
        }
    };
}

// COMPARTIR PRODUCTO (MODAL Y PREVIEW)
function abrirModalCompartir(id) {
    compartirProductoId = id;
    const p = productos.find(pr => pr.id === id);
    let red = '';
    let videoUrl = '';
    if (p && p.sharedVideo) {
        red = p.sharedVideo.network || '';
        videoUrl = p.sharedVideo.url || '';
    }
    const selectRed = document.getElementById('selectRedSocial');
    const inputUrl = document.getElementById('inputUrlVideo');
    if (selectRed) selectRed.value = red;
    if (inputUrl) inputUrl.value = videoUrl;

    renderPrevisualizacionVideo();
    document.getElementById('modal-compartir').classList.remove('hidden');
}

function cerrarModalCompartir() {
    compartirProductoId = null;
    document.getElementById('modal-compartir').classList.add('hidden');
}

function renderPrevisualizacionVideo() {
    const selectRed = document.getElementById('selectRedSocial');
    const inputUrl = document.getElementById('inputUrlVideo');
    const cont = document.getElementById('previewVideoContainer');

    if (!cont) return;
    const red = selectRed ? selectRed.value : '';
    const url = inputUrl ? inputUrl.value.trim() : '';

    if (!url || !red) {
        cont.innerHTML = '<span class="text-slate-400">Previsualización del video...</span>';
        return;
    }

    cont.innerHTML = '<span class="text-slate-400">Cargando previsualización...</span>';

    try {
        if (red === 'youtube') {
            let videoId = null;
            let matchNormal = url.match(/(?:youtube\.com.*(?:\?|&)v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
            let matchShort = url.match(/(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i);

            if (matchNormal && matchNormal[1]) videoId = matchNormal[1];
            else if (matchShort && matchShort[1]) videoId = matchShort[1];

            if (videoId) {
                cont.innerHTML = `<iframe width="100%" height="320" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen class="rounded-xl"></iframe>`;
            } else {
                cont.innerHTML = '<span class="text-slate-400">URL de YouTube no válida</span>';
            }
        } else if (red === 'facebook') {
            cont.innerHTML = `<iframe src="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=0&width=560" width="100%" height="230" style="border:none;overflow:hidden" scrolling="no" frameborder="0" allowfullscreen class="rounded-xl"></iframe>`;
        } else if (red === 'instagram') {
            cont.innerHTML = `
            <blockquote class="instagram-media" data-instgrm-permalink="${url}" data-instgrm-version="14" style="width:100%; min-width:200px; max-width:500px; margin:auto;">
                <a href="${url}" target="_blank" rel="noopener">Ver en Instagram</a>
            </blockquote>
            `;
            if (window.instgrm) setTimeout(() => window.instgrm.Embeds.process(), 100);
        }
    } catch (err) {
        cont.innerHTML = '<span class="text-red-500">Error al cargar la previsualización.</span>';
        console.error('Error renderizando video:', err);
    }
}

const formCompartir = document.getElementById('formCompartir');
if (formCompartir) {
    formCompartir.onsubmit = async function (e) {
        e.preventDefault();
        if (!compartirProductoId) return;

        const red = document.getElementById('selectRedSocial').value;
        const url = document.getElementById('inputUrlVideo').value.trim();

        const sharedVideo = { network: red, url: url };

        try {
            await updateDoc(doc(db, "product", compartirProductoId), { sharedVideo });
            const p = productos.find(prod => prod.id === compartirProductoId);
            if (p) p.sharedVideo = sharedVideo;

            cerrarModalCompartir();
            mostrarModalExito("¡Video guardado!", "La información de video para compartir se ha actualizado.");
        } catch (err) {
            console.error("Error guardando video:", err);
            alert("No se pudo guardar la información del video.");
        }
    };
}

// RENDERIZADO DE TABLA E INTERFAZ
function renderizarTabla(datos = productos) {
    const tbody = document.getElementById('productTableBody');
    if (!tbody) return;

    if (sliderInterval) clearInterval(sliderInterval);

    const inicio = (paginaActual - 1) * itemsPorPagina;
    const fin = inicio + itemsPorPagina;
    const dataPagina = datos.slice(inicio, fin);

    tbody.innerHTML = '';

    if (dataPagina.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-slate-400">No se encontraron productos</td></tr>`;
        actualizarPaginacion(0);
        actualizarMetricas(datos);
        return;
    }

    dataPagina.forEach(p => {
        let claseFila = '';
        const statusU = p.status.toUpperCase();
        if (['SUSPENDED', 'PAUSADO', 'SUSPENDIDO'].includes(statusU)) claseFila = 'row-suspended';
        else if (p.stock === 0) claseFila = 'row-out-of-stock';
        else if (p.stock < 5) claseFila = 'row-low-stock';

        const fotosHTML = p.images.map((img, idx) =>
            `<img src="${img}" class="${idx === 0 ? 'active' : ''} w-12 h-12 rounded-lg object-cover absolute top-0 left-0 transition-opacity duration-1000">`
        ).join('');

        const comboBadge = p.isCombo ? `<span class="bg-purple-100 text-purple-700 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase ml-2"><i class="fas fa-cubes"></i> Combo</span>` : '';

        // Badges de múltiples descuentos
        let descuentosHTML = '';
        if (p.onOffer && p.discounts && p.discounts.length > 0) {
            descuentosHTML = p.discounts.map(d => 
                `<span class="inline-block bg-emerald-50 text-emerald-600 border border-emerald-100 text-[10px] font-bold px-1.5 py-0.5 rounded mr-1 mt-0.5">
                    ${d.title ? d.title + ': ' : ''}-${d.percentage}%
                </span>`
            ).join('');
        }

        tbody.innerHTML += `
            <tr class="border-b border-slate-50 transition-all ${claseFila}">
                <td class="px-6 py-4">
                    <div class="flex items-center gap-4">
                        <div class="img-slider relative w-12 h-12 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg shadow-sm" 
                             onclick='abrirGaleria(${JSON.stringify(p.images)})'>
                            ${fotosHTML}
                        </div>
                        <div>
                            <div class="font-medium text-slate-800 flex items-center gap-1">${p.name} ${comboBadge}</div>
                            <div class="text-[10px] text-slate-400 font-bold uppercase">${p.sku}</div>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4 text-slate-500 text-sm font-medium">${p.category}</td>
                <td class="px-6 py-4">
                    <div class="font-bold text-slate-800">$ ${(typeof p.price === 'number' ? p.price : 0).toLocaleString('de-DE', { minimumFractionDigits: 2 })}</div>
                    ${descuentosHTML}
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

                        <button onclick="${p.isCombo ? `abrirModalCombo('edit', '${p.id}')` : `abrirModal('edit', '${p.id}')`}" title="Editar producto/combo" class="admin-only w-8 h-8 rounded-lg bg-blue-50 text-blue-500 hover:bg-blue-500 hover:text-white transition-all"><i class="fas fa-pen text-xs"></i></button>                        
                        
                        <button onclick="abrirModalCompartir('${p.id}')" title="Compartir producto" class="admin-only w-8 h-8 rounded-lg bg-yellow-50 text-yellow-500 hover:bg-yellow-400 hover:text-white transition-all">
                            <i class="fas fa-share-alt text-xs"></i>
                        </button>
                        
                        <button onclick="suspender('${p.id}')" title="Pausar / Activar" class="admin-only w-8 h-8 rounded-lg bg-red-50 text-red-400 hover:bg-red-500 hover:text-white transition-all"><i class="fas fa-ban text-xs"></i></button>
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
            if (activeIdx === -1) activeIdx = 0;

            imgs[activeIdx].classList.remove('active');
            imgs[activeIdx].style.opacity = "0";

            let nextIdx = (activeIdx + 1) % imgs.length;
            imgs[nextIdx].classList.add('active');
            imgs[nextIdx].style.opacity = "1";
        });
    }, 3000);
}

function aplicarFiltros() {
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');

    const busqueda = searchInput ? searchInput.value.toLowerCase() : '';
    const categoria = categoryFilter ? categoryFilter.value : '';

    const filtrados = productos.filter(p => {
        const coincideNombre = p.name.toLowerCase().includes(busqueda) || p.sku.toLowerCase().includes(busqueda);
        const coincideCategoria = categoria === "" || (categoria === "Combos" ? p.isCombo : p.category === categoria);
        return coincideNombre && coincideCategoria;
    });

    paginaActual = 1;
    renderizarTabla(filtrados);
}

function limpiarFiltros() {
    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    if (searchInput) searchInput.value = '';
    if (categoryFilter) categoryFilter.value = '';
    paginaActual = 1;
    renderizarTabla(productos);
}

// CONTROL DE MODALES Y FORMULARIO DE PRODUCTO INDIVIDUAL
function abrirModal(tipo, id = null) {
    const modal = document.getElementById('productModal');
    const form = document.getElementById('productForm');
    const titulo = document.getElementById('modalTitle');
    const skuInput = document.getElementById('skuInput');

    if (!modal || !form) return;

    form.reset();
    currentImages = [];
    renderPreviewImages();

    form.removeAttribute('data-type');
    form.removeAttribute('data-id');

    const isOfferCheckbox = form.querySelector('input[name="isOffer"]');

    if (tipo === 'edit' && id) {
        const p = productos.find(prod => prod.id === id);
        if (p) {
            titulo.innerText = "Editar Producto";
            form.setAttribute('data-type', 'edit');
            form.setAttribute('data-id', id);

            if (form.name) form.name.value = p.name || "";
            if (skuInput) skuInput.value = p.sku || "";
            if (form.category) form.category.value = p.category || "";
            if (form.price) form.price.value = (p.price || 0).toLocaleString('de-DE', { minimumFractionDigits: 2 });
            if (form.stock) form.stock.value = p.stock || 0;
            if (form.description) form.description.value = p.description || "";
            if (form.status) form.status.value = p.status || 'ACTIVE';

            if (isOfferCheckbox) {
                isOfferCheckbox.checked = p.onOffer || false;
                toggleOferta();
                renderizarLineasDescuento(p.discounts || []);
            }

            if (p.images && Array.isArray(p.images)) {
                currentImages = p.images.map(url => ({
                    url: url,
                    isUploaded: true,
                    progress: 100,
                    storageUrl: url
                }));
                renderPreviewImages();
            }
        }
    } else {
        titulo.innerText = "Nuevo Producto";
        form.setAttribute('data-type', 'new');
        if (skuInput) skuInput.value = "";

        if (isOfferCheckbox) {
            isOfferCheckbox.checked = false;
            toggleOferta();
        }
        renderizarLineasDescuento([]);
        actualizarSKU();
    }

    modal.classList.remove('hidden');
}

function cerrarModal() {
    const modal = document.getElementById('productModal');
    if (modal) modal.classList.add('hidden');

    currentImages.forEach(img => {
        if (img.url && !img.isUploaded) URL.revokeObjectURL(img.url);
    });
    currentImages = [];
    renderPreviewImages();

    const form = document.getElementById('productForm');
    if (form) {
        form.reset();
        form.removeAttribute('data-type');
        form.removeAttribute('data-id');
    }

    const offerContainer = document.getElementById('offerInputContainer');
    if (offerContainer) offerContainer.classList.add('hidden');
}

// FUNCIONES DE MANEJO DE MÚLTIPLES DESCUENTOS
function renderizarLineasDescuento(discounts = []) {
    const container = document.getElementById('discountsListContainer');
    if (!container) return;
    container.innerHTML = '';

    if (discounts.length === 0) {
        agregarLineaDescuento();
    } else {
        discounts.forEach(d => agregarLineaDescuento(d.title, d.percentage));
    }
}

function agregarLineaDescuento(titulo = '', porcentaje = '') {
    const container = document.getElementById('discountsListContainer');
    if (!container) return;

    const div = document.createElement('div');
    div.className = 'discount-row flex items-center gap-2 bg-white p-2 border border-slate-200 rounded-xl';
    div.innerHTML = `
        <input type="text" placeholder="Ej. Mayorista" value="${titulo}"
            class="discount-title text-xs w-1/2 px-3 py-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-emerald-500">
        <div class="relative w-1/2">
            <input type="number" min="1" max="100" placeholder="15" value="${porcentaje}"
                class="discount-percentage text-xs w-full pl-3 pr-6 py-2 rounded-lg border border-slate-200 outline-none focus:ring-1 focus:ring-emerald-500">
            <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">%</span>
        </div>
        <button type="button" onclick="eliminarLineaDescuento(this)"
            class="text-red-400 hover:text-red-600 px-2 py-1 text-sm transition-colors">
            <i class="fas fa-trash-alt"></i>
        </button>
    `;
    container.appendChild(div);
}

function eliminarLineaDescuento(btn) {
    const row = btn.closest('.discount-row');
    if (row) row.remove();
}

function obtenerListaDescuentos() {
    const rows = document.querySelectorAll('#discountsListContainer .discount-row');
    const list = [];
    rows.forEach(r => {
        const titleInput = r.querySelector('.discount-title');
        const percentageInput = r.querySelector('.discount-percentage');

        const title = titleInput ? titleInput.value.trim() : '';
        const percentage = percentageInput ? parseInt(percentageInput.value) || 0 : 0;

        if (percentage > 0) {
            list.push({ title, percentage });
        }
    });
    return list;
}

function parsePrecio(valor) {
    if (typeof valor === 'number') return valor;
    valor = String(valor).replace(/[^\d.,]/g, '').trim();
    if (valor.includes(",") && valor.includes(".")) {
        valor = valor.replace(/\./g, "").replace(",", ".");
    } else if (valor.includes(",")) {
        valor = valor.replace(",", ".");
    }
    return parseFloat(valor) || 0;
}

const productForm = document.getElementById('productForm');
if (productForm) {
    productForm.onsubmit = async function (e) {
        e.preventDefault();
        const form = e.target;
        const submitBtn = document.getElementById('submitBtn');

        const isEdit = form.getAttribute('data-type') === 'edit';
        const idExistente = form.getAttribute('data-id');

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerText = "Guardando...";
        }

        const formData = new FormData(form);
        const data = Object.fromEntries(formData.entries());

        data.sku = document.getElementById('skuInput').value;
        data.onOffer = form.isOffer ? form.isOffer.checked : false;

        // Procesar lista de múltiples descuentos
        const discountsList = data.onOffer ? obtenerListaDescuentos() : [];
        data.discounts = discountsList;
        data.discount = discountsList.length > 0 ? discountsList[0].percentage : 0; // Mantenemos retrocompatibilidad

        data.price = parsePrecio(data.price);
        data.stock = parseInt(data.stock) || 0;
        data.status = data.status || 'ACTIVE';
        data.isCombo = false;

        try {
            let urlsFinales = await subirTodasLasImagenes(data.sku, currentImages);
            data.imageUrls = urlsFinales;
            delete data.images;

            if (isEdit && idExistente) {
                const docRef = doc(db, "product", idExistente);
                await updateDoc(docRef, data);
            } else {
                await addDoc(collection(db, "product"), data);
            }

            cerrarModal();

            mostrarModalExito(
                isEdit ? "¡Actualización Exitosa!" : "¡Producto Guardado!",
                isEdit ? "Los cambios se aplicaron correctamente." : "El producto ya está en tu inventario."
            );

            productos = await cargarProductosFirebase();
            renderizarTabla();

        } catch (err) {
            console.error("Error al guardar producto:", err);
            alert("Hubo un error al procesar la solicitud: " + err.message);
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerText = "Guardar Producto";
            }
        }
    };
}

// HELPERS Y NOTIFICACIONES
function mostrarModalExito(titulo = "¡Guardado exitoso!", mensaje = "El producto se ha guardado correctamente.") {
    const titleElem = document.getElementById('modal-success-title');
    const bodyElem = document.getElementById('modal-success-body');
    const modalElem = document.getElementById('modal-success');

    if (titleElem) titleElem.innerText = titulo;
    if (bodyElem) bodyElem.innerText = mensaje;
    if (modalElem) modalElem.classList.remove('hidden');
}

function ocultarModalExito() {
    const modalElem = document.getElementById('modal-success');
    if (modalElem) modalElem.classList.add('hidden');
}

function actualizarSKU() {
    const select = document.querySelector('#productForm select[name="category"]');
    let cat = select?.value?.trim() || "";
    if (!cat) {
        document.getElementById('skuInput').value = "";
        return;
    }
    let prefix = cat.normalize("NFD").replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 3);
    if (prefix.length < 3) prefix = (prefix + 'XXX').slice(0, 3);
    const num = Math.floor(100000 + Math.random() * 900000);
    const sufijo = Math.random().toString(36).substring(2, 6).toUpperCase();
    document.getElementById('skuInput').value = `${prefix}-${num}${sufijo}`;
}

function traducirEstado(est) {
    if (!est) return 'ACTIVO';
    const m = { 'ACTIVE': 'ACTIVO', 'ACTIVO': 'ACTIVO', 'INACTIVE': 'INACTIVO', 'INACTIVO': 'INACTIVO', 'SUSPENDED': 'PAUSADO', 'PAUSADO': 'PAUSADO', 'SUSPENDIDO': 'PAUSADO' };
    return m[est.toUpperCase()] || est;
}

function getEstiloEstado(est) {
    if (!est) return 'bg-emerald-100 text-emerald-600';
    const u = est.toUpperCase();
    if (['ACTIVE', 'ACTIVO'].includes(u)) return 'bg-emerald-100 text-emerald-600';
    if (['INACTIVE', 'INACTIVO'].includes(u)) return 'bg-slate-100 text-slate-400';
    return 'bg-red-100 text-red-600';
}

function formatearPrecio(input) {
    let valor = input.value.replace(/[^\d]/g, "");
    if (valor === "") valor = "0";
    let n = parseFloat(valor) / 100;
    input.value = n.toLocaleString('de-DE', { minimumFractionDigits: 2 });
}

function toggleOferta() {
    const isOfferCheckbox = document.querySelector('input[name="isOffer"]');
    const offerContainer = document.getElementById('offerInputContainer');

    if (isOfferCheckbox && offerContainer) {
        if (isOfferCheckbox.checked) {
            offerContainer.classList.remove('hidden');
        } else {
            offerContainer.classList.add('hidden');
        }
    }
}

async function suspender(id) {
    const p = productos.find(x => x.id === id);
    if (p) {
        const u = p.status.toUpperCase();
        const nuevoEstado = ['SUSPENDED', 'PAUSADO', 'SUSPENDIDO'].includes(u) ? 'ACTIVE' : 'SUSPENDED';
        p.status = nuevoEstado;

        try {
            await updateDoc(doc(db, "product", id), { status: nuevoEstado });
            renderizarTabla();
        } catch (err) {
            console.error("Error al actualizar estado:", err);
            alert("No se pudo actualizar el estado en Firebase");
        }
    }
}

function abrirGaleria(images) {
    const lightbox = document.getElementById('lightbox');
    const mainImg = document.getElementById('lightboxImg');
    const thumbsContainer = document.getElementById('lightboxThumbs');

    if (!lightbox || !mainImg || !thumbsContainer) return;

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

function cambiarPagina(p) {
    paginaActual = p;
    aplicarFiltros();
}

function actualizarMetricas(data = productos) {
    const totalElem = document.getElementById('kpi-total');
    const activeElem = document.getElementById('kpi-active');
    const offerElem = document.getElementById('kpi-offer');
    const stockElem = document.getElementById('kpi-stock');

    if (totalElem) totalElem.innerText = data.length;
    if (activeElem) activeElem.innerText = data.filter(p => ['ACTIVE', 'ACTIVO'].includes(p.status.toUpperCase())).length;
    if (offerElem) offerElem.innerText = data.filter(p => p.onOffer && ((p.discounts && p.discounts.length > 0) || p.discount > 0)).length;
    if (stockElem) stockElem.innerText = data.filter(p => p.stock === 0).length;
}

function actualizarPaginacion(total) {
    const paginas = Math.ceil(total / itemsPorPagina);
    const cont = document.getElementById('paginationControls');
    const info = document.getElementById('paginationInfo');

    if (info) {
        const inicio = total === 0 ? 0 : (paginaActual - 1) * itemsPorPagina + 1;
        const fin = Math.min(paginaActual * itemsPorPagina, total);
        info.innerText = `Mostrando ${inicio} a ${fin} de ${total} resultados`;
    }

    if (!cont) return;
    cont.innerHTML = '';

    for (let i = 1; i <= paginas; i++) {
        cont.innerHTML += `<button onclick="cambiarPagina(${i})" class="w-10 h-10 rounded-xl font-bold ${paginaActual === i ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:bg-slate-50'}">${i}</button>`;
    }
}

// EXPOSICIÓN A SCOPE GLOBAL
window.copyProductLink = copyProductLink;
window.abrirModal = abrirModal;
window.cerrarModal = cerrarModal;
window.abrirModalCombo = abrirModalCombo;
window.cerrarModalCombo = cerrarModalCombo;
window.toggleComboQty = toggleComboQty;
window.calcularSumaCombo = calcularSumaCombo;
window.aplicarFiltros = aplicarFiltros;
window.limpiarFiltros = limpiarFiltros;
window.formatearPrecio = formatearPrecio;
window.toggleOferta = toggleOferta;
window.agregarLineaDescuento = agregarLineaDescuento;
window.eliminarLineaDescuento = eliminarLineaDescuento;
window.actualizarSKU = actualizarSKU;
window.abrirGaleria = abrirGaleria;
window.suspender = suspender;
window.cambiarPagina = cambiarPagina;
window.ocultarModalExito = ocultarModalExito;
window.abrirModalCompartir = abrirModalCompartir;
window.cerrarModalCompartir = cerrarModalCompartir;

// CARGA INICIAL
window.addEventListener('DOMContentLoaded', async () => {
    await poblarCategorias();
    productos = await cargarProductosFirebase();
    renderizarTabla();

    const searchInput = document.getElementById('searchInput');
    const categoryFilter = document.getElementById('categoryFilter');
    if (searchInput) searchInput.addEventListener('input', aplicarFiltros);
    if (categoryFilter) categoryFilter.addEventListener('change', aplicarFiltros);

    const selectRed = document.getElementById('selectRedSocial');
    const inputUrl = document.getElementById('inputUrlVideo');
    if (selectRed) selectRed.addEventListener('change', renderPrevisualizacionVideo);
    if (inputUrl) inputUrl.addEventListener('input', renderPrevisualizacionVideo);
});
