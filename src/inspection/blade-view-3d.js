// 3D cut-away blade for the inspection screen (three.js, loaded as a global
// from /src/vendor/three.min.js), drawn like a CAD cut-away: composite shell,
// hollow root, shear webs and spar cap inside, adhesive line along the trailing
// edge. The blade lies horizontally (root left) so it fits a low panel; the
// camera looks down into a window cut into the upper skin over the inspected
// cavity (leading or trailing edge). The window and a location pin follow the
// robot along the span.
// The blade runs along +x from the root (x=0) to the tip (x=LEN); chord along z
// (leading edge at -z), thickness along y.
// Returns null when WebGL or three.js is unavailable (the caller then draws 2D).
const LEN = 10;
const ROOT_R = 0.40, WALL = 0.045;
const WEB_FRONT = 0.24, WEB_REAR = 0.52;            // shear webs, fraction of chord
const CAVITY = { L: [0.03, WEB_FRONT - 0.015], T: [WEB_REAR + 0.015, 0.90] };
const PATH_XC = { L: 0.15, T: 0.68 };
const S_START = 0.12, S_END = 0.95;                  // robot travel along the span
const WINDOW = 0.16;                                // half width of the cut, fraction of span

const chordAt = s => (s < 0.06 ? 0 : s < 0.24 ? (s - 0.06) / 0.18 * 1.45 : 1.45 - (s - 0.24) / 0.76 * 1.15) + 0.32;
const thickAt = s => (s < 0.24 ? 0.42 : 0.42 - (s - 0.24) / 0.76 * 0.27);
const twistAt = s => (1 - s) * 0.18;
const blendAt = s => (s < 0.05 ? 0 : s > 0.26 ? 1 : (s - 0.05) / 0.21);
const yt = (xc, t) => 5 * t * (0.2969 * Math.sqrt(xc) - 0.126 * xc - 0.3516 * xc ** 2 + 0.2843 * xc ** 3 - 0.1036 * xc ** 4);
const camber = xc => 0.035 * (xc < 0.4 ? (0.8 * xc - xc * xc) / 0.16 : (0.2 + 0.8 * xc - xc * xc) / 0.36);
const cos01 = u => (1 - Math.cos(Math.PI * u)) / 2;  // denser near both ends

// Point on the outer surface at span s, chord fraction xc, upper or lower side.
function surf(s, xc, upper, inset = 0) {
  const c = chordAt(s), t = thickAt(s), b = blendAt(s), sign = upper ? 1 : -1;
  const ya = (camber(xc) + sign * Math.max(0, yt(xc, t) - inset / Math.max(c, 0.01))) * c;
  const za = (xc - 0.33) * c;
  const r = ROOT_R - inset;
  const zc = (xc - 0.5) * 2 * r;
  const yc = sign * Math.sqrt(Math.max(0, r * r - zc * zc));
  const y = yc + (ya - yc) * b, z = zc + (za - zc) * b;
  const tw = twistAt(s), cy = Math.cos(tw), sy = Math.sin(tw);
  return [s * LEN, y * cy - z * sy, y * sy + z * cy];
}

