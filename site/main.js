import { initialLocale, locales } from "./i18n.js";

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const narrowScreen = window.matchMedia("(max-width: 720px)").matches;
const canvas = document.querySelector("#production-scene");
const sceneChapters = [...document.querySelectorAll("[data-scene]")];
const clamp = (value, minimum = 0, maximum = 1) => Math.min(Math.max(value, minimum), maximum);
const mix = (from, to, amount) => from + (to - from) * amount;
const smoothstep = value => value * value * (3 - 2 * value);

let locale = initialLocale();
let THREE;
let renderer;
let scene;
let camera;
let visible = true;
let pointerX = 0;
let pointerY = 0;
let scrollY = window.scrollY;
let smoothScrollY = scrollY;
let lastScrollY = scrollY;
let scrollVelocity = 0;
let highlightedAgent = "director";
let lastWebglFrame = 0;
const groups = {};
const nodes = new Map();
const relations = [];

applyLocale(locale, false);
setupRevealMotion();
bindInteractions();
requestAnimationFrame(updateDomMotion);

import("https://cdn.jsdelivr.net/npm/three@0.185.1/build/three.module.js")
  .then(module => {
    THREE = module;
    return document.fonts?.ready;
  })
  .then(() => initializeScene())
  .catch(() => document.documentElement.classList.add("webgl-fallback"));

function applyLocale(nextLocale, updateUrl = true) {
  locale = locales[nextLocale] ? nextLocale : "en";
  const bundle = locales[locale];
  document.documentElement.lang = locale;
  document.documentElement.style.setProperty("--live-run-label", locale === "zh-CN" ? '"实时运行"' : '"LIVE RUN"');
  document.title = bundle.meta.title;
  document.querySelector('meta[name="description"]').content = bundle.meta.description;
  document.querySelector('meta[property="og:title"]').content = bundle.meta.title;
  document.querySelector('meta[property="og:description"]').content = bundle.meta.description;
  for (const element of document.querySelectorAll("[data-i18n]")) {
    const value = bundle.copy[element.dataset.i18n];
    if (value != null) element.textContent = value;
  }
  for (const element of document.querySelectorAll("[data-i18n-html]")) {
    const value = bundle.copy[element.dataset.i18nHtml];
    if (value != null) element.innerHTML = value;
  }
  for (const element of document.querySelectorAll("[data-i18n-aria-label]")) {
    const value = bundle.copy[element.dataset.i18nAriaLabel];
    if (value != null) element.setAttribute("aria-label", value);
  }
  document.querySelectorAll("[data-locale]").forEach(button => {
    const selected = button.dataset.locale === locale;
    button.setAttribute("aria-pressed", String(selected));
    button.classList.toggle("active", selected);
  });
  for (const chapter of sceneChapters) chapter.dataset.chapterName = bundle.chapterNames[chapter.dataset.scene] ?? chapter.dataset.scene;
  setupRevealMotion();
  updateSceneLabels();
  localStorage.setItem("directorx.locale", locale);
  if (updateUrl) {
    const url = new URL(location.href);
    url.searchParams.set("lang", locale);
    history.replaceState({}, "", url);
    document.querySelector("[data-language-status]").textContent = bundle.copy["language.changed"];
  }
}

function setupRevealMotion() {
  document.querySelectorAll("[data-reveal]").forEach(element => {
    element.querySelectorAll(".phrase").forEach((phrase, index) => phrase.style.setProperty("--phrase-index", index));
  });
}

