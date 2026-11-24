// Lightweight decorative star field. Keep the effect secondary to weather content.
function initStarField() {
    const canvas = document.getElementById('starCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (canvas.dataset.effectsInitialized === 'true') return;
    canvas.dataset.effectsInitialized = 'true';

    const mobile = window.matchMedia('(max-width: 767px)').matches;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const lowEnd = Boolean(connection?.saveData) ||
        (Number(navigator.deviceMemory) > 0 && Number(navigator.deviceMemory) <= 2) ||
        (Number(navigator.hardwareConcurrency) > 0 && Number(navigator.hardwareConcurrency) <= 4);
    const starCount = mobile ? (lowEnd ? 8 : 16) : (lowEnd ? 22 : 36);
    const drawConnections = !mobile && !lowEnd;
    const frameInterval = mobile ? 66 : 40;

    let width = 0;
    let height = 0;
    let stars = [];
    let mouse = { x: null, y: null };
    let animationFrame = null;
    let lastFrameTime = 0;

    function resize() {
        width = canvas.width = window.innerWidth;
        height = canvas.height = window.innerHeight;
    }

    function createStars() {
        stars = Array.from({ length: starCount }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            radius: Math.random() * 1.3 + 0.4,
            vx: (Math.random() - 0.5) * 0.24,
            vy: (Math.random() - 0.5) * 0.24,
            alpha: Math.random() * 0.45 + 0.3
        }));
    }

    function draw(timestamp = 0) {
        if (document.hidden) {
            animationFrame = null;
            return;
        }
        if (timestamp - lastFrameTime < frameInterval) {
            animationFrame = requestAnimationFrame(draw);
            return;
        }
        lastFrameTime = timestamp;
        ctx.clearRect(0, 0, width, height);

        if (drawConnections) {
            ctx.strokeStyle = 'rgba(212,168,83,0.08)';
            ctx.lineWidth = 0.5;
            for (let i = 0; i < stars.length; i++) {
                for (let j = i + 1; j < stars.length; j++) {
                    const dx = stars[i].x - stars[j].x;
                    const dy = stars[i].y - stars[j].y;
                    const distanceSquared = dx * dx + dy * dy;
                    if (distanceSquared < 8100) {
                        const distance = Math.sqrt(distanceSquared);
                        ctx.globalAlpha = (1 - distance / 90) * 0.3;
                        ctx.beginPath();
                        ctx.moveTo(stars[i].x, stars[i].y);
                        ctx.lineTo(stars[j].x, stars[j].y);
                        ctx.stroke();
                    }
                }
            }
        }

        ctx.globalAlpha = 1;
        for (const star of stars) {
            ctx.beginPath();
            ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(212,168,83,${star.alpha})`;
            ctx.fill();

            if (!mobile && mouse.x !== null) {
                const dx = mouse.x - star.x;
                const dy = mouse.y - star.y;
                if (dx * dx + dy * dy < 22500) {
                    ctx.beginPath();
                    ctx.arc(star.x, star.y, star.radius * 2, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(212,168,83,${star.alpha * 0.5})`;
                    ctx.fill();
                }
            }

            star.x += star.vx;
            star.y += star.vy;
            if (star.x < 0) star.x = width;
            if (star.x > width) star.x = 0;
            if (star.y < 0) star.y = height;
            if (star.y > height) star.y = 0;
            star.alpha += (Math.random() - 0.5) * 0.015;
            star.alpha = Math.max(0.2, Math.min(0.8, star.alpha));
        }

        if (!reducedMotion && !lowEnd) animationFrame = requestAnimationFrame(draw);
        else animationFrame = null;
    }

    function stopAnimation() {
        if (animationFrame !== null) cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }

    function startAnimation() {
        if (reducedMotion || lowEnd || document.hidden || animationFrame !== null) return;
        lastFrameTime = 0;
        animationFrame = requestAnimationFrame(draw);
    }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopAnimation();
        else startAnimation();
    });

    if (!mobile && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        canvas.addEventListener('mousemove', event => {
            mouse.x = event.clientX;
            mouse.y = event.clientY;
        }, { passive: true });
        canvas.addEventListener('mouseleave', () => {
            mouse.x = null;
            mouse.y = null;
        }, { passive: true });
    }

    window.addEventListener('resize', () => {
        resize();
        createStars();
        if (reducedMotion || lowEnd) draw(performance.now());
    }, { passive: true });

    resize();
    createStars();
    draw(performance.now());
    startAnimation();
}
