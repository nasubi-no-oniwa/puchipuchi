// プチプチ職人（なすびのお庭）
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TX, LANGS } from './tx.js';

const $ = id => document.getElementById(id);
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v) } catch (e) { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };
const GAME = 'puchipuchi', GAME_URL = 'https://nasubi-no-oniwa.github.io/puchipuchi/';
const QS = new URLSearchParams(location.search);
const OGP = QS.has('ogp'), ICON = QS.has('icon');
const PV = window.__PPPV || null; // 確認用（通信しない）
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ===== きまり =====
const TOL = 50;                 // 許されるずれ（ミリ秒）
const SPEEDS = [200, 300, 400, 500, 600, 700, 800, 900, 1000]; // 速さ（1粒の間隔、ミリ秒）
const MACH_MS = 3, MACH_N = 30; // 30個続けてずれ0.003秒以内なら機械とみなす
const COLS = 8;                 // 1列のプチプチの数
const SAFE = 5;                 // 最初の何個は、つぶれたプチプチを出さない
const DEAD_P = .16;             // つぶれたプチプチが出る割合
const GR_AT = [10, 25, 50, 100, 200, 400, 700, 1000];
const gradeI = n => { let i = 0; while (i < GR_AT.length && n >= GR_AT[i]) i++; return i; };
const fs2 = ms => (ms / 1000).toFixed(1);
const fs3 = ms => (ms / 1000).toFixed(3);

// ===== ことば =====
let lang = ls.get('pp_lang', null) || (() => { const n = (navigator.language || 'ja').toLowerCase(); return n.startsWith('ja') ? 'ja' : n.startsWith('zh') ? 'zh' : n.startsWith('ko') ? 'ko' : 'en'; })();
if (QS.get('lang') && TX[QS.get('lang')]) lang = QS.get('lang');
const t = (k, o) => { let s = (TX[lang] || TX.ja)[k]; if (s == null) s = TX.ja[k]; if (o) for (const [a, b] of Object.entries(o)) s = String(s).split('{' + a + '}').join(b); return s; };
const grade = n => t('grades')[gradeI(n)];
let speed = ls.get('pp_speed', 400); if (!SPEEDS.includes(speed)) speed = 400;
let bestN = ls.get('pp_best', 0) | 0;

// ===== 音 =====
let AC = null, master = null, NB = null;
function ac() { try { if (!AC) { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = .85; master.connect(AC.destination); } if (AC.state === 'suspended') AC.resume(); return AC; } catch (e) { return null; } }
function nbuf() { if (!NB) { NB = AC.createBuffer(1, AC.sampleRate, AC.sampleRate); const d = NB.getChannelData(0); for (let i = 0; i < d.length; i++)d[i] = Math.random() * 2 - 1; } return NB; }
function noise(at, dur, type, f, q, vol, f2) { if (!AC) return; const s = AC.createBufferSource(); s.buffer = nbuf(); s.loop = true; const fl = AC.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, at); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, at + dur); fl.Q.value = q; const g = AC.createGain(); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(.0005, at + dur); s.connect(fl); fl.connect(g); g.connect(master); s.start(at, Math.random() * .5); s.stop(at + dur + .02); }
function tone(at, f, dur, type, vol, f2) { if (!AC) return; const o = AC.createOscillator(), g = AC.createGain(); o.type = type || 'sine'; o.frequency.setValueAtTime(f, at); if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + dur); g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(.0005, at + dur); o.connect(g); g.connect(master); o.start(at); o.stop(at + dur + .02); }
// プチッ（毎回すこしだけ高さを変える）
function sPop(good) { if (!ac()) return; const n = AC.currentTime, k = .85 + Math.random() * .3; noise(n, .035, 'bandpass', 2400 * k, 1.6, .9); noise(n, .012, 'highpass', 5000, .7, .5); tone(n, 190 * k, .05, 'sine', .35, 70); if (good) tone(n + .005, 1900, .05, 'sine', .05); }
function sClick(at, acc) { if (!AC) return; tone(at, acc ? 2100 : 1500, .03, 'square', .07); noise(at, .015, 'highpass', 4000, .7, .15); }
function sDead() { if (!ac()) return; const n = AC.currentTime; noise(n, .18, 'lowpass', 900, .7, .5, 200); tone(n, 140, .2, 'sine', .25, 60); }
function sBad() { if (!ac()) return; const n = AC.currentTime; tone(n, 300, .15, 'square', .08, 200); tone(n + .16, 200, .25, 'square', .08, 130); }
function sFan() { if (!ac()) return; const n = AC.currentTime;[523, 659, 784, 1047].forEach((f, i) => tone(n + i * .08, f, .28, 'triangle', .1)); }
// 音の時計と画面の時計をそろえる
const acToPerf = at => performance.now() + (at - AC.currentTime) * 1000;

// ===== 3D =====
const R = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, preserveDrawingBuffer: OGP || ICON || !!PV });
R.setPixelRatio(Math.min(2, devicePixelRatio || 1)); R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
R.outputColorSpace = THREE.SRGBColorSpace; R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;
const SC = new THREE.Scene(); SC.background = new THREE.Color(0xe9eef2);
{ const pm = new THREE.PMREMGenerator(R); SC.environment = pm.fromScene(new RoomEnvironment(), .04).texture; }
const CAM = new THREE.PerspectiveCamera(40, 1, .05, 80);
let portrait = true, VW = innerWidth, VH = innerHeight;
function resize() { VW = innerWidth; VH = innerHeight; if (OGP || ICON) return; R.setSize(VW, VH, false); CAM.aspect = VW / VH; portrait = VW < VH; CAM.fov = portrait ? 52 : 34; CAM.updateProjectionMatrix(); fxSize(); }
addEventListener('resize', resize);
SC.add(new THREE.HemisphereLight(0xffffff, 0xb8a58a, .7));
const SUN = new THREE.DirectionalLight(0xffffff, 1.5); SUN.position.set(-4, 9, 5); SUN.castShadow = true; SUN.shadow.mapSize.set(1024, 1024);
{ const s = SUN.shadow.camera; s.left = -9; s.right = 9; s.top = 9; s.bottom = -9; s.near = 1; s.far = 30; SUN.shadow.bias = -.0005; }
SC.add(SUN); SC.add(SUN.target);

