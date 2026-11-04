/* Honeypot — scroll-driven engraving.
 *
 * How the engraving works:
 *   1. Every frame, the scene is painted into an offscreen 2D canvas, but not in
 *      colour. Each pixel is a little record:
 *        R = tone        (0 = deep shadow … 1 = full light)
 *        G = hatch angle (0..255 → 0..180°), so lines follow each object's form
 *        B = material    (0 background · 85 paper · 170 spot colour · 255 plain white)
 *   2. A WebGL fragment shader reads that record and draws engraving lines across
 *      it: a line screen whose lines swell in the shadows and vanish in the light,
 *      with a slight hand-cut wobble. Shading becomes line weight, which is what
 *      makes an engraving look like an engraving.
 */
(() => {
  "use strict";

  const params = new URLSearchParams(location.search);
  const FIXED = params.has("p") ? Math.min(1, Math.max(0, parseFloat(params.get("p")) || 0)) : null;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const glCanvas = document.getElementById("stage");
  const gl = glCanvas.getContext("webgl", { antialias: false, alpha: false, preserveDrawingBuffer: true });
  if (!gl) { document.documentElement.classList.add("no-webgl"); revealAll(); return; }

  const scene = document.createElement("canvas");
  const ctx = scene.getContext("2d", { alpha: false });

  // ---------- colours ----------
  const RED = [0.851, 0.082, 0.059];
  const NIGHT = [0.075, 0.07, 0.07];
  const MAT = { paper: 85, spot: 170, white: 255 };

  // ---------- shader ----------
  const VERT = `attribute vec2 a;varying vec2 v;void main(){v=a*.5+.5;gl_Position=vec4(a,0.,1.);}`;
  const FRAG = `
precision highp float;
varying vec2 v;
uniform sampler2D u_scene;
uniform vec2 u_res;
uniform vec3 u_bg;
uniform float u_period;
uniform float u_time;
const vec3 PAPER = vec3(0.965, 0.945, 0.905);
const vec3 INK   = vec3(0.071, 0.063, 0.063);
const vec3 SPOT  = vec3(0.976, 0.843, 0.180);
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main(){
  vec4 c = texture2D(u_scene, v);
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  float grain = (hash(floor(p) + floor(u_time * 12.0)) - 0.5) * 0.04;
  if (c.b < 0.17) { gl_FragColor = vec4(u_bg + grain, 1.0); return; }
  if (c.b > 0.83) { gl_FragColor = vec4(PAPER + grain * 0.5, 1.0); return; }
  vec3 base = c.b < 0.5 ? PAPER : SPOT;
  float ang = c.g * 3.14159265;
  vec2 dir = vec2(cos(ang), sin(ang));
  vec2 nrm = vec2(-dir.y, dir.x);
  // Lines run along dir; the wobble keeps them from looking machine-ruled.
  float coord = dot(p, nrm) / u_period + 0.22 * sin(dot(p, dir) / (u_period * 14.0));
  float s = abs(fract(coord) - 0.5) * 2.0;
  float aa = 2.2 / u_period;
  float w = (1.0 - c.r) * (1.0 + aa) - aa;
  float ink = 1.0 - smoothstep(w, w + aa, s);
  gl_FragColor = vec4(mix(base, INK, ink) + grain * 0.5, 1.0);
}`;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aLoc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(aLoc);
  gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const U = name => gl.getUniformLocation(prog, name);
  const uRes = U("u_res"), uBg = U("u_bg"), uPeriod = U("u_period"), uTime = U("u_time");

  // ---------- sizing ----------
  let W = 0, H = 0, dpr = 1, S = 1, CX = 0, CY = 0, portrait = false;
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.75);
    W = innerWidth; H = innerHeight;
    portrait = W < 760 || W / H < 0.9;
    glCanvas.width = scene.width = Math.round(W * dpr);
    glCanvas.height = scene.height = Math.round(H * dpr);
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);
    // Stage units: the objects are drawn in a ~1200 x 1000 box around (0,0).
    S = portrait ? Math.min(W / 900, H / 1500) : Math.min(W / 1500, H / 1050);
    CX = portrait ? W * 0.5 : W * 0.66;
    CY = portrait ? H * 0.36 : H * 0.52;
  }
  addEventListener("resize", resize);
  resize();

  // ---------- encoding helpers ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => (t = clamp(t), t * t * (3 - 2 * t));
  const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
  const backOut = t => { t = clamp(t); const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const span = (t, a, b) => clamp((t - a) / (b - a));

  function enc(tone, angDeg, mat) {
    const a = ((angDeg % 180) + 180) % 180;
    return `rgb(${Math.round(clamp(tone) * 255)},${Math.round(a / 180 * 255)},${mat})`;
  }
  function lin(x0, y0, x1, y1, stops, ang, mat) {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    for (const [o, t] of stops) g.addColorStop(o, enc(t, ang, mat));
    return g;
  }
  function rad(x, y, r0, r1, stops, ang, mat) {
    const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    for (const [o, t] of stops) g.addColorStop(o, enc(t, ang, mat));
    return g;
  }
  function rrect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
  }
  function outline(width = 3, ang = 0) {
    ctx.lineWidth = width;
    ctx.strokeStyle = enc(0, ang, MAT.paper);
    ctx.stroke();
  }
  const CYL = [[0, .28], [.18, .7], [.42, .98], [.62, .9], [1, .32]];   // light from upper left

  // ---------- objects ----------
  function jar(x, base, w, h, fill, t) {
    const top = base - h, l = x - w / 2;
    // body
    rrect(l, top + h * .1, w, h * .9, w * .2);
    ctx.fillStyle = lin(l, 0, l + w, 0, [[0, .62], [.25, .97], [.6, .92], [1, .5]], 90, MAT.paper);
    ctx.fill();
    // honey inside
    ctx.save();
    rrect(l + 9, top + h * .1 + 9, w - 18, h * .9 - 18, w * .17);
    ctx.clip();
    const level = base - 9 - (h * .9 - 18) * fill;
    const wave = Math.sin(t * 2.2) * 4;
    ctx.beginPath();
    ctx.moveTo(l, level + wave);
    ctx.bezierCurveTo(x - w * .2, level - 8 - wave, x + w * .2, level + 8 + wave, l + w, level - wave);
    ctx.lineTo(l + w, base); ctx.lineTo(l, base); ctx.closePath();
    ctx.fillStyle = lin(l, 0, l + w, 0, [[0, .32], [.3, .9], [.55, .8], [1, .25]], 90, MAT.spot);
    ctx.fill();
    ctx.restore();
    // glint
    rrect(l + w * .13, top + h * .22, w * .07, h * .5, 8);
    ctx.fillStyle = enc(1, 0, MAT.white); ctx.fill();
    // label
    const lw = w * .74, lh = h * .3, lx = x - lw / 2, ly = base - h * .55;
    rrect(lx, ly, lw, lh, 6);
    ctx.fillStyle = lin(lx, 0, lx + lw, 0, [[0, .82], [.4, 1], [1, .8]], 90, MAT.paper);
    ctx.fill(); outline(2.5, 90);
    ctx.fillStyle = enc(0, 0, MAT.paper);
    ctx.textAlign = "center";
    ctx.font = `900 ${Math.round(lw * .16)}px Fraunces, Georgia, serif`;
    ctx.fillText("HONEYPOT", x, ly + lh * .52);
    ctx.font = `600 ${Math.round(lw * .062)}px "JetBrains Mono", monospace`;
    ctx.fillText("SSH · TELNET · HTTP", x, ly + lh * .8);
    // body outline
    rrect(l, top + h * .1, w, h * .9, w * .2); outline(3.5, 90);
    // neck + lid
    const nw = w * .78;
    rrect(x - nw / 2, top + h * .02, nw, h * .1, 8);
    ctx.fillStyle = lin(x - nw / 2, 0, x + nw / 2, 0, [[0, .5], [.4, .95], [1, .45]], 90, MAT.paper);
    ctx.fill(); outline(3, 90);
    const lidW = w * .9;
    rrect(x - lidW / 2, top - h * .1, lidW, h * .13, 10);
    ctx.fillStyle = lin(x - lidW / 2, 0, x + lidW / 2, 0, CYL.map(([o, v]) => [o, v * .8]), 90, MAT.paper);
    ctx.fill(); outline(3.5, 90);
  }

  function dipper(hx, hy, rot, t) {
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(rot);
    const deg = rot * 180 / Math.PI;
    // handle runs up and to the left of the head
    rrect(-640, -15, 600, 30, 15);
    ctx.fillStyle = lin(0, -15, 0, 15, [[0, .35], [.3, .95], [.7, .8], [1, .3]], deg, MAT.paper);
    ctx.fill(); outline(3, deg);
    // collar
    rrect(-60, -24, 34, 48, 6);
    ctx.fillStyle = lin(0, -24, 0, 24, CYL, deg + 90, MAT.paper);
    ctx.fill(); outline(3, deg);
    // grooved head: stacked discs, fattest in the middle, coated in honey
    const discs = 7;
    for (let i = 0; i < discs; i++) {
      const dx = -18 + i * 22;
      const r = 34 + 22 * Math.sin((i + .5) / discs * Math.PI);
      ctx.beginPath();
      ctx.ellipse(dx, 0, 13, r, 0, 0, Math.PI * 2);
      ctx.fillStyle = lin(0, -r, 0, r, [[0, .4], [.3, .95], [.7, .75], [1, .2]], deg + 90, MAT.spot);
      ctx.fill(); outline(2.5, deg + 90);
    }
    // honey sagging off the bottom of the head
    const sag = 10 + Math.sin(t * 1.7) * 4;
    ctx.beginPath();
    ctx.moveTo(-10, 40);
    ctx.bezierCurveTo(20, 70 + sag, 90, 72 + sag, 120, 36);
    ctx.lineTo(120, 20); ctx.lineTo(-10, 20); ctx.closePath();
    ctx.fillStyle = lin(0, 20, 0, 80, [[0, .85], [1, .4]], deg, MAT.spot);
    ctx.fill(); outline(2.5, deg);
    ctx.restore();
  }

  function stream(x0, y0, x1, y1, width, t, len) {
    if (len <= 0) return;
    const yEnd = lerp(y0, y1, len);
    const steps = 24, pts = [];
    for (let i = 0; i <= steps; i++) {
      const k = i / steps, y = lerp(y0, yEnd, k);
      const wob = Math.sin(k * 7 + t * 3) * 3 * k;
      const wk = width * (1 - .45 * Math.sin(k * Math.PI * .9)) * (k > .96 && len < 1 ? .7 : 1);
      pts.push([lerp(x0, x1, k * len) + wob, y, wk]);
    }
    ctx.beginPath();
    pts.forEach(([x, y, w], i) => i ? ctx.lineTo(x - w / 2, y) : ctx.moveTo(x - w / 2, y));
    for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i][0] + pts[i][2] / 2, pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = lin(x0 - width, 0, x0 + width, 0, [[0, .3], [.45, .95], [1, .35]], 0, MAT.spot);
    ctx.fill(); outline(2.5, 0);
  }

  function bee(x, y, rot, flap) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // wings (behind)
    for (const side of [-1, 1]) {
      ctx.save();
      ctx.rotate(side * (.45 + flap * .5));
      ctx.beginPath();
      ctx.ellipse(-4, side * -22, 13, 24, side * .3, 0, Math.PI * 2);
      ctx.fillStyle = lin(0, -40, 0, 0, [[0, .97], [1, .78]], 30, MAT.paper);
      ctx.fill(); outline(2, 30);
      ctx.restore();
    }
    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, 26, 17, 0, 0, Math.PI * 2);
    ctx.save(); ctx.clip();
    ctx.fillStyle = lin(0, -17, 0, 17, [[0, .45], [.35, .95], [1, .3]], 90, MAT.spot);
    ctx.fillRect(-30, -20, 60, 40);
    for (const sx of [-12, 2]) {
      ctx.fillStyle = lin(0, -17, 0, 17, [[0, .12], [.4, .35], [1, .05]], 90, MAT.paper);
      ctx.fillRect(sx, -20, 8, 40);
    }
    ctx.restore();
    ctx.beginPath(); ctx.ellipse(0, 0, 26, 17, 0, 0, Math.PI * 2); outline(2.5, 90);
    // head + stinger
    ctx.beginPath(); ctx.arc(28, 0, 10, 0, Math.PI * 2);
    ctx.fillStyle = rad(25, -4, 2, 12, [[0, .5], [1, .08]], 60, MAT.paper); ctx.fill(); outline(2.5, 60);
    ctx.beginPath(); ctx.moveTo(-25, -5); ctx.lineTo(-38, 0); ctx.lineTo(-25, 5); ctx.closePath();
    ctx.fillStyle = enc(0, 0, MAT.paper); ctx.fill();
    ctx.restore();
  }

  function dot(x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = enc(1, 0, MAT.white); ctx.fill(); outline(Math.max(2, r * .14), 0);
  }

  function padlock(x, y, lift, wobble) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wobble);
    // shackle (behind the body)
    const R = 118, r = 76, cy = -150 - lift, y0 = -60;
    ctx.beginPath();
    ctx.moveTo(-R, y0); ctx.lineTo(-R, cy); ctx.arc(0, cy, R, Math.PI, 0); ctx.lineTo(R, y0);
    ctx.lineTo(r, y0); ctx.lineTo(r, cy); ctx.arc(0, cy, r, 0, Math.PI, true); ctx.lineTo(-r, y0); ctx.closePath();
    ctx.fillStyle = lin(-R, 0, R, 0, [[0, .3], [.1, .9], [.19, .45], [.81, .45], [.9, .92], [1, .3]], 90, MAT.paper);
    ctx.fill(); outline(3.5, 90);
    // body
    rrect(-175, -70, 350, 290, 26);
    ctx.fillStyle = lin(0, -70, 0, 220, [[0, .98], [.45, .78], [1, .35]], 0, MAT.paper);
    ctx.fill(); outline(4, 0);
    rrect(-150, -45, 300, 240, 16);
    ctx.lineWidth = 2; ctx.strokeStyle = enc(.15, 0, MAT.paper); ctx.stroke();
    // keyhole
    ctx.beginPath(); ctx.arc(0, 50, 30, 0, Math.PI * 2);
    ctx.moveTo(-16, 64); ctx.lineTo(-24, 140); ctx.lineTo(24, 140); ctx.lineTo(16, 64); ctx.closePath();
    ctx.fillStyle = enc(0, 0, MAT.paper); ctx.fill();
    for (const [rx, ry] of [[-130, -25], [130, -25], [-130, 175], [130, 175]]) dot(rx, ry, 9);
    ctx.restore();
  }

  function tag(x, y, rot, text, toX, toY) {
    // string to the lock
    ctx.beginPath(); ctx.moveTo(x, y);
    ctx.quadraticCurveTo((x + toX) / 2, Math.max(y, toY) + 60, toX, toY);
    ctx.lineWidth = 2.5; ctx.strokeStyle = enc(0, 0, MAT.paper); ctx.stroke();
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    const w = 20 + text.length * 19, h = 62;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(26, -h / 2); ctx.lineTo(w, -h / 2); ctx.lineTo(w, h / 2); ctx.lineTo(26, h / 2); ctx.closePath();
    ctx.fillStyle = lin(0, -h / 2, 0, h / 2, [[0, 1], [1, .78]], 25, MAT.paper);
    ctx.fill(); outline(3, 25);
    ctx.beginPath(); ctx.arc(18, 0, 6, 0, Math.PI * 2); ctx.fillStyle = enc(0, 0, MAT.paper); ctx.fill();
    ctx.fillStyle = enc(0, 0, MAT.paper);
    ctx.textAlign = "left";
    ctx.font = `600 30px "JetBrains Mono", monospace`;
    ctx.fillText(text, 36, 10);
    ctx.restore();
  }

  // ---------- the cast ----------
  const rnd = (seed => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(7);
  const BEES = Array.from({ length: 16 }, (_, i) => {
    const a = rnd() * Math.PI * 2;
    return {
      sx: Math.cos(a) * 1300, sy: Math.sin(a) * 900 - 200,          // where it comes from
      arrive: .3 + (i / 16) * .24 + rnd() * .03,                    // when it shows up
      orbit: 170 + rnd() * 170, speed: .35 + rnd() * .5, phase: rnd() * 6.28, tilt: rnd() * .6 - .3,
    };
  });
  const BUBBLES = Array.from({ length: 11 }, () => ({
    x: rnd() * 900 - 300, y: rnd() * 900 - 450, r: 5 + rnd() * 20, s: .2 + rnd() * .6, ph: rnd() * 6.28,
  }));
  const TAGS = [["/.env", -330, -250, -.12], ["/.git/config", 250, -330, .1], ["/wp-login.php", -390, 200, .08], ["/backup.sql", 250, 270, -.1]];

  // ---------- input ----------
  let mx = -9999, my = -9999;
  const cursor = document.querySelector(".cursor");
  let cx = 0, cy = 0;
  addEventListener("pointermove", e => {
    mx = e.clientX; my = e.clientY;
    if (e.pointerType === "mouse") cursor.classList.add("on");
  });
  document.addEventListener("pointerleave", () => cursor.classList.remove("on"));
  document.querySelectorAll("a").forEach(a => {
    a.addEventListener("pointerenter", () => cursor.classList.add("big"));
    a.addEventListener("pointerleave", () => cursor.classList.remove("big"));
  });

  // ---------- scroll ----------
  let target = 0, prog = 0;
  function readScroll() {
    const max = document.documentElement.scrollHeight - innerHeight;
    target = max > 0 ? clamp(scrollY / max) : 0;
  }
  addEventListener("scroll", readScroll, { passive: true });
  if (FIXED !== null) {
    addEventListener("load", () => {
      const max = document.documentElement.scrollHeight - innerHeight;
      scrollTo(0, FIXED * max);
      readScroll(); prog = target;
    });
  }
  readScroll(); prog = target;

  // Sections fade their text in as they arrive.
  const io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add("in")), { threshold: .25 });
  document.querySelectorAll(".scene").forEach(s => io.observe(s));
  function revealAll() { document.querySelectorAll(".scene").forEach(s => s.classList.add("in")); }

  // ---------- frame ----------
  const t0 = performance.now();
  function frame(now) {
    const time = reduceMotion ? 0 : (now - t0) / 1000;
    prog = reduceMotion || FIXED !== null ? target : prog + (target - prog) * .085;
    const p = prog;

    // story beats
    const descend = easeOut(span(p, 0, .14));
    const pour = span(p, .07, .5);
    const pan = ease(span(p, .56, .74));
    const close = span(p, .72, .8);
    const night = ease(span(p, .58, .7));

    // background colour (shader + page)
    const bg = RED.map((c, i) => lerp(c, NIGHT[i], night));
    document.body.style.setProperty("--bg", `rgb(${bg.map(c => Math.round(c * 255)).join(",")})`);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgb(0,0,0)";
    ctx.fillRect(0, 0, scene.width, scene.height);
    ctx.setTransform(dpr * S, 0, 0, dpr * S, CX * dpr, CY * dpr);
    ctx.lineJoin = "round"; ctx.lineCap = "round";

    // pointer in stage units
    const px = (mx - CX) / S, py = (my - CY) / S;

    // --- act 1 & 2: the honeypot ---
    const shift = -pan * 1500;
    if (pan < 1) {
      ctx.save(); ctx.translate(shift, 0);
      for (const b of BUBBLES) {
        const yy = ((b.y - time * 30 * b.s - p * 400) % 1000 + 1000) % 1000 - 500;
        dot(b.x + Math.sin(time * b.s + b.ph) * 14, yy, b.r * (.6 + .4 * descend));
      }
      const jarX = 40, jarBase = 380, jarW = 300, jarH = 380;
      const fill = lerp(.18, .78, ease(pour));
      const hx = lerp(150, 90, descend), hy = lerp(-900, -330, descend) + Math.sin(time * .9) * 6;
      const rot = lerp(-.9, -.32, descend);
      // drip leaves from the lowest point of the head
      const tipX = hx + Math.cos(rot) * 55 - Math.sin(rot) * 72, tipY = hy + Math.sin(rot) * 55 + Math.cos(rot) * 72;
      const honeyTop = jarBase - 9 - (jarH * .9 - 18) * fill;
      const flowing = p < .52 ? 1 : 1 - span(p, .52, .58);
      stream(tipX, tipY, jarX + 10, honeyTop, 20 * flowing + 4, time, ease(span(p, .05, .16)) * flowing);
      jar(jarX, jarBase, jarW, jarH, fill, time);
      dipper(hx, hy, rot, time);
      // bees
      for (const b of BEES) {
        const k = span(p, b.arrive - .08, b.arrive);
        if (k <= 0) continue;
        const ang = b.phase + time * b.speed;
        let ox = jarX + Math.cos(ang) * b.orbit, oy = 120 + Math.sin(ang) * b.orbit * .55 + Math.sin(time * 3 + b.phase) * 10;
        let x = lerp(b.sx, ox, easeOut(k)), y = lerp(b.sy, oy, easeOut(k));
        // they scatter from the cursor
        const dx = x + shift - px, dy = y - py, d = Math.hypot(dx, dy);
        if (d < 190) { x += dx / d * (190 - d) * .9; y += dy / d * (190 - d) * .9; }
        const heading = k < 1 ? Math.atan2(oy - b.sy, ox - b.sx) : ang + Math.PI / 2;
        bee(x, y, heading + b.tilt, Math.abs(Math.sin(time * 38 + b.phase)));
      }
      ctx.restore();
    }

    // --- act 3 & 4: the lock ---
    if (pan > 0) {
      const lx = 1500 + shift + (portrait ? 0 : -40), ly = 60;
      const lift = 95 * (1 - backOut(close));
      const settle = close > 0 && close < 1 ? Math.sin(close * 30) * .03 * (1 - close) : 0;
      for (const [text, ox, oy, r] of TAGS) {
        const sway = Math.sin(time * .8 + ox) * .05;
        tag(lx + ox, ly + oy + Math.sin(time + oy) * 8, r + sway, text, lx, ly - 20);
      }
      padlock(lx, ly, lift, settle + Math.sin(time * .6) * .015);
      if (close >= 1) for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2 + time * .15;
        dot(lx + Math.cos(a) * 470, ly + Math.sin(a) * 380, 6 + (i % 3) * 5);
      }
    }

    // --- engrave it ---
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, scene);
    gl.uniform2f(uRes, glCanvas.width, glCanvas.height);
    gl.uniform3f(uBg, bg[0], bg[1], bg[2]);
    gl.uniform1f(uPeriod, Math.max(3.2, 4.4 * S) * dpr);
    gl.uniform1f(uTime, time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // cursor dot trails the pointer
    cx += (mx - cx) * .2; cy += (my - cy) * .2;
    cursor.style.transform = `translate(${cx}px, ${cy}px)`;

    requestAnimationFrame(frame);
  }
  if (FIXED !== null) revealAll();
  document.fonts && document.fonts.ready.then(() => {}); // canvas text redraws every frame, so late fonts self-correct
  requestAnimationFrame(frame);
})();
