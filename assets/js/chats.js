import { initializeApp, getApp, getApps } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-app.js";
import {
    getFirestore,
    collection,
    onSnapshot,
    addDoc,
    query,
    orderBy,
    doc,
    serverTimestamp,
    updateDoc
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { firebaseConfig } from './firebase-config.js';

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getFirestore(app);

const EMOJI_DATA = [
    { category: 'Smileys', icon: '😊', emojis: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😋', '😜', '😎', '🥳', '🤔', '😴'] },
    { category: 'Corazones', icon: '❤️', emojis: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗'] },
    { category: 'Objetos', icon: '💡', emojis: ['📦', '🛒', '📱', '💻', '⏰', '💡', '💸', '💰', '💳', '💎', '🛠', '🔑'] }
];

let contactsList = [];
let activeContactKey = null;
let unsubscribeMessages = null;
let replyingToMessage = null;
let activeMenuMsgId = null;

let currentPage = 1;
const itemsPerPage = 10;

const chatListAsideEl = document.getElementById('chat-list');
const contactListEl = document.getElementById('contact-list');
const chatPanelEl = document.getElementById('chat-panel');
const chatHeaderEl = document.getElementById('chat-header');
const messagesContainerEl = document.getElementById('messages-container');
const chatInputEl = document.getElementById('chat-input');
const sendBtnEl = document.getElementById('send-btn');
const emojiBtnEl = document.getElementById('emoji-btn');
const contactSearchEl = document.getElementById('contact-search');
const emojiPickerEl = document.getElementById('emoji-picker');
const emojiCategoriesEl = document.getElementById('emoji-categories');
const emojiGridEl = document.getElementById('emoji-grid');

function init() {
    const urlParams = new URLSearchParams(window.location.search);
    const targetOrderId = urlParams.get('orderId');
    const targetPhone = urlParams.get('phone');

    listenToOrders(targetOrderId, targetPhone);
    renderEmojiPicker();
    setupEventListeners();
}

function listenToOrders(targetOrderId, targetPhone) {
    const ordersRef = collection(db, "orders");
    
    onSnapshot(ordersRef, (snapshot) => {
        const rawOrdersMap = new Map();

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            const customerName = (data.customerData?.Customname || data.customerData?.name || data.customerName || data.name || "Cliente sin nombre").trim();
            const phone = (data.customerData?.phone || data.phone || "Sintelefono").trim();
            const address = data.customerData?.readable_address || data.customerData?.address || "No especificada";
            const dateFormatted = data.created_at || data.createdAt || new Date().toLocaleString('es-ES');
            
            const orderObj = {
                id: docSnap.id,
                name: customerName,
                phone: phone,
                address: address,
                date: dateFormatted,
                status: data.status || 'Asignado',
                lastMsg: data.lastMessage || 'Pedido registrado',
                cartToken: data.cartToken || docSnap.id.substring(0, 6).toUpperCase(),
                total: parseFloat(data.total || 0).toFixed(2),
                items: data.items || []
            };

            const contactKey = `${phone}_${customerName.toLowerCase()}`;

            if (!rawOrdersMap.has(contactKey)) {
                rawOrdersMap.set(contactKey, {
                    key: contactKey,
                    name: customerName,
                    phone: phone,
                    avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(customerName)}&background=2563eb&color=fff`,
                    orders: []
                });
            }
            rawOrdersMap.get(contactKey).orders.push(orderObj);
        });

        contactsList = Array.from(rawOrdersMap.values());
        contactsList.forEach(c => c.orders.sort((a, b) => new Date(b.date) - new Date(a.date)));
        contactsList.sort((a, b) => b.orders.length - a.orders.length);

        applyFiltersAndRender();

        if (targetOrderId) {
            const found = contactsList.find(c => c.orders.some(o => o.id === targetOrderId));
            if (found) setActiveContact(found.key);
        } else if (targetPhone) {
            const found = contactsList.find(c => c.phone.includes(targetPhone));
            if (found) setActiveContact(found.key);
            else if (!activeContactKey && contactsList.length > 0) setActiveContact(contactsList[0].key);
        } else if (!activeContactKey && contactsList.length > 0) {
            setActiveContact(contactsList[0].key);
        }
    });
}

function applyFiltersAndRender() {
    const q = (contactSearchEl.value || '').trim().toLowerCase();
    const filtered = contactsList.filter(c => 
        !q || c.name.toLowerCase().includes(q) || c.phone.includes(q) || 
        c.orders.some(o => o.cartToken.toLowerCase().includes(q) || o.id.toLowerCase().includes(q))
    );

    const totalPages = Math.ceil(filtered.length / itemsPerPage) || 1;
    if (currentPage > totalPages) currentPage = totalPages;

    const start = (currentPage - 1) * itemsPerPage;
    renderContactList(filtered.slice(start, start + itemsPerPage));
    renderPaginationControls(totalPages);
}

function renderContactList(items) {
    if (items.length === 0) {
        contactListEl.innerHTML = `<div class="p-6 text-center text-gray-400 text-xs">No se encontraron clientes.</div>`;
        return;
    }

    contactListEl.innerHTML = items.map(contact => {
        const active = activeContactKey === contact.key;
        return `
            <div data-key="${contact.key}" class="contact-item flex items-center gap-3 p-4 cursor-pointer transition-all hover:bg-gray-50 border-l-4 ${active ? 'bg-blue-50/60 border-blue-600' : 'border-transparent'}">
                <img src="${contact.avatar}" alt="${contact.name}" class="w-10 h-10 rounded-full object-cover shrink-0">
                <div class="flex-1 min-w-0">
                    <div class="flex justify-between items-center mb-1">
                        <h4 class="font-bold text-xs text-gray-800 truncate">${contact.name}</h4>
                        <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">${contact.orders.length} pedidos</span>
                    </div>
                    <p class="text-xs text-gray-400 truncate">${contact.orders[0].lastMsg}</p>
                </div>
            </div>
        `;
    }).join('');

    contactListEl.querySelectorAll('.contact-item').forEach(el => {
        el.addEventListener('click', () => onContactClick(el.dataset.key));
    });
}

function renderPaginationControls(totalPages) {
    let paginationContainer = document.getElementById('chat-pagination');
    if (!paginationContainer) {
        paginationContainer = document.createElement('div');
        paginationContainer.id = 'chat-pagination';
        paginationContainer.className = 'p-3 border-t border-gray-100 bg-white flex items-center justify-center gap-1 shrink-0';
        chatListAsideEl.appendChild(paginationContainer);
    }
    if (totalPages <= 1) { paginationContainer.innerHTML = ''; return; }

    let pagesHtml = `<button data-page="${currentPage - 1}" ${currentPage === 1 ? 'disabled' : ''} class="w-8 h-8 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 disabled:opacity-35 flex items-center justify-center"><i class="fa-solid fa-chevron-left"></i></button>`;
    for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || (i >= currentPage - 1 && i <= currentPage + 1)) {
            pagesHtml += `<button data-page="${i}" class="w-8 h-8 rounded-xl text-xs font-bold transition-all flex items-center justify-center ${i === currentPage ? 'bg-blue-600 text-white shadow-md shadow-blue-200' : 'border border-gray-200 text-gray-600'}">${i}</button>`;
        }
    }
    pagesHtml += `<button data-page="${currentPage + 1}" ${currentPage === totalPages ? 'disabled' : ''} class="w-8 h-8 rounded-xl border border-gray-200 text-xs font-bold text-gray-600 disabled:opacity-35 flex items-center justify-center"><i class="fa-solid fa-chevron-right"></i></button>`;
    
    paginationContainer.innerHTML = pagesHtml;
    paginationContainer.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = parseInt(btn.dataset.page);
            if (p >= 1 && p <= totalPages) { currentPage = p; applyFiltersAndRender(); }
        });
    });
}

function onContactClick(key) {
    setActiveContact(key);
    if (window.innerWidth < 768) {
        chatListAsideEl.classList.add('hidden');
        chatPanelEl.classList.remove('hidden');
    }
}

function setActiveContact(key) {
    activeContactKey = key;
    cancelReply();
    applyFiltersAndRender();
    renderChatHeader();
    const contact = contactsList.find(c => c.key === key);
    if (contact && contact.orders.length > 0) listenToMessages(contact.orders[0].id, true);
}

function renderChatHeader() {
    const contact = contactsList.find(c => c.key === activeContactKey);
    if (!contact) return;

    chatHeaderEl.innerHTML = `
        <div class="flex items-center gap-3">
            <button id="back-to-list" class="md:hidden text-gray-400 hover:text-gray-600 p-2 rounded-xl bg-gray-100">
                <i class="fa-solid fa-arrow-left text-sm"></i>
            </button>
            <img src="${contact.avatar}" class="w-10 h-10 rounded-full object-cover">
            <div>
                <h3 class="font-bold text-gray-800 text-sm leading-tight">${contact.name}</h3>
                <div class="text-[11px] text-gray-400 flex items-center gap-2 mt-0.5">
                    <span>${contact.phone || 'Sin teléfono'}</span> • 
                    <span class="text-blue-600 font-bold">Historial de ${contact.orders.length} pedidos</span>
                </div>
            </div>
        </div>
        <div class="flex items-center gap-2">
            <a href="tel:${contact.phone}" class="w-9 h-9 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-all shadow-sm" title="Llamar">
                <i class="fa-solid fa-phone text-xs"></i>
            </a>
        </div>
    `;

    const backBtn = document.getElementById('back-to-list');
    if (backBtn) backBtn.addEventListener('click', () => {
        chatPanelEl.classList.add('hidden'); chatPanelEl.classList.remove('flex'); chatListAsideEl.classList.remove('hidden');
    });
}

function buildOrderCardHtml(order) {
    const productsHtml = (order.items || []).map(item => `
        <div class="flex justify-between items-start gap-2 py-1 text-slate-700">
            <span>📦 <strong>${item.quantity || 1}x</strong> ${escapeHtml(item.name)}</span>
            <span class="font-bold shrink-0">$${parseFloat(item.price || 0).toFixed(2)}</span>
        </div>
    `).join('');

    const isMenuOpen = activeMenuMsgId === `order-${order.id}`;

    return `
        <div id="msg-target-order-${order.id}" class="bg-white border border-blue-100 rounded-2xl p-4 shadow-sm space-y-3 font-sans text-xs text-slate-800 mb-4 relative group transition-all duration-300">
            
            <button onclick="window.toggleMsgMenu('order-${order.id}', event)" class="absolute top-3 right-3 w-7 h-7 rounded-full bg-gray-50 border border-gray-200 text-gray-500 hover:text-gray-800 flex items-center justify-center shadow-xs transition-all z-20" title="Opciones de pedido">
                <i class="fa-solid fa-ellipsis-vertical text-xs"></i>
            </button>

            <div id="msg-menu-order-${order.id}" class="${isMenuOpen ? 'block' : 'hidden'} absolute right-3 top-11 z-50 w-36 bg-white border border-gray-100 rounded-2xl shadow-2xl overflow-hidden py-1 text-gray-700 text-left font-normal">
                <button onclick="window.actionReply('order-${order.id}', 'Pedido Varius (Ref: ${order.cartToken}) - Total: \$${order.total}')" class="w-full px-4 py-2.5 text-xs flex items-center gap-2.5 hover:bg-gray-50 transition-colors">
                    <i class="fa-solid fa-reply text-blue-600"></i> Responder
                </button>
            </div>

            <div class="border-b border-slate-100 pb-2 flex justify-between items-center pr-8">
                <span class="font-black text-blue-600 uppercase tracking-wide">📦 PEDIDO VARIUS</span>
                <span class="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold text-[10px]">Ref: ${order.cartToken} (${order.status})</span>
            </div>
            <div class="text-[11px] text-slate-500 space-y-0.5">
                <p><strong>Orden ID:</strong> ${order.id}</p>
                <p><strong>Fecha:</strong> ${order.date}</p>
            </div>
            <div class="bg-slate-50 p-2.5 rounded-xl space-y-1 text-slate-600">
                <p class="font-bold text-slate-800 flex items-center gap-1"><i class="fa-solid fa-user text-blue-500"></i> DATOS DEL CLIENTE:</p>
                <p><strong>Nombre:</strong> ${escapeHtml(order.name)}</p>
                <p><strong>Teléfono:</strong> ${escapeHtml(order.phone)}</p>
                <p><strong>Dirección:</strong> ${escapeHtml(order.address)}</p>
            </div>
            <div class="space-y-1">
                <p class="font-bold text-slate-800 flex items-center gap-1"><i class="fa-solid fa-cart-shopping text-blue-500"></i> PRODUCTOS:</p>
                <div class="divide-y divide-slate-50 pl-1">${productsHtml}</div>
            </div>
            <div class="pt-2 border-t border-slate-100 flex justify-between items-center text-sm font-black text-slate-900">
                <span>💰 TOTAL:</span><span class="text-blue-600 text-base">$${order.total}</span>
            </div>
        </div>
    `;
}

function listenToMessages(orderId, scrollToBottom = false) {
    if (unsubscribeMessages) unsubscribeMessages();
    const contact = contactsList.find(c => c.key === activeContactKey);
    if (!contact) return;

    const messagesRef = collection(db, "orders", contact.orders[0].id, "chats");
    unsubscribeMessages = onSnapshot(query(messagesRef, orderBy("timestamp", "asc")), (snapshot) => {
        const msgs = [];
        snapshot.forEach((docSnap) => msgs.push({ id: docSnap.id, ...docSnap.data() }));
        renderMessages(contact.orders, msgs, scrollToBottom);
    });
}

function renderMessages(orders, msgs, scrollToBottom = false) {
    let contentHtml = '';
    orders.forEach(order => { contentHtml += `<div class="flex justify-center"><div class="w-full max-w-lg">${buildOrderCardHtml(order)}</div></div>`; });

    contentHtml += msgs.map(msg => {
        const isMe = msg.isMe;
        const timeStr = msg.timestamp ? new Date(msg.timestamp.seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Ahora';
        const isStarred = msg.starred ? true : false;
        const isMenuOpen = activeMenuMsgId === msg.id;

        let replyHtml = '';
        if (msg.replyTo) {
            replyHtml = `
                <div onclick="window.scrollToTarget('${msg.replyTo.targetId}')" class="bg-black/10 border-l-4 ${isMe ? 'border-blue-300 text-blue-100' : 'border-blue-600 text-slate-600'} pl-2 py-1 mb-1.5 rounded-r-lg text-[11px] cursor-pointer hover:bg-black/15 transition-colors" title="Ir al mensaje original">
                    <p class="font-bold">${isMe ? 'Tú' : 'Cliente'}</p>
                    <p class="truncate">${escapeHtml(msg.replyTo.text)}</p>
                </div>
            `;
        }

        return `
            <div id="msg-target-${msg.id}" class="flex ${isMe ? 'justify-end' : 'justify-start'} mb-4 relative px-10 transition-all duration-300">
                <div class="relative max-w-[75%] rounded-2xl px-4 py-2.5 text-xs shadow-sm ${isMe ? 'bg-blue-600 text-white rounded-br-none' : 'bg-white text-gray-800 border border-gray-100 rounded-bl-none'}">
                    
                    <button onclick="window.toggleMsgMenu('${msg.id}', event)" class="absolute top-1 ${isMe ? '-left-9' : '-right-9'} w-7 h-7 rounded-full bg-white border border-gray-200 text-gray-500 hover:text-gray-800 flex items-center justify-center shadow-md transition-all z-20" title="Opciones">
                        <i class="fa-solid fa-ellipsis-vertical text-xs"></i>
                    </button>

                    <div id="msg-menu-${msg.id}" class="${isMenuOpen ? 'block' : 'hidden'} absolute ${isMe ? 'right-0' : 'left-0'} top-8 z-50 w-36 bg-white border border-gray-100 rounded-2xl shadow-2xl overflow-hidden py-1 text-gray-700 text-left font-normal">
                        <button onclick="window.actionReply('${msg.id}', '${escapeHtml(msg.text).replace(/'/g, "\\'")}')" class="w-full px-4 py-2.5 text-xs flex items-center gap-2.5 hover:bg-gray-50 transition-colors">
                            <i class="fa-solid fa-reply text-blue-600"></i> Responder
                        </button>
                        <button onclick="window.actionStar('${msg.id}', ${!isStarred})" class="w-full px-4 py-2.5 text-xs flex items-center gap-2.5 hover:bg-gray-50 transition-colors">
                            <i class="fa-solid fa-star ${isStarred ? 'text-amber-400' : 'text-gray-400'}"></i> ${isStarred ? 'No destacar' : 'Destacar'}
                        </button>
                    </div>

                    ${replyHtml}
                    <div class="flex items-center gap-1">
                        <p class="leading-relaxed break-words flex-1">${escapeHtml(msg.text)}</p>
                        ${isStarred ? '<i class="fa-solid fa-star text-[10px] text-amber-400 ml-1"></i>' : ''}
                    </div>
                    <span class="block text-[10px] mt-1 text-right ${isMe ? 'text-blue-100' : 'text-gray-400'}">${timeStr}</span>
                </div>
            </div>
        `;
    }).join('');

    const currentScrollTop = messagesContainerEl.scrollTop;
    messagesContainerEl.innerHTML = contentHtml;
    
    if (scrollToBottom) {
        messagesContainerEl.scrollTop = messagesContainerEl.scrollHeight;
    } else {
        messagesContainerEl.scrollTop = currentScrollTop;
    }
}

// Función para redirigir y resaltar el mensaje original al hacer clic en la cita
window.scrollToTarget = (targetId) => {
    if (!targetId) return;
    const targetEl = document.getElementById(`msg-target-${targetId}`);
    if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const bubble = targetEl.querySelector('div');
        if (bubble) {
            bubble.classList.add('ring-4', 'ring-blue-400', 'transition-all');
            setTimeout(() => {
                bubble.classList.remove('ring-4', 'ring-blue-400');
            }, 1500);
        }
    }
};

window.toggleMsgMenu = (id, event) => {
    event.stopPropagation();
    const currentScroll = messagesContainerEl.scrollTop;
    activeMenuMsgId = activeMenuMsgId === id ? null : id;
    
    const contact = contactsList.find(c => c.key === activeContactKey);
    if (contact) {
        listenToMessages(contact.orders[0].id, false);
        messagesContainerEl.scrollTop = currentScroll;
    }
};

window.actionReply = (id, text) => {
    const currentScroll = messagesContainerEl.scrollTop;
    activeMenuMsgId = null;
    replyingToMessage = { id, text };
    const container = document.getElementById('reply-preview-container');
    const content = document.getElementById('reply-preview-content');
    
    content.innerHTML = `
        <p class="font-bold text-blue-600">Respondiendo a elemento</p>
        <p class="text-slate-600 truncate">${text}</p>
    `;
    container.classList.remove('hidden');
    chatInputEl.focus();

    const contact = contactsList.find(c => c.key === activeContactKey);
    if (contact) {
        listenToMessages(contact.orders[0].id, false);
        messagesContainerEl.scrollTop = currentScroll;
    }
};

window.actionStar = async (msgId, starState) => {
    const currentScroll = messagesContainerEl.scrollTop;
    activeMenuMsgId = null;
    const contact = contactsList.find(c => c.key === activeContactKey);
    if (!contact) return;

    try {
        const msgRef = doc(db, "orders", contact.orders[0].id, "chats", msgId);
        await updateDoc(msgRef, { starred: starState });
        messagesContainerEl.scrollTop = currentScroll;
    } catch (err) {
        console.error("Error al actualizar destacado:", err);
    }
};

window.cancelReply = () => {
    replyingToMessage = null;
    const container = document.getElementById('reply-preview-container');
    if (container) container.classList.add('hidden');
};

async function handleSendMessage() {
    const text = chatInputEl.value.trim();
    if (!text || !activeContactKey) return;

    const contact = contactsList.find(c => c.key === activeContactKey);
    if (!contact || contact.orders.length === 0) return;

    const activeOrderId = contact.orders[0].id;
    chatInputEl.value = '';

    const messageData = {
        text: text,
        isMe: true,
        timestamp: serverTimestamp(),
        starred: false
    };

    if (replyingToMessage) {
        messageData.replyTo = { 
            targetId: replyingToMessage.id, 
            text: replyingToMessage.text 
        };
    }

    try {
        await addDoc(collection(db, "orders", activeOrderId, "chats"), messageData);
        await updateDoc(doc(db, "orders", activeOrderId), {
            lastMessage: text,
            lastUpdate: serverTimestamp()
        });
        cancelReply();
    } catch (err) {
        console.error("Error al enviar mensaje:", err);
    }
}

function renderEmojiPicker() {
    emojiCategoriesEl.innerHTML = EMOJI_DATA.map((cat, idx) => `
        <button type="button" class="px-2 py-1 rounded-xl text-gray-600 hover:bg-gray-200 ${idx === 0 ? 'bg-gray-200 font-bold' : ''}" data-idx="${idx}">
            ${cat.icon}
        </button>
    `).join('');
    setEmojiCategory(0);
    emojiCategoriesEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => setEmojiCategory(parseInt(btn.dataset.idx, 10)));
    });
}

function setEmojiCategory(idx) {
    const cat = EMOJI_DATA[idx];
    emojiGridEl.innerHTML = cat.emojis.map(e => `<button type="button" class="hover:bg-gray-100 p-1 rounded-lg transition-all" data-emoji="${e}">${e}</button>`).join('');
    emojiGridEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => { chatInputEl.value += btn.dataset.emoji; chatInputEl.focus(); });
    });
}

function setupEventListeners() {
    contactSearchEl.addEventListener('input', () => { currentPage = 1; applyFiltersAndRender(); });
    sendBtnEl.addEventListener('click', handleSendMessage);
    chatInputEl.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSendMessage(); });

    const cancelReplyBtn = document.getElementById('cancel-reply-btn');
    if (cancelReplyBtn) cancelReplyBtn.addEventListener('click', cancelReply);

    emojiBtnEl.addEventListener('click', (e) => { e.stopPropagation(); emojiPickerEl.classList.toggle('hidden'); });
    
    document.addEventListener('click', (e) => {
        if (!emojiPickerEl.contains(e.target) && e.target !== emojiBtnEl) {
            emojiPickerEl.classList.add('hidden');
        }
        if (activeMenuMsgId && !e.target.closest('[id^="msg-menu-"]')) {
            const currentScroll = messagesContainerEl.scrollTop;
            activeMenuMsgId = null;
            const contact = contactsList.find(c => c.key === activeContactKey);
            if (contact) {
                listenToMessages(contact.orders[0].id, false);
                messagesContainerEl.scrollTop = currentScroll;
            }
        }
    });
}

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

init();