// Surface patch over span [s0,s1] x chord [x0,x1] (one side).
function patch(T, s0, s1, x0, x1, upper, inset = 0, ns = 40, nc = 24) {
  const pos = [], idx = [];
  for (let i = 0; i <= ns; i++) {
    const s = s0 + (s1 - s0) * i / ns;
    for (let j = 0; j <= nc; j++) pos.push(...surf(s, x0 + (x1 - x0) * cos01(j / nc), upper, inset));
  }
  for (let i = 0; i < ns; i++) for (let j = 0; j < nc; j++) {
    const a = i * (nc + 1) + j, b = a + nc + 1;
    if (upper) idx.push(a, a + 1, b, a + 1, b + 1, b); else idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Ribbon between the outer surface and the inner (inset) surface along a curve:
// the visible wall thickness at the cut.
function cutFace(T, pts) {
  const pos = [], idx = [];
  for (const [s, xc] of pts) pos.push(...surf(s, xc, true), ...surf(s, xc, true, WALL));
  for (let i = 0; i < pts.length - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function webGeometry(T, xc) {
  const pos = [], idx = [], n = 48, s0 = 0.08, s1 = 0.94;
  for (let i = 0; i <= n; i++) {
    const s = s0 + (s1 - s0) * i / n;
    pos.push(...surf(s, xc, false, WALL), ...surf(s, xc, true, WALL));
  }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function label(T, text) {
  const c = document.createElement('canvas'); c.width = 160; c.height = 44;
  const x = c.getContext('2d');
  x.font = '600 26px system-ui, sans-serif'; x.fillStyle = '#9fb2bb'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 80, 22);
  const sp = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(c), depthTest: false, transparent: true }));
  sp.scale.set(0.9, 0.25, 1);
  return sp;
}

export function createBlade3D(host) {
  const T = window.THREE;
  if (!T) return null;
  let renderer;
  try { renderer = new T.WebGLRenderer({ antialias: true, alpha: true }); } catch { return null; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.domElement.className = 'blade-canvas';
  host.append(renderer.domElement);

  const world = new T.Scene();
  const scene = new T.Group(); world.add(scene);
  const camera = new T.PerspectiveCamera(30, 3, 0.1, 100);
  world.add(new T.HemisphereLight(0xffffff, 0x3a4246, 0.75));
  const key = new T.DirectionalLight(0xffffff, 0.55); key.position.set(-2, 10, 6); world.add(key);
  const rim = new T.DirectionalLight(0xbfd6e6, 0.3); rim.position.set(8, 2, -6); world.add(rim);

  // Materials: grey composite outside, darker inside, light cut faces,
  // beige shear webs and copper spar cap (as in CAD cut-away drawings).
  const outer = new T.MeshStandardMaterial({ color: 0x9fa4a7, roughness: 0.7, metalness: 0.0, side: T.FrontSide });
  const inner = new T.MeshStandardMaterial({ color: 0x6d7173, roughness: 0.95, side: T.BackSide });
  const cutMat = new T.MeshStandardMaterial({ color: 0xe9e3d3, roughness: 0.8, side: T.DoubleSide });
  const webMat = new T.MeshStandardMaterial({ color: 0xcdb98c, roughness: 0.85, side: T.DoubleSide });
  const capMat = new T.MeshStandardMaterial({ color: 0xd08a5c, roughness: 0.5, side: T.DoubleSide });
  const both = g => { const grp = new T.Group(); grp.add(new T.Mesh(g, outer), new T.Mesh(g, inner)); return grp; };

  // Lower skin (whole), root tube inside and the root end face.
  scene.add(both(patch(T, 0, 1, 0, 1, false, 0, 90, 32)));
  const rootEnd = new T.Mesh(new T.RingGeometry(ROOT_R - WALL, ROOT_R, 48), cutMat);
  rootEnd.rotation.y = -Math.PI / 2; scene.add(rootEnd);
  for (let i = 0; i < 20; i++) {
    const a = i / 20 * Math.PI * 2;
    const hole = new T.Mesh(new T.CircleGeometry(0.014, 10), new T.MeshBasicMaterial({ color: 0x4a5257 }));
    hole.rotation.y = -Math.PI / 2; hole.position.set(-0.001, Math.sin(a) * (ROOT_R - WALL / 2), Math.cos(a) * (ROOT_R - WALL / 2));
    scene.add(hole);
  }

  // Structural adhesive line along the trailing edge (as in the reference drawing).
  { const te = []; for (let i = 0; i <= 120; i++) te.push(new T.Vector3(...surf(0.24 + 0.74 * i / 120, 0.995, false))); scene.add(new T.Line(new T.BufferGeometry().setFromPoints(te), new T.LineBasicMaterial({ color: 0xd9b54a }))); }
  // Inside: shear webs and the spar cap on the lower skin between them (the upper
  // cap belongs to the upper skin, which is cut away over the robot).
  scene.add(new T.Mesh(webGeometry(T, WEB_FRONT), webMat), new T.Mesh(webGeometry(T, WEB_REAR), webMat));
  scene.add(new T.Mesh(patch(T, 0.08, 0.94, WEB_FRONT - 0.02, WEB_REAR + 0.02, false, WALL * 1.05, 48, 6), capMat));

  // Upper skin with a window over the inspected cavity; rebuilt as the robot moves.
  const upper = new T.Group(); scene.add(upper);
  let cutKey = '';
  function buildUpper(section, sCenter) {
    const k = section + '|' + sCenter.toFixed(3);
    if (k === cutKey) return;
    cutKey = k;
    upper.traverse(o => o.geometry?.dispose());
    upper.clear();
    if (!CAVITY[section]) { upper.add(both(patch(T, 0, 1, 0, 1, true, 0, 90, 32))); return; }
    const [x0, x1] = [0.05, 0.9];   // cut across both cavities: webs and spar cap visible
    const a = Math.max(0.1, sCenter - WINDOW), b = Math.min(0.96, sCenter + WINDOW);
    upper.add(both(patch(T, 0, a, 0, 1, true, 0, Math.max(4, Math.round(a * 90)), 32)));
    upper.add(both(patch(T, b, 1, 0, 1, true, 0, Math.max(4, Math.round((1 - b) * 90)), 32)));
    upper.add(both(patch(T, a, b, 0, x0, true, 0, 16, 10)));
    upper.add(both(patch(T, a, b, x1, 1, true, 0, 16, 24)));
    // Visible wall thickness along the four edges of the cut.
    const n = 16, edge = [];
    for (let j = 0; j <= n; j++) edge.push([a, x0 + (x1 - x0) * cos01(j / n)]);
    for (let i = 1; i <= n; i++) edge.push([a + (b - a) * i / n, x1]);
    for (let j = n - 1; j >= 0; j--) edge.push([b, x0 + (x1 - x0) * cos01(j / n)]);
    for (let i = n - 1; i >= 0; i--) edge.push([a + (b - a) * i / n, x0]);
    upper.add(new T.Mesh(cutFace(T, edge), cutMat));
  }

  // Cavity floor highlight, travelled path and the robot.
  const floorMat = new T.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.22, side: T.DoubleSide, depthWrite: false });
  const floor = new T.Group(); scene.add(floor);
  const pathGeo = new T.BufferGeometry();
  scene.add(new T.Line(pathGeo, new T.LineBasicMaterial({ color: 0x3ddc97 })));
  const robot = new T.Group();
  const dark = new T.MeshStandardMaterial({ color: 0x1d262a, roughness: 0.5 });
  const body = new T.Mesh(new T.BoxGeometry(0.36, 0.09, 0.2), new T.MeshStandardMaterial({ color: 0x3ddc97, emissive: 0x0e5236, roughness: 0.45 }));
  body.position.y = 0.075; robot.add(body);
  const mast = new T.Mesh(new T.CylinderGeometry(0.012, 0.012, 0.07, 8), dark); mast.position.set(0.08, 0.15, 0); robot.add(mast);
  const lens = new T.Mesh(new T.SphereGeometry(0.045, 16, 12), dark); lens.position.set(0.08, 0.2, 0); robot.add(lens);
  for (const [dx, dz] of [[0.12, 0.11], [0.12, -0.11], [-0.12, 0.11], [-0.12, -0.11]]) {
    const w = new T.Mesh(new T.CylinderGeometry(0.045, 0.045, 0.035, 14), dark);
    w.rotation.x = Math.PI / 2; w.position.set(dx, 0.045, dz); robot.add(w);
  }
  const glow = new T.PointLight(0x3ddc97, 0.7, 1.2); glow.position.y = 0.25; robot.add(glow);
  robot.scale.setScalar(1.35);
  const beam = new T.Mesh(new T.ConeGeometry(0.16, 0.7, 20, 1, true), new T.MeshBasicMaterial({ color: 0x3ddc97, transparent: true, opacity: 0.16, depthWrite: false, side: T.DoubleSide }));
  beam.rotation.z = Math.PI / 2; beam.position.set(0.48, 0.13, 0); robot.add(beam);
  // Location pin above the robot so it is easy to find at any distance.
  const pinCanvas = document.createElement('canvas'); pinCanvas.width = 64; pinCanvas.height = 96;
  { const c = pinCanvas.getContext('2d'); c.fillStyle = '#3ddc97'; c.beginPath(); c.arc(32, 30, 24, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(14, 44); c.lineTo(32, 92); c.lineTo(50, 44); c.fill(); c.fillStyle = '#0b1418'; c.beginPath(); c.arc(32, 30, 10, 0, Math.PI * 2); c.fill(); }
  const pin = new T.Sprite(new T.SpriteMaterial({ map: new T.CanvasTexture(pinCanvas), depthTest: false, transparent: true }));
  pin.scale.set(0.32, 0.48, 1); pin.center.set(0.5, 0); scene.add(pin);
  scene.add(robot);

  const ticks = new T.Group(); scene.add(ticks);
  const rootLabel = label(T, 'Root'); scene.add(rootLabel);
  const tipLabel = label(T, 'Tip'); scene.add(tipLabel);

  const state = { s: 0, target: 0, section: null, span: 20, anim: 0 };
  const along = s => S_START + s * (S_END - S_START);
  const robotPos = (s, section) => {
    const [x, y, z] = surf(along(s), PATH_XC[section] ?? 0.37, false, WALL);
    return new T.Vector3(x, y + 0.005, z);
  };

  function placeCamera(section) {
    // Looking down into the cut from the side of the inspected edge, so that
    // cavity is on the near side; for the leading edge the blade is mirrored so
    // the root stays on the left.
    const side = section === 'T' ? 1 : -1;
    scene.scale.z = side;
    camera.position.set(LEN * 0.5, 7.4, 4.6);
    camera.lookAt(TARGET);
    if (renderer.domElement.width) fit();
    rootLabel.position.set(-0.55, 0.15, 0);
    tipLabel.position.set(LEN + 0.25, 0.25, 0);
  }

  // Move the camera along its line of sight until the whole blade just fits.
  const TARGET = new T.Vector3(LEN * 0.5, -0.15, 0);
  const outlinePts = [];
  for (let i = 0; i <= 12; i++) for (const xc of [0, 1]) for (const up of [true, false]) outlinePts.push(new T.Vector3(...surf(i / 12, xc, up)));
  outlinePts.push(new T.Vector3(-0.95, 0.15, 0), new T.Vector3(LEN + 0.4, 0, 0));   // room for the root/tip labels
  function fit() {
    const dir = camera.position.clone().sub(TARGET);
    for (let k = 0; k < 4; k++) {
      camera.position.copy(TARGET).add(dir); camera.lookAt(TARGET); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
      let m = 0;
      for (const p0 of outlinePts) {
        const p = p0.clone(); p.z *= scene.scale.z; p.project(camera);
        m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
      }
      dir.multiplyScalar(m / 0.88);
    }
    camera.position.copy(TARGET).add(dir); camera.lookAt(TARGET); camera.updateProjectionMatrix();
  }

  function draw() {
    const p = robotPos(state.s, state.section);
    robot.position.copy(p);
    pin.position.set(p.x, p.y + 0.5, p.z);
    const ahead = robotPos(Math.min(1, state.s + 0.01), state.section), back = robotPos(Math.max(0, state.s - 0.01), state.section);
    const d = ahead.sub(back).normalize();
    robot.rotation.set(0, Math.atan2(-d.z, d.x), Math.atan2(d.y, Math.hypot(d.x, d.z)));
    buildUpper(state.section, along(state.s));
    const pts = [], n = Math.max(2, Math.round(state.s * 60));
    for (let i = 0; i <= n; i++) pts.push(robotPos(state.s * i / n, state.section).add(new T.Vector3(0, 0.01, 0)));
    pathGeo.setFromPoints(pts);
    renderer.render(world, camera);
  }

  function resize() {
    const r = host.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height;
    camera.fov = 26;
    fit();
    draw();
  }
  new ResizeObserver(resize).observe(host);

  function animate() {
    cancelAnimationFrame(state.anim);
    const from = state.s, to = state.target, t0 = performance.now();
    const step = now => {
      const k = Math.min(1, (now - t0) / 600), e = 1 - (1 - k) ** 3;
      state.s = from + (to - from) * e; draw();
      if (k < 1) state.anim = requestAnimationFrame(step);
    };
    state.anim = requestAnimationFrame(step);
  }

  function setTicks(span, section) {
    ticks.traverse(o => o.material?.map?.dispose());
    ticks.clear();
    const step = span <= 40 ? 10 : span <= 100 ? 20 : 50;
    for (let m = 0; m <= span + 1e-6; m += step) {
      const [x] = surf(along(m / span), 0.5, false);
      const sp = label(T, m + ' m');
      sp.position.set(x, -0.55, section === 'T' ? 0.9 : -0.65);   // one straight row in front of the blade
      ticks.add(sp);
    }
  }

  function setFloor(section) {
    floor.traverse(o => o.geometry?.dispose());
    floor.clear();
    if (!CAVITY[section]) return;
    const [x0, x1] = CAVITY[section];
    floor.add(new T.Mesh(patch(T, S_START, S_END, x0 + 0.01, x1 - 0.01, false, WALL * 1.15, 60, 6), floorMat));
  }

  return {
    update({ section, s, span, known }) {
      const changed = section !== state.section;
      state.section = section;
      if (changed) { placeCamera(section); setFloor(section); state.s = s; }
      if (span !== state.span || changed) { state.span = span; setTicks(span, section); }
      tipLabel.visible = known;
      state.target = s;
      if (changed) draw(); else animate();
    },
    resize,
  };
}