// 段ボールの机
function kraftTex() { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); g.fillStyle = '#c9a26b'; g.fillRect(0, 0, 512, 512);
 for (let i = 0; i < 2600; i++) { g.fillStyle = Math.random() < .5 ? 'rgba(120,85,40,.10)' : 'rgba(255,240,210,.10)'; g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 3, 1); }
 for (let y = 0; y < 512; y += 16) { g.fillStyle = 'rgba(110,75,35,.07)'; g.fillRect(0, y, 512, 6); }
 const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; }
const KT = kraftTex(); KT.repeat.set(10, 10);
const DESK = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: KT, roughness: .95 })); DESK.rotation.x = -Math.PI / 2; DESK.receiveShadow = true; SC.add(DESK);

// プチプチのシート
const D = 1, RZ = D * .9, BR = .4;
const posOf = i => { const r = Math.floor(i / COLS), c = i % COLS; return [(c - (COLS - 1) / 2) * D + (r % 2 ? D * .25 : -D * .25), r * RZ]; };
const SHEET_MAT = new THREE.MeshPhysicalMaterial({ color: 0xf4fbff, transparent: true, opacity: .42, roughness: .25, clearcoat: .6, side: THREE.DoubleSide, depthWrite: false });
const BUB_MAT = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: .34, roughness: .02, metalness: 0, clearcoat: 1, clearcoatRoughness: .02, envMapIntensity: 3, specularIntensity: 1, depthWrite: false });
const POP_MAT = new THREE.MeshPhysicalMaterial({ color: 0xdbe6ee, transparent: true, opacity: .62, roughness: .55, clearcoat: .3, envMapIntensity: .8, depthWrite: false });
const DEAD_MAT = new THREE.MeshPhysicalMaterial({ color: 0xa9b6c2, transparent: true, opacity: .8, roughness: .7, clearcoat: .2, envMapIntensity: .5, depthWrite: false });
const NEXT_MAT = new THREE.MeshBasicMaterial({ color: 0x2a8fd6, transparent: true, opacity: .55, depthWrite: false });
const DOME = new THREE.SphereGeometry(BR, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2); DOME.scale(1, .72, 1);
const CRUMP = (() => { const g = new THREE.SphereGeometry(BR * 1.04, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const a = Math.atan2(z, x); const w = 1 + .12 * Math.sin(a * 7 + y * 30) + .06 * Math.sin(a * 13); p.setXYZ(i, x * w, y * (.16 + .1 * Math.abs(Math.sin(a * 5 + x * 9))), z * w); } g.computeVertexNormals(); return g; })();
// ふくらんだプチプチのつや（ふちの影と白い光を、上から貼る）
const GLOSS = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
 let gr = g.createRadialGradient(64, 64, 34, 64, 64, 63); gr.addColorStop(0, 'rgba(120,150,175,0)'); gr.addColorStop(.8, 'rgba(110,140,170,.16)'); gr.addColorStop(1, 'rgba(110,140,170,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
 gr = g.createRadialGradient(48, 44, 2, 48, 44, 22); gr.addColorStop(0, 'rgba(255,255,255,.95)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(48, 44, 24, 15, -.6, 0, 6.3); g.fill();
 gr = g.createRadialGradient(84, 88, 1, 84, 88, 10); gr.addColorStop(0, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(70, 74, 28, 28);
 const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const GLOSS_MAT = new THREE.MeshBasicMaterial({ map: GLOSS, transparent: true, depthWrite: false });
const GLOSS_G = new THREE.PlaneGeometry(BR * 2.08, BR * 2.08); GLOSS_G.rotateX(-Math.PI / 2);
const RING = new THREE.RingGeometry(BR * 1.08, BR * 1.24, 40); RING.rotateX(-Math.PI / 2);
const SH = .02; // シートの高さ
const rows = new Map(); // 列の番号 → { g, meshes[] }
let seq = []; // true = ふつうのプチプチ、false = はじめからつぶれている
// 次のプチプチを決める（最初の何個かはかならずふつう。つぶれたのは2個までしか続かない）
function nextVal(withDead) { const i = seq.length; if (!withDead || i < SAFE) return true; let run = 0; for (let j = i - 1; j >= 0 && seq[j] === false; j--) run++; return !(run < 2 && Math.random() < DEAD_P); }
function extendSeq(upto, withDead) { while (seq.length < upto) seq.push(nextVal(withDead)); }
function buildRow(r) { if (rows.has(r)) return rows.get(r); const g = new THREE.Group(); SC.add(g); const z = r * RZ;
 const sh = new THREE.Mesh(new THREE.PlaneGeometry(COLS * D + .9, RZ), SHEET_MAT); sh.rotation.x = -Math.PI / 2; sh.position.set(0, SH, z); sh.renderOrder = 1; g.add(sh);
 const ms = []; for (let c = 0; c < COLS; c++) { const i = r * COLS + c; const [x] = posOf(i); const live = seq[i] !== false; const m = new THREE.Mesh(live ? DOME : CRUMP, live ? BUB_MAT : DEAD_MAT); m.position.set(x, SH, z); m.rotation.y = Math.random() * 6.28; m.castShadow = live; m.renderOrder = 2; m.userData = { i, live, popped: false, a: 1 }; if (live) { const gl = new THREE.Mesh(GLOSS_G, GLOSS_MAT); gl.position.y = BR * .72 * .62; gl.scale.set(.82, 1, .82); gl.rotation.y = -m.rotation.y; gl.renderOrder = 3; m.add(gl); m.userData.gl = gl; } g.add(m); ms.push(m); }
 const o = { g, ms }; rows.set(r, o); return o; }
function bubble(i) { const o = rows.get(Math.floor(i / COLS)); return o ? o.ms[i % COLS] : null; }
function syncRows(cur) { const r0 = Math.floor(cur / COLS); for (let r = r0 - 2; r <= r0 + 7; r++)if (r >= 0) buildRow(r); for (const [r, o] of rows) if (r < r0 - 2 || r > r0 + 8) { SC.remove(o.g); o.g.children[0].geometry.dispose(); rows.delete(r); } }
function clearRows() { for (const [, o] of rows) SC.remove(o.g); rows.clear(); }
function popMesh(m, how) { if (!m || m.userData.popped) return; m.userData.popped = true; if (m.userData.gl) m.userData.gl.visible = false; m.geometry = CRUMP; m.material = POP_MAT; m.castShadow = false; m.userData.a = 0; m.userData.how = how || 1; }
function stepBubbles(dt) { for (const [, o] of rows) for (const m of o.ms) { const u = m.userData; if (u.a < 1) { u.a = Math.min(1, u.a + dt / .18); const k = u.a; const s = 1 + Math.sin(k * Math.PI) * .25 * (1 - k); m.scale.set(s, 1 - Math.sin(k * Math.PI) * .5, s); } } }
// 次につぶすプチプチの印
const MARK = new THREE.Mesh(RING, NEXT_MAT); MARK.position.y = SH + .005; MARK.renderOrder = 3; SC.add(MARK);

// 指
const SKIN = new THREE.MeshStandardMaterial({ color: 0xe0a07a, roughness: .55 });
const NAIL = new THREE.MeshStandardMaterial({ color: 0xffe9e4, roughness: .25 });
const FINGER = new THREE.Group(); SC.add(FINGER);
{ const f = new THREE.Mesh(new THREE.CapsuleGeometry(.24, 1.8, 6, 16), SKIN); f.position.y = 1.0; f.castShadow = true; FINGER.add(f);
 const k = new THREE.Mesh(new THREE.TorusGeometry(.2, .02, 6, 20), new THREE.MeshStandardMaterial({ color: 0xd9a988, roughness: .7 })); k.rotation.x = Math.PI / 2; k.position.y = .95; FINGER.add(k);
 const n = new THREE.Mesh(new THREE.SphereGeometry(.17, 16, 10), NAIL); n.scale.set(.9, .45, 1.1); n.position.set(0, .3, .12); FINGER.add(n); }
FINGER.rotation.set(.35, 0, -.55);
let fX = 0, fZ = 0, fXT = 0, fZT = 0, fY = .9, fYT = .9, press = 0;
function fingerTo(i) { const [x, z] = posOf(i); fXT = x; fZT = z; }
function fingerStep(dt) { const a = 1 - Math.exp(-dt * 26); fX += (fXT - fX) * a; fZ += (fZT - fZ) * a; press = Math.max(0, press - dt / .09); fYT = press > 0 ? .12 : .75; fY += (fYT - fY) * (1 - Math.exp(-dt * (press > 0 ? 60 : 18))); FINGER.position.set(fX + .12, fY, fZ + .1); }

// カメラ（列の真ん中を、少し手前の上から見る）
const camP = new THREE.Vector3(0, 9, 8), camL = new THREE.Vector3(), camPT = new THREE.Vector3(), camLT = new THREE.Vector3(); let camK = 4, shake = 0;
// 列の幅がちょうど画面に入る距離から見る
const CDIR = new THREE.Vector3(0, .88, .47).normalize();
function camDist() { const W = COLS * D + 1.4, Hn = 7.5; const vf = CAM.fov * Math.PI / 360; const hf = Math.atan(Math.tan(vf) * CAM.aspect); return Math.max((W / 2) / Math.tan(hf), (Hn / 2) / Math.tan(vf)) * 1.02; }
function camRow(i, far) { const r = Math.floor(i / COLS); const z = r * RZ; camLT.set(0, 0, z + (portrait ? 2.0 : 1.4)); camPT.copy(camLT).addScaledVector(CDIR, camDist() + (far || 0)); }
function camStep(dt) { const a = 1 - Math.exp(-dt * camK); camP.lerp(camPT, a); camL.lerp(camLT, a); CAM.position.copy(camP); if (shake > 0) { CAM.position.x += (Math.random() - .5) * shake; CAM.position.y += (Math.random() - .5) * shake; shake *= Math.exp(-dt * 9); if (shake < .002) shake = 0; } CAM.lookAt(camL); SUN.position.set(camL.x - 4, 9, camL.z + 5); SUN.target.position.copy(camL); }

// ===== ドット絵の演出（道具箱の pixelfx。MIT） =====
// つぶすたびに小さな火花、10個ごとに光がはじける。読みこめなくてもゲームはそのまま動く
const FXC = $('fx'), fxg = FXC.getContext('2d');
function fxSize() { const d = Math.min(2, devicePixelRatio || 1); FXC.width = VW * d; FXC.height = VH * d; fxg.setTransform(d, 0, 0, d, 0, 0); PX.s = 2; }
const PX = { ok: false, core: null, mods: {}, list: [], frame: null, img: null, cv: document.createElement('canvas'), g: null, s: 3, w: 0, h: 0 };
PX.g = PX.cv.getContext('2d');
if (!OGP && !ICON) Promise.all([import('./pixelfx/core/index.js'), import('./pixelfx/fx/impacts/hit-spark.js'), import('./pixelfx/fx/pickups/collect-burst.js')]).then(([c, a, b]) => { PX.core = c; PX.mods.spark = a; PX.mods.burst = b; PX.ok = true; }).catch(() => { });
const PAL_SPARK = ['#0d2238', '#1d4f7a', '#2a8fd6', '#6cc3ff', '#bfe6ff', '#eaf7ff', '#ffffff'];
const PAL_BURST = ['#06162a', '#0e3256', '#1b5c92', '#2a8fd6', '#5cb8ff', '#a6dcff', '#e0f3ff', '#ffffff'];
function pxSpawn(name, sx, sy, pal, extra) { if (!PX.ok || PX.list.length >= 4) return; try { PX.list.push(PX.core.createFx(PX.mods[name], Object.assign({ x: Math.round(sx / PX.s), y: Math.round(sy / PX.s), palette: pal, seed: (Math.random() * 1e6) | 0 }, extra || {}))); } catch (e) { } }
const _v = new THREE.Vector3();
function proj(x, y, z) { _v.set(x, y, z); _v.project(CAM); return [(_v.x * .5 + .5) * VW, (-_v.y * .5 + .5) * VH]; }
function fxPop(i, n) { const [x, z] = posOf(i); const p = proj(x, .2, z); if (n > 0 && n % 10 === 0) pxSpawn('burst', p[0], p[1] + 20 * PX.s, PAL_BURST); else pxSpawn('spark', p[0], p[1], PAL_SPARK, { height: 0, aim: -1.57 + (Math.random() - .5) * 1.2 }); }
function pxStep(dt) { if (!PX.list.length) return; for (const f of PX.list) f.update(dt); PX.list = PX.list.filter(f => !f.done()); }
function pxDraw() { fxg.clearRect(0, 0, VW, VH); if (!PX.ok || !PX.list.length) return; const w = Math.ceil(VW / PX.s), h = Math.ceil(VH / PX.s);
 if (!PX.frame || PX.w !== w || PX.h !== h) { PX.w = w; PX.h = h; PX.frame = PX.core.createFrame(w, h); PX.img = new ImageData(w, h); PX.cv.width = w; PX.cv.height = h; }
 PX.core.clearFrame(PX.frame); for (const f of PX.list) f.draw(PX.frame); PX.core.composite(PX.frame, PX.img.data, null); PX.g.putImageData(PX.img, 0, 0);
 fxg.save(); fxg.imageSmoothingEnabled = false; fxg.drawImage(PX.cv, 0, 0, w * PX.s, h * PX.s); fxg.restore(); }

// ===== 画面の動き（道具箱の GSAP。読みこめないときは動きなしで出す） =====
const GS = () => window.gsap || null;
function gsBump() { const g = GS(); if (!g) return; g.fromTo($('hudN'), { scale: 1.3 }, { scale: 1, duration: .22, ease: 'back.out(3)', overwrite: true }); }
function gsTitle() { const g = GS(); if (!g) return; g.fromTo($('tTitle'), { scale: .4, rotation: -8 }, { scale: 1, rotation: 0, duration: .8, ease: 'elastic.out(1,.5)', overwrite: true }); g.fromTo('#tSpds button', { y: 16, scale: .7 }, { y: 0, scale: 1, duration: .4, ease: 'back.out(2.4)', stagger: .03, overwrite: true }); }
function gsResult(n) { const g = GS(); const card = $('result').querySelector('.card'); const put = v => { $('rNum').innerHTML = v + '<small>' + esc(t('pcs')) + '</small>'; };
 if (!g) { put(n); return; } g.fromTo(card, { y: 70 }, { y: 0, duration: .5, ease: 'back.out(1.6)', overwrite: true });
 const o = { v: 0 }; g.to(o, { v: n, duration: Math.min(1.4, .4 + n * .015), ease: 'power3.out', delay: .1, onUpdate: () => put(Math.round(o.v)), onComplete: () => { put(n); g.fromTo($('rNum'), { scale: 1.3 }, { scale: 1, duration: .35, ease: 'back.out(3)' }); } }); }

// ===== 画面 =====
const PANELS = ['title', 'result', 'rankPanel'];
function show(id) { PANELS.forEach(p => $(p).hidden = (p !== id)); }
function cap(h, pop) { const c = $('cap'); if (c.innerHTML !== h) { c.innerHTML = h; if (pop && h) { c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop'); } } }
function big(h) { const b = $('big'); b.innerHTML = h; if (h) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } }
function hudOn(on) { $('hud').hidden = !on; $('tap').hidden = !on; }
function setN(n, bump) { $('hudN').innerHTML = n + '<small>' + esc(t('pcs')) + '</small>'; if (bump) gsBump(); }
function showBest() { const f = bestN ? bestN + t('pcs') : t('none'); $('tBest').textContent = t('best') + '：' + f; $('hudBest').textContent = t('best') + ' ' + f; }
function spdBtns(box, onPick) { box.innerHTML = SPEEDS.map(s => '<button data-s="' + s + '"' + (s === speed ? ' class="on"' : '') + '>' + esc(t('spd', { s: fs2(s) })) + '</button>').join(''); box.querySelectorAll('button').forEach(b => b.onclick = e => { e.stopPropagation(); ac(); speed = +b.dataset.s; ls.set('pp_speed', speed); box.querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.s === speed)); if (onPick) onPick(); }); }
function applyLang() {
 document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : lang; document.title = lang === 'en' ? 'BUBBLE WRAP MASTER' : 'プチプチ職人';
 $('tTitle').innerHTML = t('title'); $('tHow').innerHTML = t('how'); $('tHow2').textContent = t('how2'); $('tSpdL').textContent = t('speedL'); spdBtns($('tSpds'));
 $('nameIn').placeholder = t('name'); $('nameIn').value = ls.get('pp_name', '');
 $('startBtn').textContent = t('start'); $('pracBtn').textContent = t('practice'); $('rankBtn').textContent = t('rank'); $('hudTitle').textContent = t('hud');
 $('againBtn').textContent = t('again'); $('xBtn').textContent = t('xpost'); $('rRank').textContent = t('rank'); $('rTop').textContent = t('top'); $('renameBtn').textContent = t('rename'); $('rName').placeholder = t('name');
 $('rkTitle').textContent = t('rank'); $('rkNote').textContent = t('rkNote'); $('tabDay').textContent = t('today'); $('tabAll').textContent = t('alltime'); $('rankBack').textContent = t('top');
 $('prBack').textContent = t('prBack'); $('prGo').textContent = t('prGo'); $('gL').textContent = '−0.05'; $('gR').textContent = '+0.05';
 $('langs').innerHTML = LANGS.map(([k, l]) => '<button data-l="' + k + '"' + (k === lang ? ' class="on"' : '') + '>' + l + '</button>').join('');
 $('langs').querySelectorAll('button').forEach(b => b.onclick = () => { lang = b.dataset.l; ls.set('pp_lang', lang); applyLang(); }); showBest(); }
function myName() { return ls.get('pp_name', '') || t('anon'); }

// ===== 状態 =====
// title / practice / count（4拍の合図）/ play / fail / result
let mode = 'title', mT = 0, G = {};
function resetSheet(withDead) { clearRows(); seq = []; extendSeq(COLS * 12, withDead); G.cur = 0; syncRows(0); fingerTo(0); fX = fXT; fZ = fZT; MARK.visible = true; markTo(0); camRow(0); }
function markTo(i) { const [x, z] = posOf(i); MARK.position.x = x; MARK.position.z = z; MARK.visible = seq[i] !== false; }
function advance() { G.cur++; extendSeq(G.cur + COLS * 10, G.dead); syncRows(G.cur); fingerTo(G.cur); markTo(G.cur); camRow(G.cur); }
function showTitle() { mode = 'title'; mT = 0; stopMetro(); show('title'); hudOn(false); $('prBar').hidden = true; big(''); cap(''); G = { dead: true }; resetSheet(true); applyLang(); gsTitle(); }
$('startBtn').onclick = () => { const n = $('nameIn').value.trim(); if (n && badName(n)) { $('tBest').textContent = t('badname'); return; } ls.set('pp_name', n); ac(); begin(); };
$('pracBtn').onclick = () => { const n = $('nameIn').value.trim(); if (n && !badName(n)) ls.set('pp_name', n); ac(); practice(); };

// --- 本番 ---
function begin() {
 show(null); hudOn(true); $('prBar').hidden = true; big(''); showBest(); stopMetro();
 G = { dead: true, n: 0, last: null, k: 1, tight: 0, ticket: null, iv: speed, errs: [] }; resetSheet(true);
 setN(0); $('hudIv').textContent = t('ivL', { s: fs2(speed) }); $('gauge').hidden = false; $('gMark').style.left = '50%'; $('hudErr').textContent = ''; $('hudErr').className = ''; $('beat').hidden = false;
 mode = 'count'; mT = 0; cap(t('ready'), true);
 // 4拍の合図（音は4回で止まる）
 const a = ac(); const st = a ? a.currentTime + .6 : 0; G.beats = [];
 for (let b = 0; b < 4; b++) { const at = st + b * speed / 1000; if (a) sClick(at, b === 0); G.beats.push(a ? acToPerf(at) : performance.now() + 600 + b * speed); }
 G.openAt = G.beats[3] + speed / 2; // 4拍目の半拍後から、1個目を押せる
}
function tap(ts) {
 if (mode === 'practice') { prTap(ts); return; }
 if (mode === 'count') { if (ts < G.beats[3] + speed * .5 - TOL - 20) return; mode = 'play'; cap(t('go'), true); G.capT = 1.6; firstPop(ts); return; }
 if (mode !== 'play') return;
 const i = G.cur;
 if (seq[i] === false) { failDead(ts); return; }
 const e = ts - (G.last + G.k * G.iv);
 if (Math.abs(e) > TOL) { fail(e); return; }
 doPop(ts, e);
 G.tight = Math.abs(e) <= MACH_MS ? G.tight + 1 : 0; if (G.tight >= MACH_N) machine();
}
function firstPop(ts) { G.ticket = takeTicket(); doPop(ts, null); }
function doPop(ts, e) { const i = G.cur; popMesh(bubble(i)); press = 1; G.n++; G.last = ts; G.k = 1; sPop(e != null && Math.abs(e) <= 10); vib(10); setN(G.n, true); fxPop(i, G.n); if (e != null) { judge(e); G.errs.push(Math.round(e)); } advance(); }
function vib(p) { try { navigator.vibrate && navigator.vibrate(p); } catch (_) { } }
function judge(e) { const a = Math.abs(e); const el = $('hudErr'); const w = a <= 10 ? 'j1' : a <= 25 ? 'j2' : 'j3'; el.className = a <= 25 ? 'g' : 'y'; el.innerHTML = (e >= 0 ? '+' : '−') + fs3(a) + '<small>' + esc(t(w)) + '</small>'; $('gMark').style.left = (50 + clamp(e / TOL, -1.15, 1.15) * 50) + '%'; }
function playUpdate(now) {
 if (G.capT > 0) { G.capT -= 1 / 60; if (G.capT <= 0) cap(''); }
 // つぶれたプチプチは、時間がたつと自動で通りすぎる（押さずに休めた）
 let guard = 0; while (seq[G.cur] === false && now > G.last + G.k * G.iv + G.iv / 2 && guard++ < 4) { const m = bubble(G.cur); if (m) { m.userData.a = .4; } G.k++; advance(); }
 const late = now - (G.last + G.k * G.iv); if (seq[G.cur] !== false && late > TOL + 30) fail(late);
}
function endRun() { mode = 'fail'; mT = 0; $('beat').hidden = true; cap(''); }
function fail(e) { endRun(); G.err = e; G.why = e < 0 ? 'early' : 'late'; shake = .08; sBad(); vib([60, 40, 120]);
 const el = $('hudErr'); el.className = 'r'; el.innerHTML = (e >= 0 ? '+' : '−') + fs3(Math.abs(e)) + '<small>' + esc(t(e < 0 ? 'early' : 'late')) + '</small>'; $('gMark').style.left = (50 + clamp(e / TOL, -1.25, 1.25) * 50) + '%';
 const m = bubble(G.cur); if (m && seq[G.cur] !== false) { popMesh(m); m.material = DEAD_MAT; } press = 1; big(t('failZure')); }
function failDead() { endRun(); G.why = 'dead'; shake = .05; sDead(); vib([30, 30, 30]); press = 1; const m = bubble(G.cur); if (m) { m.userData.a = 0; } big(t('failDead') + '<small>' + esc(t('failDeadSub')) + '</small>'); }
function machine() { endRun(); G.machine = 1; big(t('machineBig') + '<small>' + esc(t('machineSub')) + '</small>'); sBad(); }
function failUpdate() { if (mT >= 1.7) showResult(); }

// --- 練習（終わらない。音は鳴り続ける） ---
let metro = null;
function stopMetro() { if (metro) { clearInterval(metro.id); metro = null; } }
function startMetro() { stopMetro(); const a = ac(); if (!a) return; metro = { next: a.currentTime + .4, n: 0, beats: [] };
 const sched = () => { if (!metro) return; while (metro.next < AC.currentTime + .15) { sClick(metro.next, metro.n % 4 === 0); metro.beats.push(acToPerf(metro.next)); if (metro.beats.length > 16) metro.beats.shift(); metro.next += speed / 1000; metro.n++; } };
 sched(); metro.id = setInterval(sched, 25); }
function practice() { show(null); hudOn(true); big(''); mode = 'practice'; mT = 0; G = { dead: false, n: 0, last: null, iv: speed }; resetSheet(false);
 setN(0); $('hudIv').textContent = t('prHud') + ' ・ ' + t('ivL', { s: fs2(speed) }); $('hudBest').textContent = ''; $('gauge').hidden = false; $('gMark').style.left = '50%'; $('hudErr').textContent = ''; $('beat').hidden = false;
 $('prBar').hidden = false; spdBtns($('prSpds'), () => { G.iv = speed; G.last = null; $('hudIv').textContent = t('prHud') + ' ・ ' + t('ivL', { s: fs2(speed) }); startMetro(); }); cap(t('prHow'), true); startMetro(); }
function prTap(ts) { const i = G.cur; popMesh(bubble(i)); press = 1; G.n++; sPop(false); setN(G.n, true); fxPop(i, G.n);
 if (G.last != null && Math.abs(ts - G.last - G.iv) < G.iv * .5) judge(ts - G.last - G.iv); else { $('hudErr').textContent = ''; $('gMark').style.left = '50%'; }
 G.last = ts; advance(); if (G.n === 3) cap(''); }
$('prBack').onclick = e => { e.stopPropagation(); showTitle(); };
$('prGo').onclick = e => { e.stopPropagation(); begin(); };

// 押す（画面のどこでも・スペースキー）
$('tap').addEventListener('pointerdown', e => { e.preventDefault(); ac(); tap(e.timeStamp); });
addEventListener('keydown', e => { if (e.repeat) return; if ((e.code === 'Space' || e.code === 'Enter') && (mode === 'count' || mode === 'play' || mode === 'practice')) { e.preventDefault(); ac(); tap(e.timeStamp); } });
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'practice') stopMetro(); else if (!document.hidden && mode === 'practice') startMetro(); });

