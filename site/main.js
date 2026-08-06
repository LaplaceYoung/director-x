import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js";

const canvas = document.querySelector("#production-scene");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrowScreen = window.matchMedia("(max-width: 720px)").matches;
const sceneStates = {
  hero: { camera: [0.3, 0.1, 14], target: [0, 0, 0], spread: 1 },
  goal: { camera: [-3.8, 0.4, 10.5], target: [-3.2, 0, 0], spread: .72 },
  agents: { camera: [1.3, 1.6, 12], target: [.4, .2, 0], spread: 1.12 },
  canvas: { camera: [5.8, -.3, 9.4], target: [4.3, -.8, 0], spread: .78 },
  flow: { camera: [0, 4.5, 14.5], target: [1.2, -.2, 0], spread: .48 },
  roadmap: { camera: [0, .5, 19], target: [1.8, 0, 0], spread: 1.55 }
};

let renderer;
let scene;
let camera;
let activeState = "hero";
let visible = true;
let pointerX = 0;
let pointerY = 0;
let highlightedAgent = "director";
let scrollY = window.scrollY;
let smoothScrollY = scrollY;
let lastScrollY = scrollY;
let scrollVelocity = 0;
let sceneProgress = 0;
const groups = {};
const pulses = [];
const sceneChapters = [...document.querySelectorAll("[data-scene]")];

document.body.classList.toggle("loading", !reducedMotion);
prepareTextReveals();
startEntrance();
requestAnimationFrame(updateDomMotion);
initParticlePlayer();

try {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, narrowScreen ? 1.15 : 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
  document.documentElement.classList.add("webgl-ready");
  buildScene();
  resize();
  if (reducedMotion) renderFrame(0);
  else renderer.setAnimationLoop(renderFrame);
} catch {
  document.documentElement.classList.add("webgl-fallback");
}

function buildScene() {
  const ambient = new THREE.AmbientLight(0xffffff, 2.1);
  const key = new THREE.DirectionalLight(0xffffff, 4.2);
  key.position.set(4, 8, 10);
  scene.add(ambient, key);

  groups.root = new THREE.Group();
  groups.nodes = new THREE.Group();
  groups.lines = new THREE.Group();
  groups.root.add(groups.lines, groups.nodes);
  scene.add(groups.root);

  const nodes = [
    node("goal", "GOAL", [-3.5, 0, 0], [1.6, .9, .34], 0xe85d3f, "goal"),
    node("director", "DX DIRECTOR", [-.5, 2.15, -.5], [1.8, .58, .28], 0x171715, "agent"),
    node("reference", "REFERENCE", [2.2, 3.1, -1.2], [1.65, .92, .24], 0xf2f0e9, "asset"),
    node("asset", "ASSET", [2.5, 1.25, .35], [1.55, .92, .24], 0xf2f0e9, "asset"),
    node("shot", "SHOT PLAN", [.8, -.2, 1.1], [1.75, .86, .24], 0xf2f0e9, "asset"),
    node("model", "MODEL ROUTE", [3.7, -.7, -.8], [1.82, .58, .25], 0x171715, "agent"),
    node("editor", "ROUGH CUT", [1.15, -2.35, -.4], [1.9, 1.05, .26], 0xf2f0e9, "asset"),
    node("review", "REVIEW", [4.15, -2.7, .8], [1.6, .58, .25], 0x171715, "agent"),
    node("final", "FINAL FILM", [6.7, -.5, 0], [2.25, 1.3, .3], 0x11110f, "final")
  ];
  for (const item of nodes) groups.nodes.add(item.mesh);

  const relations = [
    ["goal", "director"], ["goal", "shot"], ["director", "reference"], ["director", "asset"],
    ["reference", "shot"], ["asset", "shot"], ["shot", "model"], ["model", "editor"],
    ["shot", "editor"], ["editor", "review"], ["review", "final"]
  ];
  for (const [from, to] of relations) connect(nodes, from, to);

  const floor = new THREE.GridHelper(24, 24, 0xc9c4b9, 0xdad6ce);
  floor.position.y = -4.6;
  floor.rotation.z = .03;
  floor.material.transparent = true;
  floor.material.opacity = .3;
  groups.root.add(floor);
}

