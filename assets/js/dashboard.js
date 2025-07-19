document.addEventListener("DOMContentLoaded", () => {
    // --- AUTH CHECK & CONFIG ---
    if (localStorage.getItem('isLoggedIn') !== 'true') {
        window.location.href = 'login.html';
        return;
    }
    // GANTI DENGAN IP NODE-RED ANDA
    const NODE_RED_URL = 'https://wastelog-nodered-services.up.railway.app';
    const WEBSOCKET_URL = 'https://wastelog-nodered-services.up.railway.app/ws/realtimelocation';
    const DEVICE_ID = 'gps_wastelog_01';

    // --- ELEMENTS ---
    const dashboardContainer = document.getElementById('dashboard-container');
    const sidebarToggle = document.getElementById('sidebar-toggle');
    const calendarEl = document.getElementById('calendar');
    const logoutButton = document.getElementById('logoutButton');
    const manualMeasureBtn = document.getElementById('manualMeasureBtn');
    const mapElement = document.getElementById('map');
    const addGeofenceBtn = document.getElementById('addGeofenceBtn');
    const geofenceFormContainer = document.getElementById('geofenceFormContainer');
    const geofenceForm = document.getElementById('geofenceForm');
    const cancelGeofenceBtn = document.getElementById('cancelGeofence');
    const geofenceTableBody = document.querySelector('#geofenceTable tbody');
    const eventPopover = document.getElementById('event-popover');

    // --- MAP & STATE SETUP ---
    let geofenceData = [];
    const map = L.map(mapElement).setView([-7.414038, 109.373714], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    const vehicleIcon = L.icon({ iconUrl: 'assets/images/truck.png', iconSize: [45, 45], iconAnchor: [22, 44], popupAnchor: [0, -45] });
    let vehicleMarker = L.marker([0, 0], { icon: vehicleIcon }).addTo(map).bindPopup("Lokasi Truk Sampah");
    let geofenceLayers = L.layerGroup().addTo(map);

    // --- FUNGSI-FUNGSI UTAMA ---

    const fetchInitialVehicleLocation = async () => {
        try {
            const response = await fetch(`${NODE_RED_URL}/api/realtimelocation?deviceId=${DEVICE_ID}`);
            if (!response.ok) throw new Error(`Server Response: ${response.status}`);
            const data = await response.json();
            if (data.latitude && data.longitude) {
                const initialLatLng = [data.latitude, data.longitude];
                vehicleMarker.setLatLng(initialLatLng);
                map.setView(initialLatLng, 16);
            }
        } catch (error) {
            console.error("Gagal mengambil lokasi awal:", error);
        }
    };

    const connectWebSocket = () => {
        const ws = new WebSocket(WEBSOCKET_URL);
        ws.onopen = () => console.log('WebSocket terhubung!');
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.deviceId === DEVICE_ID && data.location) {
                    const newLatLng = [data.location.lat, data.location.lon];
                    if (vehicleMarker) {
                        vehicleMarker.setLatLng(newLatLng);
                        map.panTo(newLatLng);
                    }
                }
            } catch (e) {
                console.error("Gagal mem-parsing data WebSocket:", e);
            }
        };
        ws.onerror = (err) => console.error('WebSocket error:', err);
        ws.onclose = () => {
            console.log('WebSocket terputus. Mencoba menghubungkan kembali...');
            setTimeout(connectWebSocket, 5000);
        };
    };

    const renderGeofences = (geofences) => {
        geofenceLayers.clearLayers();
        geofenceTableBody.innerHTML = '';
        geofences.forEach(fence => {
            L.circle([fence.latitude, fence.longitude], { radius: fence.radius1, color: '#2E7D32', weight: 2, fillOpacity: 0.1 }).addTo(geofenceLayers).bindTooltip(fence.nama);
            L.circle([fence.latitude, fence.longitude], { radius: fence.radius2, color: '#D32F2F', weight: 2, fillOpacity: 0.1, dashArray: '5, 10' }).addTo(geofenceLayers);
            
            const row = document.createElement('tr');
            row.innerHTML = `<td>${fence.nama}</td><td><button class="btn btn-secondary btn-sm edit-btn" data-id="${fence.id}">Edit</button> <button class="btn btn-danger btn-sm delete-btn" data-id="${fence.id}">Hapus</button></td>`;
            geofenceTableBody.appendChild(row);
        });
    };

    const fetchAndDisplayGeofences = async () => {
        try {
            const response = await fetch(`${NODE_RED_URL}/api/geofences`);
            geofenceData = await response.json();
            renderGeofences(geofenceData);
        } catch (error) {
            console.error('Gagal mengambil data geofence:', error);
        }
    };

    // --- KALENDER DAN LOGIKA HISTORI ---

    const formatTime = (dateStr) => dateStr ? new Date(dateStr).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }).replace(/\./g,':') : '-';
    const formatDuration = (seconds) => (seconds === null || seconds === undefined) ? '-' : `${Math.round(seconds / 60)} menit`;
    const formatVolume = (liters) => (liters === null || liters === undefined) ? '-' : `${liters.toFixed(2)} L`;
    const formatDistance = (cm) => (cm === null || cm === undefined) ? '-' : `${cm} cm`;

    const calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'id',
        headerToolbar: { left: 'prev,next today', center: 'title', right: 'dayGridMonth,dayGridWeek,listWeek' },
        buttonText: { dayGridMonth: 'Bulan', dayGridWeek: 'Minggu', listWeek: 'Daftar' },
        eventContent: (arg) => {
            const props = arg.event.extendedProps;
            const hasVolume = props.volume !== null && props.volume !== undefined;
            if (arg.view.type.includes('dayGrid')) {
                return { html: `<div class="event-pill">${hasVolume ? '<i class="fas fa-box-open event-icon"></i>' : ''}${arg.event.title}</div>` };
            }
            if (arg.view.type === 'listWeek') {
                const listTitle = `${arg.event.title} | ${formatTime(props.entryTime)} - ${formatTime(props.exitTime)} | Dur: ${formatDuration(props.durationSeconds)} | Vol: ${formatVolume(props.volume)}`;
                return { domNodes: [document.createTextNode(listTitle)] };
            }
        },
        eventClick: (info) => {
            info.jsEvent.preventDefault();
            const props = info.event.extendedProps;
            eventPopover.innerHTML = `
                <div class="event-popover-title">${info.event.title}</div>
                <div class="event-popover-body">
                    <div><i class="far fa-clock"></i> ${formatTime(props.entryTime)} - ${formatTime(props.exitTime)}</div>
                    <div><i class="fas fa-hourglass-half"></i> ${formatDuration(props.durationSeconds)}</div>
                    <div><i class="fas fa-box-open"></i> ${formatVolume(props.volume)}</div>
                    <div><i class="fas fa-ruler-vertical"></i> ${formatDistance(props.distance)}</div>
                </div>`;
            const rect = info.el.getBoundingClientRect();
            eventPopover.style.display = 'block';
            eventPopover.style.left = `${rect.left + window.scrollX}px`;
            eventPopover.style.top = `${rect.bottom + window.scrollY + 5}px`;
            const closePopover = (e) => {
                if (!eventPopover.contains(e.target) && eventPopover.style.display === 'block') {
                    eventPopover.style.display = 'none';
                    document.removeEventListener('click', closePopover, true);
                }
            };
            document.addEventListener('click', closePopover, true);
        }
    });
    calendar.render();

    // === INI ADALAH FUNGSI YANG DIPERBARUI ===
    const fetchHistoryAndRender = async () => {
        try {
            const response = await fetch(`${NODE_RED_URL}/api/history`);
            if (!response.ok) throw new Error("Gagal mengambil data histori");

            const historyLogs = await response.json();
            
            // Logika menjadi sangat sederhana, hanya memfilter dan memetakan data sesi
            const calendarEvents = historyLogs
                .filter(log => log.logType === 'VISIT_SESSION' && log.status === 'COMPLETED')
                .map(session => ({
                    title: session.areaName || 'Area Tak Dikenal',
                    start: session.entryTime,
                    extendedProps: {
                        entryTime: session.entryTime,
                        exitTime: session.exitTime,
                        durationSeconds: session.durationSeconds,
                        // Mengambil data pengukuran dari objek bersarang dengan aman
                        volume: session.measurement ? session.measurement.calculatedVolume_liter : null,
                        distance: session.measurement ? session.measurement.distance_cm : null
                    }
                }));

            // Perbarui kalender dengan data yang sudah bersih
            calendar.getEventSources().forEach(source => source.remove());
            calendar.addEventSource(calendarEvents);

        } catch (error) {
            console.error('Terjadi error saat memproses data histori:', error);
        }
    };
    
    // --- EVENT LISTENERS LAIN ---
    sidebarToggle.addEventListener('click', () => {
        dashboardContainer.classList.toggle('sidebar-closed');
        setTimeout(() => map.invalidateSize(), 300);
    });

    logoutButton.addEventListener('click', () => {
        localStorage.removeItem('isLoggedIn');
        window.location.href = 'index.html';
    });
    
    // Logika pengukuran manual tidak diubah, karena mungkin masih relevan untuk kasus tertentu
    manualMeasureBtn.addEventListener('click', async () => { /* ... kode tidak berubah ... */ });

    // Event listener untuk form dan tabel geofence tidak diubah
    addGeofenceBtn.addEventListener('click', () => { /* ... kode tidak berubah ... */ });
    cancelGeofenceBtn.addEventListener('click', () => { /* ... kode tidak berubah ... */ });
    map.on('click', (e) => { /* ... kode tidak berubah ... */ });
    geofenceForm.addEventListener('submit', async (e) => { /* ... kode tidak berubah ... */ });
    geofenceTableBody.addEventListener('click', async (e) => { /* ... kode tidak berubah ... */ });

    // --- INISIALISASI DASHBOARD ---
    const initializeDashboard = () => {
        fetchInitialVehicleLocation();
        connectWebSocket();
        fetchAndDisplayGeofences();
        fetchHistoryAndRender();
        setInterval(fetchHistoryAndRender, 60000); // Refresh data histori setiap menit
    };

    initializeDashboard();
});