// ===== 結果 =====
let resKind = 'run';
function showResult() { mode = 'result'; mT = 0; resKind = G.machine ? 'machine' : 'run'; show('result'); hudOn(false); big(''); cap('');
 $('rName').hidden = true; $('renameBtn').hidden = true; $('sendMsg').textContent = ''; $('sendMsg').className = 'note';
 const n = G.n; $('rIv').textContent = t('ivL', { s: fs2(G.iv) });
 if (G.machine) { $('rHead').textContent = t('machineBig'); $('rNum').innerHTML = n + '<small>' + esc(t('pcs')) + '</small>'; $('rGrade').textContent = ''; $('rNote').textContent = t('machineNote'); return; }
 $('rHead').textContent = t('rHead'); gsResult(n); $('rGrade').textContent = t('ttlFmt', { g: grade(n) });
 const why = G.why === 'dead' ? t('failDeadN') : G.err == null ? '' : (G.err < 0 ? t('failEarly', { e: fs3(-G.err) }) : t('failLate', { e: fs3(G.err) }));
 if (n < 3) { $('rNote').textContent = why + ' / ' + t('short'); return; }
 const nb = !bestN || n > bestN; $('rNote').textContent = why + (nb ? ' / ' + t('newbest') : ''); if (nb) sFan();
 if (!G.sentStarted) { G.sentStarted = 1; submit(); } }