function node(id, label, position, scale, color, type) {
  const geometry = new THREE.BoxGeometry(...scale);
  const material = new THREE.MeshStandardMaterial({ color, roughness: .78, metalness: .04 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(-.08, .08, type === "final" ? -.04 : .02);
  mesh.userData = { id, type, base: new THREE.Vector3(...position), baseColor: color };

  const labelTexture = textTexture(label, color === 0xf2f0e9 ? "#11110f" : "#f4f1e9");
  const labelMaterial = new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false });
  const labelMesh = new THREE.Mesh(new THREE.PlaneGeometry(scale[0] * .8, scale[1] * .34), labelMaterial);
  labelMesh.position.z = scale[2] / 2 + .01;
  mesh.add(labelMesh);
  return { id, mesh };
}

function textTexture(text, color) {
  const surface = document.createElement("canvas");
  surface.width = 512;
  surface.height = 128;
  const context = surface.getContext("2d");
  context.clearRect(0, 0, surface.width, surface.height);
  context.fillStyle = color;
  context.font = "600 34px Helvetica Neue, Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 256, 64);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function connect(nodes, fromId, toId) {
  const from = nodes.find(item => item.id === fromId).mesh.position;
  const to = nodes.find(item => item.id === toId).mesh.position;
  const midpoint = from.clone().lerp(to, .5);
  midpoint.z += 1.2 + Math.abs(from.y - to.y) * .12;
  const curve = new THREE.QuadraticBezierCurve3(from.clone(), midpoint, to.clone());
  const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(42));
  const material = new THREE.LineBasicMaterial({ color: fromId === "goal" ? 0xe85d3f : 0x484640, transparent: true, opacity: fromId === "goal" ? .9 : .48 });
  const line = new THREE.Line(geometry, material);
  line.userData = { fromId, toId };
  groups.lines.add(line);

  const pulse = new THREE.Mesh(new THREE.SphereGeometry(.055, 10, 10), new THREE.MeshBasicMaterial({ color: 0xe85d3f }));
  pulse.userData = { curve, offset: Math.random(), speed: .045 + Math.random() * .045, fromId, toId };
  groups.root.add(pulse);
  pulses.push(pulse);
}

function renderFrame(time = 0) {
  if (!renderer || !visible) return;
  const { current, next, mix } = resolveSceneTrack(smoothScrollY);
  activeState = current.dataset.scene;
  sceneProgress = mix;
  const currentState = sceneStates[activeState];
  const nextState = sceneStates[next.dataset.scene] || currentState;
  const easedMix = mix * mix * (3 - 2 * mix);
  const state = {
    camera: currentState.camera.map((value, index) => THREE.MathUtils.lerp(value, nextState.camera[index], easedMix)),
    target: currentState.target.map((value, index) => THREE.MathUtils.lerp(value, nextState.target[index], easedMix)),
    spread: THREE.MathUtils.lerp(currentState.spread, nextState.spread, easedMix)
  };
  const seconds = time * .001;
  const cameraTarget = new THREE.Vector3(...state.camera);
  cameraTarget.x += pointerX * .55;
  cameraTarget.y += pointerY * .35;
  camera.position.lerp(cameraTarget, .045);
  const lookTarget = new THREE.Vector3(...state.target);
  camera.lookAt(lookTarget);

  groups.root.scale.lerp(new THREE.Vector3(state.spread, state.spread, state.spread), .035);
  groups.root.rotation.y += ((pointerX * .06 + scrollVelocity * .0012) - groups.root.rotation.y) * .035;
  groups.root.rotation.x += ((-pointerY * .025 + scrollVelocity * .00045) - groups.root.rotation.x) * .035;

  for (const mesh of groups.nodes.children) {
    const selected = mesh.userData.id === highlightedAgent;
    const active = activeState === "goal" ? mesh.userData.id === "goal" : activeState === "agents" ? selected : false;
    const lift = active ? .16 : 0;
    mesh.position.y += ((mesh.userData.base.y + lift + Math.sin(seconds * .55 + mesh.userData.base.x) * .025) - mesh.position.y) * .08;
    mesh.material.emissive.setHex(active ? 0x4a1309 : 0x000000);
    mesh.material.emissiveIntensity = active ? .85 : 0;
  }

  for (const line of groups.lines.children) {
    const connected = [line.userData.fromId, line.userData.toId].includes(highlightedAgent);
    line.material.opacity += (((activeState === "agents" && connected) ? .95 : line.userData.fromId === "goal" ? .8 : .35) - line.material.opacity) * .08;
  }

  for (const pulse of pulses) {
    const progress = (seconds * pulse.userData.speed + pulse.userData.offset) % 1;
    pulse.position.copy(pulse.userData.curve.getPoint(progress));
    pulse.visible = activeState !== "roadmap" || pulse.userData.toId === "final";
  }

  renderer.render(scene, camera);
}

