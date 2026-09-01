import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getFirestore, collection, getDocs, query, where, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth();

let map, directionsService, directionsRenderer;
let markers = [];
let allOrders = [];
let watchId = null;
let motorizadoMarker = null;

function initMap() {
    map = new google.maps.Map(document.getElementById('delivery-map'), {
        zoom: 12,
        center: { lat: 10.4806, lng: -66.8983 },
        mapTypeControl: true,
        streetViewControl: true
    });

    directionsService = new google.maps.DirectionsService();
    directionsRenderer = new google.maps.DirectionsRenderer({
        map: map,
        suppressMarkers: false
    });

    loadData();
}

window.iniciarNavegacionGPS = function (destLat, destLng) {
    markers.forEach(m => m.infoWindow?.close());

    if (navigator.geolocation) {
        if (watchId) navigator.geolocation.clearWatch(watchId);

        watchId = navigator.geolocation.watchPosition((position) => {
            const miPos = {
                lat: position.coords.latitude,
                lng: position.coords.longitude
            };

            if (!motorizadoMarker) {
                motorizadoMarker = new google.maps.Marker({
                    position: miPos,
                    map: map,
                    icon: {
                        url: "https://maps.google.com/mapfiles/ms/icons/blue-dot.png",
                        scaledSize: new google.maps.Size(40, 40)
                    },
                    title: "Mi Ubicación",
                    zIndex: 1000
                });
            } else {
                motorizadoMarker.setPosition(miPos);
            }

            const solicitud = {
                origin: miPos,
                destination: { lat: parseFloat(destLat), lng: parseFloat(destLng) },
                travelMode: google.maps.TravelMode.DRIVING
            };

            directionsService.route(solicitud, (result, status) => {
                if (status === 'OK') {
                    directionsRenderer.setDirections(result);
                    map.panTo(miPos);
                }
            });
        }, (err) => console.error(err), { enableHighAccuracy: true });
    }
};

async function renderCustomerList(ordersToRender) {
    const listContainer = document.getElementById('customer-list');
    listContainer.innerHTML = "";
    markers.forEach(m => m.setMap(null));
    markers = [];
    const geocoder = new google.maps.Geocoder();

    for (const order of ordersToRender) {
        const cData = order.customerData || {};
        const name = cData.Customname || "Cliente Sin Nombre";
        const phone = cData.phone || "Sin Teléfono";
        const fullAddress = `${cData.address || ""}, ${cData.city || "Valencia"}, Venezuela`;

        const card = document.createElement('div');
        card.className = "p-3 mb-2 rounded-xl border border-gray-100 hover:bg-blue-50 cursor-pointer shadow-sm bg-white";
        card.innerHTML = `
        <div class="flex justify-between items-center">
            <div>
                <p class="text-[11px] font-bold text-gray-800">${name}</p>
                <p class="text-[9px] text-gray-400 font-medium tracking-tight truncate w-32">${fullAddress}</p>
            </div>
            <div class="flex gap-2 text-gray-400">
                <a href="tel:${phone}" class="hover:text-blue-500"><i class="fa-solid fa-phone text-xs"></i></a>
                <a href="https://wa.me/${phone.replace(/\D/g, '')}" target="_blank" class="hover:text-green-500"><i class="fa-brands fa-whatsapp text-xs"></i></a>
            </div>
        </div>
        `;
        listContainer.appendChild(card);

        const placeMarker = (location, title) => {
            const marker = new google.maps.Marker({
                position: location,
                map: map,
                title: title,
                animation: google.maps.Animation.DROP
            });

            const infoWindow = new google.maps.InfoWindow({
                content: `
                    <div class="p-3 font-sans" style="min-width: 160px;">
                        <h4 class="font-bold text-gray-800 text-sm mb-1">${title}</h4>
                        <p class="text-[11px] text-gray-500 mb-3">${phone}</p>
                        <div class="flex gap-2 mb-3">
                            <a href="https://wa.me/${phone.replace(/\D/g, '')}?text=Hola ${name}, soy tu repartidor de Varius, ya voy en camino con tu pedido." 
                                target="_blank" class="flex-1 bg-green-500 text-white text-center py-2 rounded-lg hover:bg-green-600 transition-colors">
                                <i class="fa-brands fa-whatsapp"></i>
                            </a>
                            <a href="sms:${phone}" class="flex-1 bg-blue-400 text-white text-center py-2 rounded-lg hover:bg-blue-500 transition-colors">
                                <i class="fa-solid fa-comment-sms"></i>
                            </a>
                            <a href="tel:${phone}" class="flex-1 bg-gray-700 text-white text-center py-2 rounded-lg hover:bg-gray-800 transition-colors">
                                <i class="fa-solid fa-phone"></i>
                            </a>
                        </div>
                        <button onclick="window.iniciarNavegacionGPS(${location.lat()}, ${location.lng()})" 
                            class="w-full bg-blue-600 text-white text-[10px] font-bold py-2 px-3 rounded-lg shadow-md">
                            <i class="fa-solid fa-route mr-1"></i> TRAZAR RUTA AQUÍ
                        </button>
                    </div>`
            });

            marker.addListener("click", () => {
                markers.forEach(m => m.infoWindow?.close());
                map.panTo(location);
                infoWindow.open(map, marker);
                marker.infoWindow = infoWindow;
            });

            card.onclick = () => google.maps.event.trigger(marker, 'click');
            markers.push(marker);
        };

        geocoder.geocode({ address: fullAddress }, (results, status) => {
            if (status === 'OK') placeMarker(results[0].geometry.location, name);
        });
    }
}

async function loadData() {
    let user = auth.currentUser;
    if (!user) await new Promise(res => { const unsub = auth.onAuthStateChanged(u => { user = u; unsub(); res(); }); });
    try {
        const snap = await getDocs(collection(db, "orders"));
        allOrders = [];
        snap.forEach(doc => allOrders.push({ id: doc.id, ...doc.data() }));
        renderCustomerList(allOrders);
    } catch (e) { console.error(e); }
}

window.addEventListener('load', () => { if (typeof google !== 'undefined') initMap(); });