$('againBtn').onclick = () => { ac(); begin(); };
$('rTop').onclick = () => showTitle();
function postText() { return (resKind === 'machine' ? t('postMachine', { n: G.n }) : t('post', { n: G.n, s: fs2(G.iv), g: grade(G.n) })) + '\n' + t('tags'); }
// Xの投稿で引用するツイート（なすびのお庭の管理ページ quote/ で日本語・英語を貼りかえられる）
let QUOTE = {}; if (!PV) fetch('https://ft-red-default-rtdb.asia-southeast1.firebasedatabase.app/xquote/g/' + GAME + '.json').then(r => r.json()).then(d => { if (d && typeof d === 'object') QUOTE = d; }).catch(() => { });
function quoteURL() { const u = (lang === 'ja' ? QUOTE.ja : QUOTE.en) || ''; return /^https:\/\/x\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{5,25}$/.test(u) ? u : ''; }
function xIntent(text, url) { const q = quoteURL(); return 'https://x.com/intent/post?text=' + encodeURIComponent(q ? text + '\n' + url : text) + '&url=' + encodeURIComponent(q || url); }
$('xBtn').onclick = () => { const u = xIntent(postText(), GAME_URL); const w = window.open(u, '_blank'); if (!w) location.href = u; };

// ===== ランキング（Firebase：ft-blue の puchi の下） =====
const FBS = {
 red: { apiKey: 'AIzaSyBCzVyblBmfNQq4XdPHdQppE94gyiYxDkA', databaseURL: 'https://ft-red-default-rtdb.asia-southeast1.firebasedatabase.app' },
 blue: { apiKey: 'AIzaSyB2iLUuAyxSJ45RewGrbyLg0sYLsC7njIo', databaseURL: 'https://ft-blue-default-rtdb.asia-southeast1.firebasedatabase.app' }
};
const FB = FBS.blue;
const NG = ['ちんこ', 'ちんぽ', 'まんこ', 'せっくす', 'セックス', 'きんたま', 'レイプ', '死ね', 'しね', '殺す', 'ころす', 'ガイジ', 'キチガイ', 'きちがい', 'ニガー', 'チョン', '支那', 'fuck', 'shit', 'bitch', 'cunt', 'dick', 'pussy', 'nigger', 'nigga', 'faggot', 'retard', 'whore', 'slut', 'rape', 'porn', 'nazi', 'hitler', '씨발', '시발', '병신', '좆', '肏', '屄', '屌', '幹你'];
const badName = s => { const n = s.normalize('NFKC').toLowerCase().replace(/[\s・._\-ー〜~!！?？*＊]/g, ''); return NG.some(w => n.includes(w.normalize('NFKC').toLowerCase())); };
async function fetchR(url, opt) { let err; for (let i = 0; i < 3; i++) { try { return await fetch(url, opt); } catch (e) { err = e; await new Promise(r => setTimeout(r, 500 * (i + 1))); } } throw err; }
let AUTH = null, authP = null;
function fbAuth() { if (PV) return Promise.reject(new Error('pv')); if (AUTH && AUTH.exp > Date.now() + 60000) return Promise.resolve(AUTH); if (!authP) authP = fbAuth0().then(a => { AUTH = a; authP = null; return a; }, e => { authP = null; throw e; }); return authP; }
async function fbAuth0() {
 let a = AUTH || ls.get('pp_auth', null); if (a && a.exp > Date.now() + 60000) return a;
 if (a && a.refresh) { try { const r = await fetchR('https://securetoken.googleapis.com/v1/token?key=' + FB.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(a.refresh) });
  if (r.ok) { const j = await r.json(); a = { uid: j.user_id, token: j.id_token, refresh: j.refresh_token, exp: Date.now() + (+j.expires_in) * 1000 }; ls.set('pp_auth', a); return a; } } catch (_) { } }
 const r = await fetchR('https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=' + FB.apiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ returnSecureToken: true }) });
 if (!r.ok) throw new Error('auth'); const j = await r.json(); a = { uid: j.localId, token: j.idToken, refresh: j.refreshToken, exp: Date.now() + (+j.expiresIn) * 1000 }; ls.set('pp_auth', a); return a; }