function resize() {
  if (!renderer) return;
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(rect.height, 1);
  camera.updateProjectionMatrix();
}

window.addEventListener("resize", resize, { passive: true });
window.addEventListener("pointermove", event => {
  pointerX = (event.clientX / window.innerWidth - .5) * 2;
  pointerY = (event.clientY / window.innerHeight - .5) * 2;
}, { passive: true });
document.addEventListener("visibilitychange", () => {
  visible = !document.hidden;
  if (visible && reducedMotion) renderFrame(0);
});

const chapterObserver = new IntersectionObserver(entries => {
  const visibleChapters = entries.filter(entry => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
  if (visibleChapters[0]) activeState = visibleChapters[0].target.dataset.scene;
}, { threshold: [.2, .4, .65], rootMargin: "-15% 0px -25% 0px" });
sceneChapters.forEach(chapter => chapterObserver.observe(chapter));

const revealObserver = new IntersectionObserver(entries => {
  for (const entry of entries) if (entry.isIntersecting) entry.target.classList.add("visible");
}, { threshold: .14 });
document.querySelectorAll(".reveal").forEach(item => revealObserver.observe(item));

document.querySelectorAll("[data-agent]").forEach(row => {
  row.addEventListener("pointerenter", () => selectAgent(row));
  row.addEventListener("focus", () => selectAgent(row));
  row.addEventListener("click", () => selectAgent(row));
});

function selectAgent(row) {
  highlightedAgent = row.dataset.agent;
  document.querySelectorAll("[data-agent]").forEach(item => item.classList.toggle("active", item === row));
}

const nav = document.querySelector("[data-nav]");
window.addEventListener("scroll", () => {
  scrollY = window.scrollY;
  nav.classList.toggle("scrolled", scrollY > 24);
}, { passive: true });

function resolveSceneTrack(position) {
  const viewportCenter = position + window.innerHeight * .5;
  let currentIndex = 0;
  for (let index = 0; index < sceneChapters.length - 1; index += 1) {
    const currentCenter = sceneChapters[index].offsetTop + sceneChapters[index].offsetHeight * .5;
    const nextCenter = sceneChapters[index + 1].offsetTop + sceneChapters[index + 1].offsetHeight * .5;
    if (viewportCenter >= currentCenter) currentIndex = index;
    if (viewportCenter < nextCenter) {
      return {
        current: sceneChapters[index],
        next: sceneChapters[index + 1],
        mix: THREE.MathUtils.clamp((viewportCenter - currentCenter) / Math.max(nextCenter - currentCenter, 1), 0, 1)
      };
    }
  }
  const last = sceneChapters.at(-1);
  return { current: sceneChapters[currentIndex] || last, next: last, mix: 1 };
}

function updateDomMotion() {
  smoothScrollY += (scrollY - smoothScrollY) * (reducedMotion ? 1 : .1);
  scrollVelocity += ((scrollY - lastScrollY) - scrollVelocity) * .18;
  lastScrollY = scrollY;
  const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
  document.body.style.setProperty("--scroll-progress", Math.min(scrollY / maxScroll, 1).toFixed(4));
  document.body.style.setProperty("--scroll-velocity", scrollVelocity.toFixed(2));

  const heroProgress = Math.min(scrollY / Math.max(window.innerHeight, 1), 1);
  document.body.style.setProperty("--hero-exit", heroProgress.toFixed(3));
  const canvasSection = document.querySelector(".canvas-section");
  const canvasRect = canvasSection.getBoundingClientRect();
  const canvasProgress = THREE.MathUtils.clamp((window.innerHeight - canvasRect.top) / (canvasRect.height + window.innerHeight), 0, 1);
  const frameProgress = THREE.MathUtils.clamp((window.innerHeight * .88 - canvasRect.top) / (window.innerHeight * .72), 0, 1);
  canvasSection.style.setProperty("--canvas-shift", canvasProgress.toFixed(3));
  canvasSection.style.setProperty("--frame-progress", frameProgress.toFixed(3));
  canvasSection.style.setProperty("--lineage-progress", THREE.MathUtils.clamp(frameProgress * 1.6 - .55, 0, 1).toFixed(3));
  document.body.style.setProperty("--scene-opacity", canvasRect.top < window.innerHeight * .25 && canvasRect.bottom > 0 ? .08 : 1);

  const track = resolveSceneTrack(smoothScrollY);
  const sceneIndex = sceneChapters.indexOf(track.current);
  document.querySelector("[data-scene-index]").textContent = String(sceneIndex).padStart(2, "0");
  document.querySelector("[data-scene-name]").textContent = track.current.dataset.chapterName;
  requestAnimationFrame(updateDomMotion);
}

function prepareTextReveals() {
  const headings = document.querySelectorAll("h1, h2, h3");
  for (const heading of headings) {
    let wordIndex = 0;
    for (const node of [...heading.childNodes]) {
      if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
      const fragment = document.createDocumentFragment();
      const parts = node.textContent.split(/(\s+)/);
      for (const part of parts) {
        if (!part.trim()) {
          fragment.append(part);
          continue;
        }
        const mask = document.createElement("span");
        mask.className = "word-mask";
        const word = document.createElement("span");
        word.style.setProperty("--word-index", wordIndex++);
        word.textContent = part;
        mask.append(word);
        fragment.append(mask);
      }
      node.replaceWith(fragment);
    }
    if (heading.closest(".hero")) heading.classList.add("words-visible");
  }
  const textObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) entry.target.classList.add("words-visible");
  }, { threshold: .28 });
  headings.forEach(heading => textObserver.observe(heading));
}

