// Soft drifting dots for the sign-in screen only.
// Paused while the page is hidden or the canvas is offscreen; off for reduced motion.
const reduce = matchMedia('(prefers-reduced-motion: reduce)');

export function startParticles(canvas, count = 34) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, raf = 0, visible = true, dead = false, ps = [];

  function size() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = r.width; h = r.height;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ps = Array.from({ length: count }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      r: 0.8 + Math.random() * 1.9, v: 0.10 + Math.random() * 0.22, ph: Math.random() * 6.28
    }));
  }

  function draw(t) {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = getComputedStyle(canvas).color;
    for (const p of ps) {
      p.y -= p.v; p.x += Math.sin(t / 2200 + p.ph) * 0.12;
      if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
      ctx.globalAlpha = 0.18 + 0.32 * (0.5 + 0.5 * Math.sin(t / 1100 + p.ph));
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function loop(t) { raf = 0; if (!canRun()) return; draw(t); raf = requestAnimationFrame(loop); }
  function canRun() { return !dead && visible && !document.hidden && !reduce.matches; }
  function start() { if (!raf && canRun()) raf = requestAnimationFrame(loop); }
  function stop() { cancelAnimationFrame(raf); raf = 0; }
  function clear() { ctx.clearRect(0, 0, w, h); }

  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; visible ? start() : stop(); });
  const onVis = () => (document.hidden ? stop() : start());
  const onMotion = () => { if (reduce.matches) { stop(); clear(); } else start(); };
  const onResize = () => { size(); start(); };

  size();
  io.observe(canvas);
  document.addEventListener('visibilitychange', onVis);
  reduce.addEventListener('change', onMotion);
  addEventListener('resize', onResize);
  start();

  return function destroy() {
    dead = true; stop(); io.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    reduce.removeEventListener('change', onMotion);
    removeEventListener('resize', onResize);
  };
}