function bindInteractions() {
  document.querySelectorAll("[data-locale]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.locale !== locale) applyLocale(button.dataset.locale);
  }));
  document.querySelectorAll("[data-agent]").forEach(row => {
    row.addEventListener("pointerenter", () => selectAgent(row));
    row.addEventListener("focus", () => selectAgent(row));
    row.addEventListener("click", () => selectAgent(row));
  });
  document.querySelector("[data-copy]").addEventListener("click", async event => {
    const code = event.currentTarget.nextElementSibling.textContent;
    try {
      await navigator.clipboard.writeText(code);
      event.currentTarget.textContent = locales[locale].copy["install.copied"];
      document.querySelector(".command-block").style.setProperty("--copy-progress", "1");
      window.setTimeout(() => {
        event.currentTarget.textContent = locales[locale].copy["install.copy"];
        document.querySelector(".command-block").style.setProperty("--copy-progress", "0");
      }, 1700);
    } catch {
      event.currentTarget.textContent = locales[locale].copy["install.select"];
    }
  });
  window.addEventListener("scroll", () => {
    scrollY = window.scrollY;
    document.querySelector("[data-nav]").classList.toggle("scrolled", scrollY > 24);
  }, { passive: true });
  window.addEventListener("pointermove", event => {
    pointerX = (event.clientX / window.innerWidth - .5) * 2;
    pointerY = (event.clientY / window.innerHeight - .5) * 2;
  }, { passive: true });
  document.addEventListener("visibilitychange", () => { visible = !document.hidden; });
  const revealObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) entry.target.classList.add("visible");
  }, { threshold: .16 });
  document.querySelectorAll("[data-reveal], .reveal").forEach(element => revealObserver.observe(element));
  const videoObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (!entry.isIntersecting && !entry.target.paused) entry.target.pause();
  }, { threshold: .12 });
  document.querySelectorAll("video").forEach(video => videoObserver.observe(video));
}

function selectAgent(row) {
  highlightedAgent = row.dataset.agent;
  document.querySelectorAll("[data-agent]").forEach(item => item.classList.toggle("active", item === row));
}