function startEntrance() {
  const loader = document.querySelector("[data-loader]");
  if (reducedMotion) {
    loader.remove();
    document.body.classList.remove("loading");
    return;
  }
  const counter = document.querySelector("[data-loader-count]");
  const line = loader.querySelector(".loader-line span");
  const start = performance.now();
  const duration = 1150;
  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    counter.textContent = String(Math.round(eased * 100)).padStart(2, "0");
    line.style.transform = `scaleX(${eased})`;
    if (progress < 1) requestAnimationFrame(tick);
    else window.setTimeout(() => {
      loader.classList.add("done");
      document.body.classList.remove("loading");
    }, 180);
  }
  requestAnimationFrame(tick);
}

document.querySelector("[data-copy]").addEventListener("click", async event => {
  const code = event.currentTarget.nextElementSibling.textContent;
  try {
    await navigator.clipboard.writeText(code);
    event.currentTarget.textContent = "Copied";
    window.setTimeout(() => { event.currentTarget.textContent = "Copy"; }, 1600);
  } catch {
    event.currentTarget.textContent = "Select text";
  }
});

function initParticlePlayer() {
  const section = document.querySelector("[data-player-finale]");
  const surface = document.querySelector("[data-player-particles]");
  if (!section || !surface) return;

  const context = surface.getContext("2d");
  const particleCount = narrowScreen ? 560 : 1100;
  const particles = Array.from({ length: particleCount }, (_, index) => ({
    seed: index * 12.9898,
    x: 0,
    y: 0,
    targetX: 0,
    targetY: 0,
    size: index % 17 === 0 ? 2 : 1,
    accent: index % 13 === 0
  }));
  let width = 1;
  let height = 1;
  let pixelRatio = 1;

  function resizeParticles() {
    const rect = section.getBoundingClientRect();
    width = Math.max(rect.width, 1);
    height = Math.max(rect.height, 1);
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    surface.width = Math.round(width * pixelRatio);
    surface.height = Math.round(height * pixelRatio);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const iconWidth = Math.min(width * .42, 460);
    const iconHeight = iconWidth * .62;
    const left = (width - iconWidth) / 2;
    const top = (height - iconHeight) / 2;
    const corner = iconWidth * .09;
    const perimeterCount = Math.floor(particleCount * .7);

    particles.forEach((particle, index) => {
      const randomX = pseudoRandom(particle.seed) * width;
      const randomY = pseudoRandom(particle.seed + 8.4) * height;
      particle.x ||= randomX;
      particle.y ||= randomY;

      if (index < perimeterCount) {
        const distance = (index / perimeterCount) * (2 * (iconWidth + iconHeight - 4 * corner) + 2 * Math.PI * corner);
        const point = roundedRectPoint(distance, left, top, iconWidth, iconHeight, corner);
        particle.targetX = point.x;
        particle.targetY = point.y;
      } else {
        const first = Math.sqrt(pseudoRandom(particle.seed + 21));
        const second = pseudoRandom(particle.seed + 34);
        const topWeight = 1 - first;
        const pointWeight = first * (1 - second);
        const bottomWeight = first * second;
        particle.targetX = width / 2 + iconWidth * (-.065 * topWeight + .185 * pointWeight - .065 * bottomWeight);
        particle.targetY = height / 2 + iconHeight * (-.215 * topWeight + .215 * bottomWeight);
        particle.accent = true;
      }
    });
  }

  function drawParticles(time) {
    const rect = section.getBoundingClientRect();
    const gather = reducedMotion
      ? 1
      : smoothStep(THREE.MathUtils.clamp((window.innerHeight * .92 - rect.top) / (window.innerHeight * .78), 0, 1));
    context.clearRect(0, 0, width, height);

    for (const particle of particles) {
      const driftX = (pseudoRandom(particle.seed + 2.2) - .5) * width * .7;
      const driftY = (pseudoRandom(particle.seed + 4.7) - .5) * height * .72;
      const originX = width / 2 + driftX + Math.sin(time * .00025 + particle.seed) * 18;
      const originY = height / 2 + driftY + Math.cos(time * .0002 + particle.seed) * 14;
      const eased = Math.min(1, gather * (1.08 + pseudoRandom(particle.seed + 1.3) * .18));
      particle.x += (THREE.MathUtils.lerp(originX, particle.targetX, eased) - particle.x) * (reducedMotion ? 1 : .075);
      particle.y += (THREE.MathUtils.lerp(originY, particle.targetY, eased) - particle.y) * (reducedMotion ? 1 : .075);

      const alpha = .2 + gather * (particle.accent ? .78 : .58);
      context.fillStyle = particle.accent ? `rgba(232,93,63,${alpha})` : `rgba(242,240,233,${alpha})`;
      context.fillRect(particle.x, particle.y, particle.size, particle.size);
    }

    if (gather > .86) {
      const pulse = (Math.sin(time * .003) + 1) * .5;
      context.fillStyle = `rgba(232,93,63,${(gather - .86) * .4 * pulse})`;
      context.beginPath();
      context.arc(width / 2, height / 2, 30 + pulse * 12, 0, Math.PI * 2);
      context.fill();
    }
    requestAnimationFrame(drawParticles);
  }

  resizeParticles();
  window.addEventListener("resize", resizeParticles, { passive: true });
  requestAnimationFrame(drawParticles);
}