if (!PV && !OGP && !ICON) fbAuth().catch(() => { });
const DB = p => FB.databaseURL + '/puchi/' + p;
const QA = a => '.json?auth=' + encodeURIComponent(a.token);
const PUT = (url, body) => fetchR(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// ずる対策：1個目をつぶした瞬間にサーバーの時計を書く。記録はその時刻から「個数×間隔」の時間が実際にたっていないと載らない
function takeTicket() { if (PV) return Promise.resolve(Date.now());
 const once = async () => { const a = await fbAuth(); const r = await PUT(DB('runs/' + a.uid) + QA(a), { t: { '.sv': 'timestamp' } }); if (!r.ok) throw new Error('ticket ' + r.status);
  const j = await r.json(); let st = j && j.t; if (typeof st !== 'number') { const g = await fetchR(DB('runs/' + a.uid + '/t') + QA(a)); st = await g.json(); } if (typeof st !== 'number') throw new Error('ticket t'); return st; };
 return (async () => { const wait = [700, 1500, 2200, 3000, 5000]; for (let i = 0; ; i++) { try { return await once(); } catch (e) { console.warn(e); if (i >= wait.length) return null; await new Promise(r => setTimeout(r, wait[i])); } } })(); }
const dayKey = ms => Math.floor((ms + 32400000) / 86400000);
const DS = 1000000, TOPN = 100;
let sendState = {};
async function submit() { const n = G.n, iv = G.iv; const nb = !bestN || n > bestN; if (nb) { bestN = n; ls.set('pp_best', bestN); }
 sendState = { msg: '', cls: '', canRename: false }; const run = G;
 const setMsg = (m, c) => { sendState.msg = m; sendState.cls = c; if (!$('result').hidden && G === run) { $('sendMsg').textContent = m; $('sendMsg').className = 'note ' + c; } };
 if (PV) { setMsg(t('sent2', { d: rankTxt(1), a: rankTxt(1) }), 'ok'); return; }
 setMsg(t('sending'), '');
 try { const st = await run.ticket; if (st == null) { setMsg(t('offline'), 'err'); return; }
  const a = await fbAuth(); const rec = { n: myName(), s: n, st, iv, v: 1, t: { '.sv': 'timestamp' } }; const dk = dayKey(Date.now()); const recD = { ...rec, dk, ds: dk * DS + n }; run.sent = { rec, recD };
  const cur = await fetchR(DB('all/scores/' + a.uid) + '.json').then(x => x.ok ? x.json() : null).catch(() => null);
  const curD = await fetchR(DB('d/scores/' + a.uid) + '.json').then(x => x.ok ? x.json() : null).catch(() => null);
  const okAll = !cur || cur.s < n, okD = !curD || curD.dk !== dk || curD.s < n;
  if (okD) { const res = await PUT(DB('d/scores/' + a.uid) + QA(a), recD); if (res.ok) run.sent.d = 1; }
  if (okAll) { const res = await PUT(DB('all/scores/' + a.uid) + QA(a), rec); if (res.ok) run.sent.all = 1; }
  if (!run.sent.d && !run.sent.all) { setMsg(okAll || okD ? t('senderr') : t('notbetter'), okAll || okD ? 'err' : ''); return; }
  sendState.canRename = true; const [rd, ra] = await Promise.all([myRank('d', a.uid), myRank('all', a.uid)]); setMsg(t('sent2', { d: rankTxt(rd), a: rankTxt(ra) }), 'ok');
  if (!$('result').hidden && G === run && !ls.get('pp_name', '')) { $('rName').hidden = false; $('renameBtn').hidden = false; }
 } catch (e) { console.warn(e); setMsg(t('senderr'), 'err'); } }
$('renameBtn').onclick = async () => { const nm = $('rName').value.trim(), m = $('sendMsg'); const r = G;
 if (!nm) { m.textContent = t('needname'); m.className = 'note err'; return; } if (badName(nm)) { m.textContent = t('badname'); m.className = 'note err'; return; }
 ls.set('pp_name', nm); if (!r || !r.sent) return; $('renameBtn').disabled = true;
 try { const a = await fbAuth(); if (r.sent.d) { const res = await PUT(DB('d/scores/' + a.uid) + QA(a), { ...r.sent.recD, n: nm }); if (!res.ok) throw 0; } if (r.sent.all) { const res = await PUT(DB('all/scores/' + a.uid) + QA(a), { ...r.sent.rec, n: nm }); if (!res.ok) throw 0; }
  m.textContent = t('renamed'); m.className = 'note ok'; $('rName').hidden = true; $('renameBtn').hidden = true; } catch (e) { m.textContent = t('senderr'); m.className = 'note err'; }
 $('renameBtn').disabled = false; };
async function loadBoard(board) { const today = dayKey(Date.now());
 const url = board === 'd' ? DB('d/scores') + '.json?orderBy=%22ds%22&startAt=' + (today * DS) + '&endAt=' + (today * DS + DS - 1) + '&limitToLast=' + TOPN : DB('all/scores') + '.json?orderBy=%22s%22&limitToLast=' + TOPN;
 const [d, h] = await Promise.all([fetch(url).then(r => { if (!r.ok) throw 0; return r.json() }), fetch(DB('hidden') + '.json').then(r => r.ok ? r.json() : null).catch(() => null)]);
 return Object.entries(d || {}).map(([id, v]) => ({ ...v, id })).filter(r => !(h && h[r.id]) && typeof r.s === 'number').sort((a, b) => b.s - a.s || a.t - b.t); }
const rankTxt = r => r ? t('rankN', { r }) : t('rankOut');
async function myRank(board, uid) { try { const rows = await loadBoard(board); const i = rows.findIndex(r => r.id === uid); return i >= 0 ? i + 1 : null; } catch (e) { return null; } }
let rankFrom = false;
const rowH = (r, i, me) => '<tr' + (me ? ' class="me"' : '') + '><td class="r">' + (i + 1) + '</td><td class="n">' + esc(r.n) + '<br><small style="color:var(--sub);font-size:11px">' + esc(grade(r.s)) + (typeof r.iv === 'number' ? ' ・ ' + esc(t('ivL', { s: fs2(r.iv) })) : '') + '</small></td><td class="c">' + r.s + esc(t('pcs')) + '</td></tr>';
async function openRank(board, fromResult) { rankFrom = !!fromResult; show('rankPanel'); $('tabDay').classList.toggle('on', board === 'd'); $('tabAll').classList.toggle('on', board === 'all'); $('tabDay').onclick = () => openRank('d', rankFrom); $('tabAll').onclick = () => openRank('all', rankFrom);
 const box = $('rankBox'); box.innerHTML = '<p>' + t('loading') + '</p>';
 if (PV) { box.innerHTML = '<table class="rank">' + rowH({ n: myName(), s: bestN || 24, iv: 400 }, 0, true) + '</table>'; return; }
 try { const rows = await loadBoard(board); const myId = (ls.get('pp_auth', null) || {}).uid;
  let h = '<table class="rank">' + rows.slice(0, TOPN).map((r, i) => rowH(r, i, r.id === myId)).join('');
  if (!rows.length) h += '<tr><td></td><td colspan="2">' + t('empty') + '</td></tr>'; box.innerHTML = h + '</table>';
 } catch (e) { box.innerHTML = '<p>' + t('rankerr') + '</p>'; } }
$('rankBtn').onclick = () => openRank('d'); $('rRank').onclick = () => openRank('d', true);
$('rankBack').onclick = () => { if (rankFrom) show('result'); else showTitle(); };

// ===== まわす =====
let last = performance.now(), demoT = 0;
function beatLamp(now) { const L = $('beat'); let on = false; const bs = (mode === 'count' || mode === 'play') ? G.beats : mode === 'practice' && metro ? metro.beats : null; if (bs) for (const b of bs) if (now >= b && now < b + 80) on = true; L.classList.toggle('on', on); }
function loop(now) { requestAnimationFrame(loop); const dt = Math.min(.05, Math.max(0, (now - last) / 1000)); last = now; mT += dt;
 if (mode === 'title' || mode === 'result' || mode === 'rank') { // 後ろで、ゆっくりひとりでにつぶれていく
  demoT += dt; if (demoT > .55) { demoT = 0; if (seq[G.cur] !== false) { popMesh(bubble(G.cur)); press = 1; } advance(); } camK = 1.6; }
 else if (mode === 'count') { camK = 6; beatLamp(now); if (now > G.openAt + 5000) { /* 合図のあと押されないときは、そのまま待つ */ } }
 else if (mode === 'play') { camK = 6; beatLamp(now); playUpdate(now); }
 else if (mode === 'practice') { camK = 6; beatLamp(now); }
 else if (mode === 'fail') { camK = 3; failUpdate(); }
 fingerStep(dt); stepBubbles(dt); camStep(dt); pxStep(dt); R.render(SC, CAM); pxDraw(); }

// ===== はじめ =====
function stillScene(w, h, sq) { R.setPixelRatio(1); R.setSize(w, h, false); CAM.aspect = w / h; CAM.fov = sq ? 40 : 34; CAM.updateProjectionMatrix(); portrait = false;
 G = { dead: true }; clearRows(); seq = []; extendSeq(COLS * 12, true); for (let i = 0; i < 11; i++) seq[i] = true; seq[11] = false; seq[13] = false; syncRows(0);
 for (let i = 0; i < 10; i++) { const m = bubble(i); popMesh(m); m.userData.a = 1; m.scale.set(1, 1, 1); } G.cur = 10; fingerTo(10); fX = fXT; fZ = fZT; fY = .2; FINGER.position.set(fX + .12, fY, fZ + .1); markTo(10);
 if (sq) { camP.set(.4, 5.4, 5.0); camL.set(.4, 0, .9); } else { camP.set(-.4, 6.6, 7.4); camL.set(-2.0, 0, 1.5); }
 CAM.position.copy(camP); CAM.lookAt(camL); SUN.position.set(camL.x - 4, 9, camL.z + 5); SUN.target.position.copy(camL); R.render(SC, CAM); }
if (OGP) { document.body.style.width = '1200px'; document.body.style.height = '630px'; $('fx').hidden = true; $('ogpT').hidden = false; $('ogpT').innerHTML = '<b>' + esc(t('ogp1')) + '</b><i>' + esc(t('ogp2')) + '</i><s>' + esc(t('ogp3')) + '</s>'; stillScene(1200, 630, false); window.__ready = 1; }
else if (ICON) { $('fx').hidden = true; stillScene(512, 512, true); window.__ready = 1; }
else { resize(); showTitle(); requestAnimationFrame(loop); }
window.__PP = { get mode() { return mode }, get G() { return G }, get seq() { return seq }, tap, begin, practice, playUpdate };