function updateDomMotion() {
  smoothScrollY += (scrollY - smoothScrollY) * (reducedMotion ? 1 : .095);
  scrollVelocity += ((scrollY - lastScrollY) - scrollVelocity) * .17;
  lastScrollY = scrollY;
  const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
  document.documentElement.style.setProperty("--scroll-progress", (scrollY / maxScroll).toFixed(4));

  const hero = document.querySelector(".hero");
  const heroProgress = clamp(scrollY / Math.max(hero.offsetHeight - window.innerHeight * .25, 1));
  document.documentElement.style.setProperty("--hero-progress", heroProgress.toFixed(3));

  const goal = document.querySelector(".statement");
  const goalProgress = sectionTravel(goal);
  goal.style.setProperty("--goal-progress", goalProgress.toFixed(3));
  document.querySelectorAll(".event-ledger li").forEach((item, index) => {
    item.style.setProperty("--event-active", clamp(goalProgress * 5 - index * .72).toFixed(3));
  });

  const canvasSection = document.querySelector(".canvas-section");
  const canvasProgress = sectionTravel(canvasSection);
  canvasSection.style.setProperty("--canvas-progress", canvasProgress.toFixed(3));
  canvasSection.style.setProperty("--canvas-enter", clamp(canvasProgress * 3.2).toFixed(3));
  canvasSection.style.setProperty("--canvas-focus-progress", clamp((canvasProgress - .12) * 2.1).toFixed(3));
  canvasSection.style.setProperty("--lineage-progress", clamp((canvasProgress - .56) * 3.1).toFixed(3));
  const focusIndex = Math.min(2, Math.floor(clamp((canvasProgress - .3) * 2.7) * 3));
  document.querySelectorAll("[data-focus]").forEach((item, index) => item.classList.toggle("active", index === focusIndex));
  document.querySelector("[data-canvas-time]").textContent = timecode(canvasProgress * 31);

  const atlas = document.querySelector(".capability-atlas");
  const atlasProgress = sectionTravel(atlas);
  atlas.style.setProperty("--atlas-progress", atlasProgress.toFixed(3));
  const atlasCards = [...document.querySelectorAll(".atlas-card")];
  const atlasIndex = Math.min(atlasCards.length - 1, Math.floor(clamp((atlasProgress - .08) * 1.15) * atlasCards.length));
  atlasCards.forEach((card, index) => {
    const cardProgress = clamp(atlasProgress * 2.2 - index * .12);
    card.style.setProperty("--atlas-in", cardProgress.toFixed(3));
    card.classList.toggle("active", index === atlasIndex);
  });

  const demos = document.querySelector(".demo-section");
  const demoProgress = sectionTravel(demos);
  const demoMonitors = document.querySelectorAll(".demo-monitor");
  demoMonitors[0].style.setProperty("--demo-x", `${mix(-18, 0, clamp(demoProgress * 2.5))}vw`);
  demoMonitors[0].style.setProperty("--demo-y", `${mix(18, 0, clamp(demoProgress * 2.5))}vh`);
  demoMonitors[0].style.setProperty("--demo-rotate", `${mix(10, -2, clamp(demoProgress * 2.5))}deg`);
  demoMonitors[1].style.setProperty("--demo-x", `${mix(18, 0, clamp((demoProgress - .13) * 2.5))}vw`);
  demoMonitors[1].style.setProperty("--demo-y", `${mix(24, 0, clamp((demoProgress - .13) * 2.5))}vh`);
  demoMonitors[1].style.setProperty("--demo-rotate", `${mix(-10, 2, clamp((demoProgress - .13) * 2.5))}deg`);

  const roadmap = document.querySelector(".roadmap");
  const roadmapProgress = sectionTravel(roadmap);
  document.querySelectorAll(".roadmap-list article").forEach((item, index) => {
    item.style.setProperty("--roadmap-line", `${clamp(roadmapProgress * 2.2 - index * .3) * 100}%`);
  });

  const future = document.querySelector(".future-harness");
  const futureProgress = sectionTravel(future);
  future.style.setProperty("--future-progress", futureProgress.toFixed(3));
  const futureVideo = document.querySelector(".future-video-stage video");
  if (futureVideo) document.querySelector("[data-future-time]").textContent = timecode(futureVideo.currentTime || futureProgress * 31);
  document.querySelectorAll(".future-capabilities article").forEach((item, index) => {
    item.style.setProperty("--future-progress", clamp(futureProgress * 2.2 - index * .24).toFixed(3));
  });

  const track = resolveSceneTrack(smoothScrollY);
  const canvasVisible = canvasProgress > .08 && canvasProgress < .92;
  const demosVisible = demoProgress > .08 && demoProgress < .92;
  const atlasVisible = atlasProgress > .08 && atlasProgress < .92;
  const futureVisible = futureProgress > .08 && futureProgress < .92;
  document.documentElement.style.setProperty("--scene-opacity", canvasVisible || demosVisible || atlasVisible || futureVisible ? ".08" : "1");
  requestAnimationFrame(updateDomMotion);
}

function sectionTravel(section) {
  if (section.offsetHeight <= window.innerHeight * 1.15) {
    const rect = section.getBoundingClientRect();
    return clamp((window.innerHeight - rect.top) / (window.innerHeight + rect.height));
  }
  const distance = Math.max(section.offsetHeight - window.innerHeight, 1);
  return clamp(-section.getBoundingClientRect().top / distance);
}

function resolveSceneTrack(position) {
  const viewportCenter = position + window.innerHeight * .5;
  for (let index = 0; index < sceneChapters.length - 1; index += 1) {
    const current = sceneChapters[index];
    const next = sceneChapters[index + 1];
    const currentCenter = current.offsetTop + current.offsetHeight * .5;
    const nextCenter = next.offsetTop + next.offsetHeight * .5;
    if (viewportCenter < nextCenter) return { current, next, mix: clamp((viewportCenter - currentCenter) / Math.max(nextCenter - currentCenter, 1)) };
  }
  const last = sceneChapters.at(-1);
  return { current: last, next: last, mix: 1 };
}

