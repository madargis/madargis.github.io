const config = JSON.parse(document.getElementById('madar-map')?.textContent || 'null');
const cases = JSON.parse(document.getElementById('madar-cases')?.textContent || '[]');
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const RAD = Math.PI / 180;

const colour = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const escape = (value) =>
  String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

let library;
const loadLibrary = () =>
  (library ??= new Promise((resolve, reject) => {
    if (window.maplibregl) return resolve(window.maplibregl);
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: config.styleUrl, integrity: config.styleIntegrity, crossOrigin: 'anonymous' });
    const script = Object.assign(document.createElement('script'), { src: config.scriptUrl, integrity: config.scriptIntegrity, crossOrigin: 'anonymous' });
    script.onload = () => resolve(window.maplibregl);
    script.onerror = reject;
    document.head.append(link, script);
  }));

const graticule = (step = 10) => {
  const line = (coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } });
  const features = [];
  for (let lon = -180; lon < 180; lon += step) features.push(line(Array.from({ length: 81 }, (_, i) => [lon, -80 + i * 2])));
  for (let lat = -80; lat <= 80; lat += step) features.push(line(Array.from({ length: 181 }, (_, i) => [-180 + i * 2, lat])));
  return { type: 'FeatureCollection', features };
};

const DETAIL = 6;

const basemap = (projection, reliefTile = 256) => ({
  version: 8,
  projection: { type: projection },
  sources: {
    base: { type: 'vector', url: config.vector },
    land: { type: 'geojson', data: config.land, attribution: config.landAttribution },
    relief: { type: 'raster-dem', tiles: [config.terrain], tileSize: reliefTile, maxzoom: 14, encoding: 'terrarium', attribution: config.terrainAttribution },
    grid: { type: 'geojson', data: graticule() },
  },
  layers: [
    { id: 'ground', type: 'background', paint: { 'background-color': ['step', ['zoom'], colour('--map-ocean'), DETAIL, colour('--map-land')] } },
    { id: 'land', type: 'fill', source: 'land', maxzoom: DETAIL, paint: { 'fill-color': colour('--map-land') } },
    { id: 'water', type: 'fill', source: 'base', 'source-layer': 'water', minzoom: DETAIL, paint: { 'fill-color': colour('--map-ocean') } },
    {
      id: 'relief',
      type: 'hillshade',
      source: 'relief',
      paint: {
        'hillshade-shadow-color': colour('--map-shadow'),
        'hillshade-highlight-color': colour('--map-light'),
        'hillshade-accent-color': colour('--map-shadow'),
        'hillshade-exaggeration': 0.75,
      },
    },
    { id: 'grid', type: 'line', source: 'grid', paint: { 'line-color': colour('--map-grid'), 'line-width': 1 } },
    { id: 'coast', type: 'line', source: 'land', maxzoom: DETAIL, paint: { 'line-color': colour('--map-line'), 'line-width': 1 } },
    {
      id: 'roads',
      type: 'line',
      source: 'base',
      'source-layer': 'transportation',
      minzoom: DETAIL,
      filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false],
      paint: { 'line-color': colour('--map-road'), 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 1.2, 16, 3] },
    },
    { id: 'buildings', type: 'fill', source: 'base', 'source-layer': 'building', minzoom: 13, paint: { 'fill-color': colour('--map-building') } },
    {
      id: 'borders',
      type: 'line',
      source: 'base',
      'source-layer': 'boundary',
      minzoom: DETAIL,
      filter: ['all', ['==', ['get', 'admin_level'], 2], ['!=', ['get', 'maritime'], 1]],
      paint: { 'line-color': colour('--slate-300'), 'line-opacity': 0.5, 'line-width': 1, 'line-dasharray': [3, 2] },
    },
  ],
});

const whenNear = (element, start, margin = '600px') => {
  if (!('IntersectionObserver' in window)) return start();
  const observer = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    observer.disconnect();
    start();
  }, { rootMargin: margin });
  observer.observe(element);
};

const figureMarkup = (item, className) =>
  item.value
    ? `<p class="${className}"><span class="figure-number" dir="ltr"><span>${escape(item.value)}</span>${item.unit ? `<span class="figure-unit">${escape(item.unit)}</span>` : ''}</span><span class="figure-label">${escape(item.label)}</span></p>`
    : '';

const reveal = (frame, map) => {
  let shown = false;
  const show = () => {
    if (shown) return;
    shown = true;
    frame.classList.add('is-live');
  };
  map.once('idle', show);
  setTimeout(show, 6000);
};