function pseudoRandom(value) {
  return Math.abs(Math.sin(value) * 43758.5453) % 1;
}

function smoothStep(value) {
  return value * value * (3 - 2 * value);
}

function roundedRectPoint(distance, x, y, width, height, radius) {
  const straightWidth = width - 2 * radius;
  const straightHeight = height - 2 * radius;
  const arcLength = Math.PI * radius / 2;
  const segments = [
    { length: straightWidth, point: value => ({ x: x + radius + value, y }) },
    { length: arcLength, point: value => arcPoint(x + width - radius, y + radius, radius, -Math.PI / 2 + value / radius) },
    { length: straightHeight, point: value => ({ x: x + width, y: y + radius + value }) },
    { length: arcLength, point: value => arcPoint(x + width - radius, y + height - radius, radius, value / radius) },
    { length: straightWidth, point: value => ({ x: x + width - radius - value, y: y + height }) },
    { length: arcLength, point: value => arcPoint(x + radius, y + height - radius, radius, Math.PI / 2 + value / radius) },
    { length: straightHeight, point: value => ({ x, y: y + height - radius - value }) },
    { length: arcLength, point: value => arcPoint(x + radius, y + radius, radius, Math.PI + value / radius) }
  ];
  let remaining = distance % segments.reduce((total, segment) => total + segment.length, 0);
  for (const segment of segments) {
    if (remaining <= segment.length) return segment.point(remaining);
    remaining -= segment.length;
  }
  return { x: x + radius, y };
}

function arcPoint(x, y, radius, angle) {
  return { x: x + Math.cos(angle) * radius, y: y + Math.sin(angle) * radius };
}
