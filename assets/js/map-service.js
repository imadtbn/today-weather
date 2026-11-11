// 8. MAP SERVICE
// ============================================
const MapService = {
    map: null, marker: null,

    init() {
        const loc = AppState.currentLocation || CONFIG.DEFAULT_LOCATION;
        if (!window.L || !document.getElementById('weatherMap')) {
            console.warn('[Map] Leaflet is unavailable; weather data will continue without the map.');
            return;
        }
        this.map = L.map('weatherMap').setView([loc.lat, loc.lon], 6);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap', maxZoom: 18
        }).addTo(this.map);

        this._updateLayer();
        this._setMarker(loc.lat, loc.lon, loc.displayName || loc.name);

        this.map.on('click', e => this._handleClick(e));
        window.addEventListener('resize', () => setTimeout(() => this.map?.invalidateSize(), 200));
    },

    _updateLayer() {
        if (!this.map || !window.L) return;
        const urls = {
            temperature: `${CONFIG.TILE_URL}/temp_new/{z}/{x}/{y}.png?appid=${CONFIG.OPENWEATHER_API_KEY}`,
            precipitation: `${CONFIG.TILE_URL}/precipitation_new/{z}/{x}/{y}.png?appid=${CONFIG.OPENWEATHER_API_KEY}`,
            wind: `${CONFIG.TILE_URL}/wind_new/{z}/{x}/{y}.png?appid=${CONFIG.OPENWEATHER_API_KEY}`,
            clouds: `${CONFIG.TILE_URL}/clouds_new/{z}/{x}/{y}.png?appid=${CONFIG.OPENWEATHER_API_KEY}`
        };
        const key = AppState.currentLayer;

        if (!AppState.tileLayers[key]) {
            AppState.tileLayers[key] = L.tileLayer(urls[key], { opacity: 0.6, maxZoom: 18, attribution: '© OpenWeatherMap' });
        }

        Object.values(AppState.tileLayers).forEach(l => { if (this.map.hasLayer(l)) this.map.removeLayer(l); });
        AppState.tileLayers[key].addTo(this.map);
        this._updateLegend();
    },

    _updateLegend() {
        const legend = document.getElementById('mapLegend');
        if (!legend) return;
        const legends = {
            temperature: { title: 'درجة الحرارة (°C)', gradient: 'linear-gradient(to right, #0000FF, #00BFFF, #00FF7F, #FFD700, #FF4500)', labels: ['≤0°','10°','20°','30°','>30°'] },
            precipitation: { title: 'هطول الأمطار (مم)', gradient: 'linear-gradient(to right, #FFFFFF, #ADD8E6, #1E90FF, #0000FF)', labels: ['0','5','20','≥20'] },
            wind: { title: 'سرعة الرياح (كم/س)', gradient: 'linear-gradient(to right, #00FF00, #FFFF00, #FFA500, #FF0000)', labels: ['0-10','20','40','≥50'] },
            clouds: { title: 'الغطاء السحابي (%)', gradient: 'linear-gradient(to right, #FFFFFF, #CCCCCC, #888888, #555555)', labels: ['0%','25%','50%','75%','100%'] }
        };
        const l = legends[AppState.currentLayer];
        legend.innerHTML = `<h4>${l.title}</h4><div class="legend-gradient" style="background:${l.gradient};"></div><div class="legend-labels">${l.labels.map(x => `<span>${x}</span>`).join('')}</div>`;
    },

    _setMarker(lat, lon, title) {
        if (!this.map || !window.L) return;
        if (this.marker) this.map.removeLayer(this.marker);
        this.marker = L.marker([lat, lon]).addTo(this.map)
            .bindPopup(`<b style="font-family:Cairo;">${escapeHTML(title)}</b>`)
            .openPopup();
    },

    async _handleClick(e) {
        const { lat, lng: lon } = e.latlng;
        L.popup().setLatLng([lat, lon]).setContent('<div style="direction:rtl;font-family:Cairo;text-align:center;"><i class="fas fa-spinner fa-spin"></i> جارٍ التحميل...</div>').openOn(this.map);

        try {
            const [weather, geo] = await Promise.all([
                WeatherService.fetchAtPoint(lat, lon),
                GeoService.reverseGeocode(lat, lon).catch(() => GeoService._fallback(lat, lon))
            ]);

            const isDay = weather.weather[0]?.icon?.includes('d') ?? true;
            const info = WeatherService.getIcon(weather.weather[0]?.id, isDay);

            L.popup().setLatLng([lat, lon]).setContent(`
                <div style="direction:rtl;text-align:right;font-family:Cairo;min-width:220px;">
                    <h3 style="margin-bottom:8px;color:#d4a853;font-size:1.1rem;"><i class="fas fa-map-marker-alt"></i> ${escapeHTML(geo.displayName)}</h3>
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;">
                        <i class="${info.icon}" style="font-size:2rem;color:${info.color}"></i>
                        <div>
                            <div style="font-size:1.5rem;font-weight:800;color:#e8e0d0;">${Math.round(weather.main.temp)}°C</div>
                            <div style="color:#a09888;font-size:0.9rem;">${escapeHTML(weather.weather[0]?.description || '')}</div>
                        </div>
                    </div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:0.85rem;color:#a09888;">
                        <div><i class="fas fa-tint" style="color:#3498db"></i> ${weather.main.humidity}%</div>
                        <div><i class="fas fa-wind" style="color:#94a3b8"></i> ${Math.round(weather.wind.speed * 3.6)} كم/س</div>
                        <div><i class="fas fa-compress-alt" style="color:#94a3b8"></i> ${weather.main.pressure} hPa</div>
                        <div><i class="fas fa-eye" style="color:#94a3b8"></i> ${(weather.visibility / 1000).toFixed(1)} كم</div>
                    </div>
                    <div style="margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.1);font-size:0.75rem;color:#6b6560;">
                        <i class="fas fa-location-arrow"></i> ${lat.toFixed(4)}, ${lon.toFixed(4)}
                    </div>
                </div>
            `).openOn(this.map);
        } catch (err) {
            L.popup().setLatLng([lat, lon]).setContent('<div style="direction:rtl;font-family:Cairo;color:#e74c3c;">تعذر جلب البيانات</div>').openOn(this.map);
        }
    },

    setLayer(layer) {
        AppState.currentLayer = layer;
        this._updateLayer();
    },

    setView(lat, lon, zoom = 10) {
        this.map?.setView([lat, lon], zoom);
    },

    updateMarker(lat, lon, title) {
        this._setMarker(lat, lon, title);
    }
};

// ============================================
