// 11. STAR BACKGROUND
// ============================================
function initStarField() {
    const canvas = document.getElementById('starCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let w, h, stars = [], mouse = { x: null, y: null };
    const N = 70, D = 90;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let animationFrame = null;

    function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
    function create() { stars.length = 0; for (let i = 0; i < N; i++) stars.push({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.5 + 0.5, vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.3, a: Math.random() * 0.5 + 0.3 }); }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(212,168,83,0.08)'; ctx.lineWidth = 0.5;
        for (let i = 0; i < stars.length; i++) {
            for (let j = i + 1; j < stars.length; j++) {
                const dx = stars[i].x - stars[j].x, dy = stars[i].y - stars[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist < D) { ctx.globalAlpha = (1 - dist / D) * 0.3; ctx.beginPath(); ctx.moveTo(stars[i].x, stars[i].y); ctx.lineTo(stars[j].x, stars[j].y); ctx.stroke(); }
            }
        }
        ctx.globalAlpha = 1;
        for (const s of stars) {
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(212,168,83,${s.a})`; ctx.fill();
            if (mouse.x !== null) { const dx = mouse.x - s.x, dy = mouse.y - s.y; if (Math.sqrt(dx * dx + dy * dy) < 150) { ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 2, 0, Math.PI * 2); ctx.fillStyle = `rgba(212,168,83,${s.a * 0.5})`; ctx.fill(); } }
            s.x += s.vx; s.y += s.vy;
            if (s.x < 0) s.x = w; if (s.x > w) s.x = 0; if (s.y < 0) s.y = h; if (s.y > h) s.y = 0;
            s.a += (Math.random() - 0.5) * 0.02; s.a = Math.max(0.2, Math.min(0.8, s.a));
        }
        if (!reducedMotion && !document.hidden) animationFrame = requestAnimationFrame(draw);
    }
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && animationFrame !== null) {
            cancelAnimationFrame(animationFrame);
            animationFrame = null;
        } else if (!document.hidden && !reducedMotion && animationFrame === null) {
            draw();
        }
    });
    canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
    canvas.addEventListener('mouseleave', () => { mouse.x = null; mouse.y = null; });
    window.addEventListener('resize', () => { resize(); create(); });
    resize(); create(); draw();
}

// ============================================