async function hero(container) {
  const orbit = container.closest('[data-orbit]');
  const stage = container.closest('.orbit-stage');
  const log = orbit.querySelector('[data-orbit-log]');
  const order = [...cases].sort((a, b) => a.location[0] - b.location[0]);
  if (!order.length) return;
  const maplibregl = await loadLibrary();
  const [lon0, lat0] = config.center;
  const aim = ([lon, lat]) => [lon0 + (lon - lon0) * 0.6, lat0 + (lat - lat0) * 0.6];
  const map = new maplibregl.Map({
    container,
    style: basemap('globe', 512),
    center: config.center,
    zoom: 2,
    interactive: false,
    attributionControl: false,
    fadeDuration: 0,
  });
  map.setVerticalFieldOfView(1);
  await new Promise((resolve) => map.once('style.load', resolve));
  const limb = () => {
    const { lng, lat } = map.getCenter();
    const origin = map.project([lng, lat]);
    let widest = 0;
    for (let d = 60; d <= 90; d += 0.5) {
      const phi = lat * RAD;
      const delta = d * RAD;
      const phi2 = Math.asin(Math.sin(phi) * Math.cos(delta));
      const lambda2 = lng * RAD + Math.atan2(Math.sin(delta) * Math.cos(phi), Math.cos(delta) - Math.sin(phi) * Math.sin(phi2));
      const point = map.project([lambda2 / RAD, phi2 / RAD]);
      widest = Math.max(widest, Math.hypot(point.x - origin.x, point.y - origin.y));
    }
    return widest;
  };
  const scale = (limb() / 4) * Math.cos(lat0 * RAD) ** 0.4;
  const targets = [config.center, ...order.map((item) => aim(item.location))];
  const zoomAt = ([, lat]) => Math.log2(stage.clientWidth / 2 / (scale * Math.cos(lat * RAD) ** -0.4));
  let current = config.center;
  map.jumpTo({ center: current, zoom: zoomAt(current) });
  const markers = order.map((item, index) => {
    const element = document.createElement('span');
    element.className = 'orbit-point';
    element.addEventListener('click', () => {
      show(index, true, true);
      schedule();
    });
    return new maplibregl.Marker({ element }).setLngLat(item.location).addTo(map);
  });
  reveal(stage, map);

  let index = 0;
  let timer;
  let playing = !still;
  let visible = true;
  const link = log.querySelector('[data-log-link]');
  const coords = log.querySelector('[data-log-coords]');
  const figure = log.querySelector('[data-log-figure]');
  const pause = log.querySelector('[data-log="pause"]');

  function show(next, animate, spoken) {
    index = (next + order.length) % order.length;
    const item = order[index];
    log.setAttribute('aria-live', spoken ? 'polite' : 'off');
    link.href = item.url;
    link.textContent = item.title;
    coords.textContent = item.coords;
    figure.innerHTML = figureMarkup(item, 'figure figure-log');
    markers.forEach((marker, k) => marker.getElement().classList.toggle('is-active', k === index));
    current = targets[index + 1];
    const target = { center: current, zoom: zoomAt(current) };
    if (animate && !still) map.easeTo({ ...target, duration: 2600, easing: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2) });
    else map.jumpTo(target);
  }

  function schedule() {
    clearTimeout(timer);
    orbit.classList.toggle('is-paused', !playing || !visible);
    if (playing && visible) timer = setTimeout(() => {
      show(index + 1, true, false);
      schedule();
    }, 6500);
  }

  const setPlaying = (value) => {
    playing = value;
    pause.setAttribute('aria-label', playing ? pause.dataset.labelPause : pause.dataset.labelPlay);
    pause.classList.toggle('is-playing', playing);
    schedule();
  };

  log.querySelector('[data-log-controls]').hidden = false;
  log.querySelector('[data-log="prev"]').addEventListener('click', () => {
    show(index - 1, true, true);
    schedule();
  });
  log.querySelector('[data-log="next"]').addEventListener('click', () => {
    show(index + 1, true, true);
    schedule();
  });
  pause.addEventListener('click', () => setPlaying(!playing));

  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    schedule();
  }).observe(orbit);
  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
    schedule();
  });
  window.addEventListener('resize', () => map.jumpTo({ center: current, zoom: zoomAt(current) }));

  show(0, false, false);
  setPlaying(playing);
}

