// 7. UI UPDATER
// ============================================
const UI = {
    els: {},
    init() {
        const ids = [
            'alertBanner', 'alertText', 'closeAlert', 'siteHeader', 'mobileMenuBtn', 'mainNav',
            'searchInput', 'citySuggestions', 'locationBtn', 'currentCity', 'currentCountry',
            'updateTime', 'currentTemp', 'currentCondition', 'weatherIcon', 'weatherDetails',
            'hourlyForecast', 'forecastContainer', 'weatherMap', 'temperatureChart',
            'statsGrid', 'newsGrid', 'apiStatus', 'scrollTop', 'refreshWeather', 'refreshNews',
            'weatherTips', 'waveHeight', 'waveDirection', 'wavePeriod', 'seaTipsList',
            'cubeTemp1', 'cubeTemp2', 'cubeTemp3', 'cubeTemp4', 'cubeTemp5', 'cubeTemp6',
            'statMaxTemp', 'statMinTemp', 'statRain', 'statWind'
        ];
        ids.forEach(id => { this.els[id] = document.getElementById(id); });
    },

    updateCurrentWeather(data, location) {
        if (!location) return;
        const locName = location.displayName || location.name;

        if (this.els.currentCity) this.els.currentCity.textContent = locName;
        if (this.els.currentCountry) this.els.currentCountry.textContent = location.country || 'الجزائر';
        if (this.els.currentTemp) this.els.currentTemp.textContent = `${Math.round(data.main.temp)}°`;
        if (this.els.currentCondition) {
            this.els.currentCondition.textContent = `${data.weather[0]?.description || ''} - ${location.name}`;
        }

        const isDay = data.weather[0]?.icon?.includes('d') ?? true;
        const wInfo = WeatherService.getIcon(data.weather[0]?.id, isDay);
        if (this.els.weatherIcon) {
            this.els.weatherIcon.innerHTML = `<i class="${wInfo.icon}"></i>`;
            this.els.weatherIcon.style.color = wInfo.color;
        }

        const details = [
            { icon: 'fas fa-temperature-high', label: 'الإحساس', value: `${Math.round(data.main.feels_like)}°C` },
            { icon: 'fas fa-tint', label: 'الرطوبة', value: `${data.main.humidity}%` },
            { icon: 'fas fa-wind', label: 'الرياح', value: `${Math.round(data.wind.speed * 3.6)} كم/س` },
            { icon: 'fas fa-compress-alt', label: 'الضغط', value: `${data.main.pressure} hPa` },
            { icon: 'fas fa-eye', label: 'الرؤية', value: `${(data.visibility / 1000).toFixed(1)} كم` },
            { icon: 'fas fa-cloud', label: 'السحب', value: `${data.clouds?.all || 0}%` },
            { icon: 'fas fa-location-arrow', label: 'اتجاه الرياح', value: WeatherService.windDir(data.wind.deg || 0) },
            { icon: 'fas fa-sun', label: 'UV', value: data.uvi || '--' }
        ];

        if (this.els.weatherDetails) {
            this.els.weatherDetails.innerHTML = details.map(d => `
                <div class="detail-card">
                    <div class="detail-card-icon"><i class="${d.icon}"></i></div>
                    <div class="detail-card-value">${d.value}</div>
                    <div class="detail-card-label">${d.label}</div>
                </div>
            `).join('');
        }
        this._updateCubes(data.main.temp);
    },

    _updateCubes() {
        // لا نستبدل بيانات المدن الأخرى بتقديرات مشتقة من درجة مدينة واحدة.
        for (let i = 1; i <= 6; i++) {
            const el = this.els[`cubeTemp${i}`];
            if (el) el.textContent = '--°';
        }
    },

    updateHourly(data) {
        const hourly = data.list.slice(0, 8);
        if (this.els.hourlyForecast) {
            this.els.hourlyForecast.innerHTML = hourly.map(item => {
                const date = new Date(item.dt * 1000);
                const hour = date.getHours();
                const isDay = hour >= 6 && hour < 18;
                const info = WeatherService.getIcon(item.weather[0]?.id, isDay);
                return `
                    <div class="hourly-card">
                        <div class="hourly-time">${hour}:00</div>
                        <div class="hourly-icon"><i class="${info.icon}" style="color:${info.color}"></i></div>
                        <div class="hourly-temp">${Math.round(item.main.temp)}°</div>
                        <div class="hourly-desc">${escapeHTML(item.weather[0]?.description || '')}</div>
                    </div>
                `;
            }).join('');
        }
    },

    updateDaily(data) {
        const daily = {};
        const days = ['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
        data.list.forEach(item => {
            const d = new Date(item.dt * 1000);
            const key = d.toDateString();
            if (!daily[key]) daily[key] = { temps: [], ids: [], descs: [], dayName: days[d.getDay()], dateStr: `${d.getDate()}/${d.getMonth()+1}` };
            daily[key].temps.push(item.main.temp);
            daily[key].ids.push(item.weather[0]?.id || 800);
            daily[key].descs.push(item.weather[0]?.description || '');
        });

        const entries = Object.values(daily).slice(0, 5);
        if (this.els.forecastContainer) {
            this.els.forecastContainer.innerHTML = entries.map(day => {
                const max = Math.max(...day.temps);
                const min = Math.min(...day.temps);
                const avgId = day.ids[Math.floor(day.ids.length / 2)];
                const info = WeatherService.getIcon(avgId);
                const desc = day.descs[Math.floor(day.descs.length / 2)] || '';
                return `
                    <div class="forecast-card">
                        <div class="forecast-day">${day.dayName}</div>
                        <div class="forecast-date">${day.dateStr}</div>
                        <div class="forecast-icon"><i class="${info.icon}" style="color:${info.color}"></i></div>
                        <div class="forecast-condition">${escapeHTML(desc)}</div>
                        <div class="forecast-temps">
                            <span class="forecast-high">${Math.round(max)}°</span>
                            <span class="forecast-low">${Math.round(min)}°</span>
                        </div>
                    </div>
                `;
            }).join('');
        }
    },

    updateSea(data) {
        // مصدر الطقس الحالي لا يقدم قياسات بحرية؛ لا نستنتج ارتفاع الموج
        // أو سلامة السباحة والقوارب من سرعة الرياح وحدها.
        if (this.els.waveHeight) this.els.waveHeight.textContent = '--';
        if (this.els.waveDirection) this.els.waveDirection.textContent = '--';
        if (this.els.wavePeriod) this.els.wavePeriod.textContent = '--';
        if (this.els.seaTipsList) {
            this.els.seaTipsList.textContent = 'لا تتوفر حالياً بيانات مباشرة وموثوقة عن الأمواج لهذا الموقع.';
        }
    },

    updateStats(current, forecast) {
        const temps = forecast.list.map(i => i.main.temp);
        const max = Math.max(...temps);
        const min = Math.min(...temps);
        const rain = forecast.list.reduce((total, item) => total + Number(item.rain?.['3h'] || 0), 0);
        const avgWind = forecast.list.reduce((s, i) => s + i.wind.speed, 0) / forecast.list.length;

        if (this.els.statMaxTemp) this.els.statMaxTemp.textContent = `${Math.round(max)}°`;
        if (this.els.statMinTemp) this.els.statMinTemp.textContent = `${Math.round(min)}°`;
        if (this.els.statRain) this.els.statRain.textContent = `${rain.toFixed(1)}mm`;
        if (this.els.statWind) this.els.statWind.textContent = `${Math.round(avgWind * 3.6)}km/h`;
    },

    updateTips(data) {
        const temp = data.main.temp;
        const id = data.weather[0]?.id || 800;
        const wind = (data.wind.speed || 0) * 3.6;
        const tips = [];

        if (temp > 35) tips.push({ icon: 'fas fa-temperature-high', title: 'موجة حرارة شديدة', text: 'تجنب التعرض للشمس بين 11 صباحاً و4 مساءً. اشرب الماء باستمرار.', severity: 'high' });
        if (temp > 28) tips.push({ icon: 'fas fa-tint', title: 'ترطيب الجسم', text: 'اشرب 8-10 أكواب من الماء يومياً. تجنب الكافيين.', severity: 'medium' });
        if (temp < 10) tips.push({ icon: 'fas fa-snowflake', title: 'موجة برد', text: 'ارتدِ طبقات ملابس دافئة. احمِ يديك ورأسك.', severity: 'high' });
        if (id >= 500 && id < 600) tips.push({ icon: 'fas fa-umbrella', title: 'توقعات أمطار', text: 'احمل مظلة وارتدِ ملابس مقاومة للماء.', severity: 'medium' });
        if (wind > 50) tips.push({ icon: 'fas fa-wind', title: 'رياح قوية', text: 'ثبت الأشياء في الخارج. تجنب الوقوف تحت الأشجار.', severity: 'high' });
        if (id >= 200 && id < 300) tips.push({ icon: 'fas fa-bolt', title: 'عواصف رعدية', text: 'ابقَ في الداخل. تجنب الأجهزة الكهربائية.', severity: 'high' });
        if (!tips.length) tips.push({ icon: 'fas fa-sun', title: 'طقس معتدل', text: 'الأحوال الجوية مستقرة. فرصة ممتازة للأنشطة الخارجية.', severity: 'low' });

        if (this.els.weatherTips) {
            this.els.weatherTips.innerHTML = tips.slice(0, 3).map(t => `
                <div class="tip-card">
                    <div class="tip-icon"><i class="${t.icon}"></i></div>
                    <h3 class="tip-title">${t.title}</h3>
                    <p class="tip-text">${t.text}</p>
                    <span class="tip-severity ${t.severity}">${t.severity === 'high' ? 'تحذير عالي' : t.severity === 'medium' ? 'تنبيه متوسط' : 'نصيحة عامة'}</span>
                </div>
            `).join('');
        }
    },

    updateChart(forecast) {
        const ctx = this.els.temperatureChart?.getContext('2d');
        if (!ctx || !window.Chart) return;

        const labels = [];
        const maxTemps = [];
        const minTemps = [];
        const daily = {};

        forecast.list.forEach(item => {
            const d = new Date(item.dt * 1000);
            const key = d.toISOString().slice(0, 10);
            if (!daily[key]) daily[key] = { label: d.toLocaleDateString('ar-DZ', { weekday: 'short', day: 'numeric', month: 'short' }), temps: [] };
            daily[key].temps.push(item.main.temp);
        });

        let c = 0;
        for (const day of Object.values(daily)) {
            if (c >= 5) break;
            labels.push(day.label);
            maxTemps.push(Math.round(Math.max(...day.temps)));
            minTemps.push(Math.round(Math.min(...day.temps)));
            c++;
        }

        if (AppState.temperatureChart) AppState.temperatureChart.destroy();
        AppState.temperatureChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: 'العليا', data: maxTemps, borderColor: '#e74c3c', backgroundColor: 'rgba(231,76,60,0.1)', borderWidth: 3, fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#e74c3c', pointBorderColor: '#fff', pointBorderWidth: 2 },
                    { label: 'الدنيا', data: minTemps, borderColor: '#3498db', backgroundColor: 'rgba(52,152,219,0.1)', borderWidth: 3, fill: true, tension: 0.4, pointRadius: 5, pointBackgroundColor: '#3498db', pointBorderColor: '#fff', pointBorderWidth: 2 }
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { color: '#a09888', font: { family: 'Cairo', size: 14 } } },
                    tooltip: { backgroundColor: 'rgba(10,14,26,0.9)', titleColor: '#d4a853', bodyColor: '#e8e0d0', borderColor: 'rgba(212,168,83,0.2)', borderWidth: 1, callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}°C` } }
                },
                scales: {
                    y: { beginAtZero: false, grid: { color: 'rgba(255,255,255,0.03)' }, ticks: { color: '#6b6560', callback: v => v + '°C', font: { family: 'Cairo' } } },
                    x: { grid: { display: false }, ticks: { color: '#6b6560', font: { family: 'Cairo' } } }
                }
            }
        });
    },

    setApiStatus(ok) {
        const s = this.els.apiStatus;
        if (!s) return;
        if (ok) {
            s.innerHTML = '<i class="fas fa-check-circle"></i><span>متصل</span>';
            s.classList.remove('error');
        } else {
            s.innerHTML = '<i class="fas fa-exclamation-triangle"></i><span>خطأ في الاتصال</span>';
            s.classList.add('error');
        }
    },

    setLoading(isLoading) {
        const btn = this.els.refreshWeather;
        if (btn) {
            btn.disabled = isLoading;
            btn.innerHTML = isLoading ? '<span class="spinner"></span> جاري التحديث...' : '<i class="fas fa-sync-alt"></i> تحديث البيانات';
        }
        AppState.isLoading = isLoading;
    },

    setLocLoading(isLoading) {
        const btn = this.els.locationBtn;
        if (btn) btn.innerHTML = isLoading ? '<span class="spinner" style="width:16px;height:16px;border-width:2px;"></span>' : '<i class="fas fa-location-crosshairs"></i>';
    },

    updateTime() {
        if (this.els.updateTime) this.els.updateTime.textContent = WeatherService.formatTime(new Date());
    }
};

// ============================================