function timecode(seconds) {
  const frames = Math.floor((seconds % 1) * 30);
  const whole = Math.floor(seconds);
  return `00:00:${String(whole).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

const sceneStates = {
  hero: { camera: [.3, .1, 14], target: [0, 0, 0], spread: 1, roll: 0 },
  goal: { camera: [-3.7, .3, 10.5], target: [-3.1, 0, 0], spread: .78, roll: -.015 },
  agents: { camera: [1.3, 1.5, 12], target: [.5, .15, 0], spread: 1.06, roll: .01 },
  canvas: { camera: [5.7, -.2, 9.3], target: [4.25, -.7, 0], spread: .78, roll: .02 },
  flow: { camera: [1.6, 5.6, 14.8], target: [1.5, -.1, 0], spread: .57, roll: -.025 },
  demos: { camera: [7.6, .2, 10.6], target: [6.2, -.3, 0], spread: .88, roll: 0 },
  atlas: { camera: [-.8, 4.5, 16.5], target: [1.8, .2, 0], spread: .58, roll: -.03 },
  install: { camera: [2.4, 4.8, 16], target: [2.5, 0, 0], spread: .5, roll: 0 },
  roadmap: { camera: [0, .7, 19], target: [2, 0, 0], spread: 1.42, roll: .02 },
  closing: { camera: [5.8, 0, 13], target: [5.8, 0, 0], spread: .72, roll: 0 },
  future: { camera: [1.8, 1.4, 15.5], target: [1.5, .15, 0], spread: .68, roll: -.02 }
};

const layouts = {
  hero: {
    goal: [-3.5, 0, 0], director: [-.5, 2.15, -.5], reference: [2.2, 3.1, -1.2], asset: [2.5, 1.25, .35], shot: [.8, -.2, 1.1], model: [3.7, -.7, -.8], editor: [1.15, -2.35, -.4], review: [4.15, -2.7, .8], final: [6.7, -.5, 0]
  },
  goal: {
    goal: [-3.3, 0, 1.2], director: [-1.2, 2.6, -1], reference: [2.8, 3.7, -2], asset: [3.6, 1.4, -1.2], shot: [1.8, -.2, -.8], model: [4.7, -.8, -1.8], editor: [2.1, -2.6, -1.2], review: [5.2, -2.9, -1], final: [7.8, -.5, -2]
  },
  agents: {
    goal: [-4.2, 0, -1.2], director: [-1.1, 3.2, .5], reference: [1.6, 3.4, -.5], asset: [2.8, 1.7, .7], shot: [.2, .1, 1.2], model: [4.3, -.2, -.4], editor: [.9, -3.1, .5], review: [4.2, -3.2, 1], final: [7.3, -.6, -.8]
  },
  canvas: {
    goal: [-4.1, 2.7, -1], director: [-1.2, 2.8, 0], reference: [1.7, 3.2, .4], asset: [2.1, 1.1, 1.3], shot: [.1, -.2, .8], model: [4.3, .1, .2], editor: [1.5, -2.6, 1.2], review: [4.6, -2.5, .5], final: [7.1, -.4, 0]
  },
  flow: {
    goal: [-4.2, 0, 0], director: [-2.6, 0, 0], reference: [-.8, 0, 0], asset: [.8, 0, 0], shot: [2.4, 0, 0], model: [4, 0, 0], editor: [5.7, 0, 0], review: [7.4, 0, 0], final: [9.3, 0, 0]
  },
  demos: {
    goal: [-2.5, 3.4, -3], director: [-1.2, 2.4, -2], reference: [1, 3.2, -2], asset: [2, 1.8, -1.4], shot: [3, .5, -1], model: [4.1, -.6, -.8], editor: [4.9, -1.8, -.2], review: [5.8, -2.2, .5], final: [6.5, 0, 2]
  },
  atlas: {
    goal: [-4.6, 2.4, -1.2], director: [-2.5, 3.4, -.4], reference: [-.4, 2.4, -1], asset: [2.1, 3.3, -.4], shot: [4.2, 1.1, .4], model: [-.2, -.9, 1], editor: [2.6, -.6, -.2], review: [4.4, -2.3, .5], final: [7.1, 0, 1.4]
  },
  install: {
    goal: [-3.8, 0, -2], director: [-2.3, 0, -1.8], reference: [-.7, 0, -1.6], asset: [.9, 0, -1.4], shot: [2.5, 0, -1.2], model: [4.1, 0, -1], editor: [5.7, 0, -.8], review: [7.3, 0, -.6], final: [9.1, 0, 0]
  },
  roadmap: {
    goal: [-5, 0, -2], director: [-2.7, 3.7, -1], reference: [.2, 4.2, -2], asset: [3.4, 3, -1], shot: [-.2, .1, 1], model: [4.5, .2, 0], editor: [.6, -3.8, -1], review: [4.2, -4, .5], final: [8.4, 0, 1]
  },
  closing: {
    goal: [-2.2, 0, -2], director: [-1.2, 0, -1.7], reference: [-.2, 0, -1.4], asset: [.8, 0, -1.1], shot: [1.8, 0, -.8], model: [2.8, 0, -.5], editor: [3.8, 0, -.2], review: [4.8, 0, .2], final: [6.4, 0, 1.8]
  },
  future: {
    goal: [-3.5, 1.8, -1.2], director: [-1.9, 3.2, -.4], reference: [.2, 3.8, -1.2], asset: [2.7, 2.3, -.3], shot: [-.2, .2, 1.1], model: [3.4, .1, .6], editor: [.2, -3.2, -.6], review: [3.9, -2.8, .5], final: [7, 0, 1.5]
  }
};

function initializeScene() {
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, narrowScreen ? 1 : 1.4));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, .1, 100);
  camera.position.set(...sceneStates.hero.camera);
  camera.lookAt(new THREE.Vector3(...sceneStates.hero.target));
  scene.add(new THREE.AmbientLight(0xffffff, 2));
  const key = new THREE.DirectionalLight(0xffffff, 4.5);
  key.position.set(4, 8, 11);
  const signal = new THREE.PointLight(0xe85d3f, 11, 18);
  signal.position.set(-2, 1, 5);
  scene.add(key, signal);
  buildProductionWorld();
  resizeScene();
  document.documentElement.classList.add("webgl-ready");
  new ResizeObserver(resizeScene).observe(canvas);
  if (reducedMotion) renderFrame(0);
  else renderer.setAnimationLoop(renderFrame);
}

function buildProductionWorld() {
  groups.root = new THREE.Group();
  groups.nodes = new THREE.Group();
  groups.lines = new THREE.Group();
  groups.particles = buildParticleField();
  groups.beams = buildSignalBeams();
  groups.aperture = buildAperture();
  groups.root.add(groups.particles, groups.beams, groups.lines, groups.nodes, groups.aperture);
  scene.add(groups.root);

  const definitions = [
    ["goal", [1.65, .92, .36], 0xe85d3f, "goal"],
    ["director", [1.9, .62, .3], 0x171715, "agent"],
    ["reference", [1.72, .98, .26], 0xf2f0e9, "asset"],
    ["asset", [1.58, .94, .26], 0xf2f0e9, "asset"],
    ["shot", [1.8, .9, .26], 0xf2f0e9, "asset"],
    ["model", [1.88, .62, .28], 0x171715, "agent"],
    ["editor", [1.95, 1.08, .28], 0xf2f0e9, "asset"],
    ["review", [1.65, .62, .28], 0x171715, "agent"],
    ["final", [2.35, 1.34, .34], 0x11110f, "final"]
  ];
  for (const [id, scale, color, type] of definitions) createNode(id, scale, color, type);
  const mediaPreviews = {
    reference: "assets/native-goal-and-input.jpg",
    asset: "assets/live-production-canvas.jpg",
    editor: "assets/demos/directorx-waic-moss-promo-v2-poster.jpg",
    final: "assets/demos/directorx-waic-moss-promo-v4-poster.jpg"
  };
  for (const [id, source] of Object.entries(mediaPreviews)) addMediaPreview(id, source);
  [
    ["goal", "director"], ["goal", "shot"], ["director", "reference"], ["director", "asset"],
    ["reference", "shot"], ["asset", "shot"], ["shot", "model"], ["model", "editor"],
    ["shot", "editor"], ["editor", "review"], ["review", "final"]
  ].forEach(([from, to]) => createRelation(from, to));

  const floor = new THREE.GridHelper(26, 26, 0xc1bdb3, 0xd8d4cb);
  floor.position.y = -4.7;
  floor.material.transparent = true;
  floor.material.opacity = .25;
  groups.root.add(floor);
  const spineGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-6, 0, -2), new THREE.Vector3(10, 0, 2)]);
  const spine = new THREE.Line(spineGeometry, new THREE.LineBasicMaterial({ color: 0xe85d3f, transparent: true, opacity: .35 }));
  groups.root.add(spine);
  updateSceneLabels();
}

function buildParticleField() {
  const count = narrowScreen ? 70 : 160;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    positions[index * 3] = (Math.random() - .5) * 24;
    positions[index * 3 + 1] = (Math.random() - .5) * 15;
    positions[index * 3 + 2] = (Math.random() - .5) * 7 - 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0xe85d3f, size: narrowScreen ? .035 : .052, transparent: true, opacity: .28, depthWrite: false, sizeAttenuation: true });
  return new THREE.Points(geometry, material);
}

function buildSignalBeams() {
  const group = new THREE.Group();
  for (let index = 0; index < 3; index += 1) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-5 + index * 4.5, -4.2, -1.5 + index * .7),
      new THREE.Vector3(-3.1 + index * 4.5, 4.1, -1.5 + index * .7)
    ]);
    group.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: index === 1 ? 0xe85d3f : 0x817d73, transparent: true, opacity: .16 })));
  }
  return group;
}

function createNode(id, size, color, type) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: .72, metalness: .05 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.userData = { id, type, size, color };
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: type === "goal" ? 0xffa08d : 0x67645d, transparent: true, opacity: .35 }));
  mesh.add(edges);
  groups.nodes.add(mesh);
  nodes.set(id, mesh);
}

function addMediaPreview(id, source) {
  const mesh = nodes.get(id);
  if (!mesh) return;
  new THREE.TextureLoader().load(source, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer?.capabilities.getMaxAnisotropy?.() ?? 1, 4);
    const preview = new THREE.Mesh(
      new THREE.PlaneGeometry(mesh.userData.size[0] * .82, mesh.userData.size[1] * .58),
      new THREE.MeshBasicMaterial({ map: texture, toneMapped: false })
    );
    preview.position.set(0, -.08, mesh.userData.size[2] / 2 + .014);
    mesh.add(preview);
    mesh.userData.hasMediaPreview = true;
    updateSceneLabels();
  });
}

function updateSceneLabels() {
  if (!THREE || !nodes.size) return;
  const labels = locales[locale].sceneLabels;
  for (const [id, mesh] of nodes) {
    if (mesh.userData.labelMesh) {
      mesh.remove(mesh.userData.labelMesh);
      mesh.userData.labelMesh.material.map.dispose();
      mesh.userData.labelMesh.material.dispose();
      mesh.userData.labelMesh.geometry.dispose();
    }
    const darkText = mesh.userData.color === 0xf2f0e9;
    const texture = textTexture(labels[id], darkText ? "#11110f" : "#f4f1e9");
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(mesh.userData.size[0] * .82, mesh.userData.size[1] * (mesh.userData.hasMediaPreview ? .2 : .36)),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false })
    );
    label.position.set(0, mesh.userData.hasMediaPreview ? mesh.userData.size[1] * .34 : 0, mesh.userData.size[2] / 2 + .018);
    mesh.add(label);
    mesh.userData.labelMesh = label;
  }
}

function textTexture(text, color) {
  const surface = document.createElement("canvas");
  surface.width = 1024;
  surface.height = 256;
  const context = surface.getContext("2d");
  context.clearRect(0, 0, surface.width, surface.height);
  context.fillStyle = color;
  context.font = locale === "zh-CN" ? '600 70px "PingFang SC", "Noto Sans CJK SC", sans-serif' : '600 66px "Helvetica Neue", Arial, sans-serif';
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 512, 128);
  const texture = new THREE.CanvasTexture(surface);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer?.capabilities.getMaxAnisotropy?.() ?? 1, 4);
  return texture;
}

function createRelation(fromId, toId) {
  const pointCount = 34;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pointCount * 3), 3));
  geometry.setDrawRange(0, 0);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: fromId === "goal" ? 0xe85d3f : 0x4f4c46, transparent: true, opacity: .48 }));
  const pulse = new THREE.Mesh(new THREE.SphereGeometry(.052, 10, 10), new THREE.MeshBasicMaterial({ color: 0xe85d3f }));
  groups.lines.add(line, pulse);
  relations.push({ fromId, toId, line, pulse, pointCount, offset: Math.random(), speed: .055 + Math.random() * .04 });
}

function relationPoint(relation, amount) {
  const from = nodes.get(relation.fromId).position;
  const to = nodes.get(relation.toId).position;
  const midpoint = from.clone().lerp(to, .5);
  midpoint.z += 1 + Math.abs(from.y - to.y) * .12;
  const inverse = 1 - amount;
  return new THREE.Vector3(
    inverse * inverse * from.x + 2 * inverse * amount * midpoint.x + amount * amount * to.x,
    inverse * inverse * from.y + 2 * inverse * amount * midpoint.y + amount * amount * to.y,
    inverse * inverse * from.z + 2 * inverse * amount * midpoint.z + amount * amount * to.z
  );
}

function updateRelations(seconds, routeProgress) {
  for (const relation of relations) {
    const attribute = relation.line.geometry.attributes.position;
    for (let index = 0; index < relation.pointCount; index += 1) {
      const point = relationPoint(relation, index / (relation.pointCount - 1));
      attribute.setXYZ(index, point.x, point.y, point.z);
    }
    attribute.needsUpdate = true;
    relation.line.geometry.setDrawRange(0, Math.max(2, Math.floor(relation.pointCount * routeProgress)));
    const connected = [relation.fromId, relation.toId].includes(highlightedAgent);
    relation.line.material.opacity += (((connected ? .95 : .42) * routeProgress) - relation.line.material.opacity) * .08;
    relation.pulse.position.copy(relationPoint(relation, (seconds * relation.speed + relation.offset) % 1));
    relation.pulse.visible = routeProgress > .35;
  }
}

function buildAperture() {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color: 0x171715, roughness: .8 });
  const horizontal = new THREE.BoxGeometry(5.2, .12, .16);
  const vertical = new THREE.BoxGeometry(.12, 3.05, .16);
  const top = new THREE.Mesh(horizontal, material);
  const bottom = new THREE.Mesh(horizontal, material);
  const left = new THREE.Mesh(vertical, material);
  const right = new THREE.Mesh(vertical, material);
  top.position.y = 1.5; bottom.position.y = -1.5; left.position.x = -2.55; right.position.x = 2.55;
  group.add(top, bottom, left, right);
  group.position.set(6.4, 0, 1.4);
  group.visible = false;
  return group;
}

function renderFrame(time = 0) {
  if (!renderer || !visible) return;
  const videoPlaying = [...document.querySelectorAll("video")].some(video => !video.paused);
  if (videoPlaying && time - lastWebglFrame < 34) return;
  lastWebglFrame = time;
  const { current, next, mix: trackMix } = resolveSceneTrack(smoothScrollY);
  const currentId = current.dataset.scene;
  const nextId = next.dataset.scene;
  const amount = smoothstep(trackMix);
  const currentState = sceneStates[currentId] ?? sceneStates.hero;
  const nextState = sceneStates[nextId] ?? currentState;
  const state = {
    camera: currentState.camera.map((value, index) => mix(value, nextState.camera[index], amount)),
    target: currentState.target.map((value, index) => mix(value, nextState.target[index], amount)),
    spread: mix(currentState.spread, nextState.spread, amount),
    roll: mix(currentState.roll, nextState.roll, amount)
  };
  const desiredCamera = new THREE.Vector3(...state.camera);
  desiredCamera.x += pointerX * (narrowScreen ? .12 : .42);
  desiredCamera.y += pointerY * (narrowScreen ? .08 : .28);
  camera.position.lerp(desiredCamera, .05);
  camera.lookAt(new THREE.Vector3(...state.target));
  camera.rotation.z += (state.roll + scrollVelocity * .00032 - camera.rotation.z) * .045;
  groups.root.scale.lerp(new THREE.Vector3(state.spread, state.spread, state.spread), .045);
  groups.root.rotation.y += ((pointerX * .035 + scrollVelocity * .0007) - groups.root.rotation.y) * .04;
  groups.root.rotation.x += ((-pointerY * .018) - groups.root.rotation.x) * .04;

  const currentLayout = layouts[currentId] ?? layouts.hero;
  const nextLayout = layouts[nextId] ?? currentLayout;
  const seconds = time * .001;
    const activeIds = currentId === "goal" ? ["goal"] : currentId === "agents" ? [highlightedAgent] : currentId === "canvas" ? ["reference", "asset", "shot", "editor"] : currentId === "atlas" ? ["goal", "reference", "asset", "model", "editor", "review", "final"] : currentId === "demos" ? ["review", "final"] : currentId === "closing" ? ["final"] : currentId === "future" ? ["director", "model", "final"] : [];
  for (const [id, mesh] of nodes) {
    const from = currentLayout[id] ?? layouts.hero[id];
    const to = nextLayout[id] ?? from;
    const target = new THREE.Vector3(mix(from[0], to[0], amount), mix(from[1], to[1], amount), mix(from[2], to[2], amount));
    target.y += Math.sin(seconds * .55 + from[0]) * .018;
    mesh.position.lerp(target, .085);
    const active = activeIds.includes(id);
    const targetScale = active ? 1.1 : 1;
    mesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), .08);
    mesh.material.emissive.setHex(active ? 0x3d1008 : 0x000000);
    mesh.material.emissiveIntensity = active ? .72 : 0;
    mesh.rotation.x += ((currentId === "flow" ? -.18 : -.06) - mesh.rotation.x) * .05;
    mesh.rotation.y += ((currentId === "demos" ? .12 : .06) - mesh.rotation.y) * .05;
  }
  if (groups.particles) {
    groups.particles.rotation.y += .0008 + Math.abs(scrollVelocity) * .000025;
    groups.particles.rotation.x += .00018;
    groups.particles.material.opacity += ((currentId === "future" ? .7 : .28) - groups.particles.material.opacity) * .04;
  }
  if (groups.beams) {
    groups.beams.rotation.z += .00035;
    groups.beams.children.forEach((beam, index) => {
      beam.material.opacity = .12 + (Math.sin(seconds * .8 + index) + 1) * .08;
    });
  }
  const pageProgress = scrollY / Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
  updateRelations(seconds, clamp(pageProgress * 3.4 + .15));
  groups.aperture.visible = ["demos", "closing", "future"].includes(currentId);
  if (groups.aperture.visible) groups.aperture.rotation.z = Math.sin(seconds * .25) * .012;
  renderer.render(scene, camera);
}

function resizeScene() {
  if (!renderer) return;
  const rect = canvas.getBoundingClientRect();
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / Math.max(rect.height, 1);
  camera.updateProjectionMatrix();
}