async function atlas(container) {
  const frame = container.closest('.atlas-frame');
  const card = frame.querySelector('[data-atlas-card]');
  const maplibregl = await loadLibrary();
  const lons = cases.map((item) => item.location[0]);
  const lats = cases.map((item) => item.location[1]);
  const map = new maplibregl.Map({
    container,
    style: basemap('mercator', 512),
    bounds: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    fitBoundsOptions: { padding: { top: 80, bottom: 80, left: 80, right: 80 } },
    attributionControl: { compact: false },
    cooperativeGestures: true,
    maxZoom: 15,
    fadeDuration: 0,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  reveal(frame, map);

  let open;
  const place = () => {
    if (!open) return;
    const point = map.project(open.location);
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const x = Math.min(Math.max(point.x - width / 2, 12), frame.clientWidth - width - 12);
    const above = point.y - height - 20;
    const y = above > 12 ? above : Math.min(point.y + 20, frame.clientHeight - height - 12);
    card.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  };
  const show = (item, marker) => {
    open = item;
    document.querySelectorAll('.atlas-point.is-active').forEach((element) => element.classList.remove('is-active'));
    marker.getElement().classList.add('is-active');
    card.innerHTML = `${item.image ? `<img src="${escape(item.image)}" alt="${escape(item.alt)}" width="480" height="300">` : ''}<p class="atlas-title">${escape(item.title)}</p>${figureMarkup(item, 'figure figure-small')}<p class="tile-meta"><span class="coords">${escape(item.coords)}</span></p>`;
    card.hidden = false;
    place();
    requestAnimationFrame(() => card.classList.add('is-open'));
  };
  const hide = (marker) => {
    open = undefined;
    marker.getElement().classList.remove('is-active');
    card.classList.remove('is-open');
    card.hidden = true;
  };
  for (const item of cases) {
    const element = document.createElement('a');
    element.className = 'atlas-point';
    element.href = item.url;
    element.setAttribute('aria-label', item.title);
    const marker = new maplibregl.Marker({ element }).setLngLat(item.location).addTo(map);
    element.addEventListener('pointerenter', () => show(item, marker));
    element.addEventListener('focus', () => show(item, marker));
    element.addEventListener('pointerleave', () => hide(marker));
    element.addEventListener('blur', () => hide(marker));
  }
  map.on('move', place);
}

async function caseMap(container) {
  const section = container.closest('[data-map-section]');
  const frame = container.closest('.map-frame');
  try {
    const response = await fetch(container.dataset.geojson);
    if (!response.ok) throw new Error(response.statusText);
    const data = await response.json();
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    const walk = (value) => {
      if (typeof value[0] === 'number') {
        box[0] = Math.min(box[0], value[0]);
        box[1] = Math.min(box[1], value[1]);
        box[2] = Math.max(box[2], value[0]);
        box[3] = Math.max(box[3], value[1]);
      } else value.forEach(walk);
    };
    const geometries = (item) =>
      item.type === 'FeatureCollection' ? item.features.flatMap(geometries)
        : item.type === 'Feature' ? (item.geometry ? geometries(item.geometry) : [])
          : item.type === 'GeometryCollection' ? item.geometries.flatMap(geometries)
            : [item];
    geometries(data).forEach((geometry) => walk(geometry.coordinates));
    if (!box.every(Number.isFinite)) throw new Error('empty layer');
    const maplibregl = await loadLibrary();
    const map = new maplibregl.Map({
      container,
      style: basemap('mercator'),
      bounds: box,
      fitBoundsOptions: { padding: 48, maxZoom: 16 },
      attributionControl: { compact: false },
      cooperativeGestures: true,
      fadeDuration: 0,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      const fill = colour('--map-point');
      const line = colour('--map-active');
      map.addSource('demo', { type: 'geojson', data });
      map.addLayer({ id: 'demo-fill', type: 'fill', source: 'demo', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': fill, 'fill-opacity': 0.4 } });
      map.addLayer({ id: 'demo-line', type: 'line', source: 'demo', filter: ['!=', '$type', 'Point'], paint: { 'line-color': line, 'line-width': 1.2 } });
      map.addLayer({
        id: 'demo-point',
        type: 'circle',
        source: 'demo',
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-radius': 5, 'circle-color': fill, 'circle-stroke-color': colour('--navy-900'), 'circle-stroke-width': 1.5 },
      });
    });
    reveal(frame, map);
  } catch {
    section.hidden = true;
  }
}

if (config) {
  const heroMap = document.querySelector('[data-hero-map]');
  if (heroMap) {
    const start = () => ('requestIdleCallback' in window ? requestIdleCallback(() => hero(heroMap), { timeout: 1500 }) : setTimeout(() => hero(heroMap), 300));
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }
  document.querySelectorAll('[data-atlas]').forEach((element) => whenNear(element, () => atlas(element)));
  document.querySelectorAll('[data-map]').forEach((element) => whenNear(element, () => caseMap(element)));
}
