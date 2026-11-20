import { parseView, viewSearch } from './explore.mjs';

const config = JSON.parse(document.getElementById('madar-map')?.textContent || 'null');
const cases = JSON.parse(document.getElementById('madar-cases')?.textContent || '[]');
const world = JSON.parse(document.getElementById('madar-explore')?.textContent || 'null');
const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const rtl = document.documentElement.dir === 'rtl';
const lang = document.documentElement.lang;
const RAD = Math.PI / 180;
const DETAIL = 6;
const SPLIT = 5;
const FONT = ['Noto Sans Regular'];
const TERRAIN = { source: 'dem', exaggeration: 1.4 };
const SITE_LAYERS = ['site-overlay', 'site-fill', 'site-line', 'site-point'];
const LABELS = ['label-road', 'label-water', 'label-place'];
const GROUPS = { overlay: ['site-overlay'], data: ['site-fill', 'site-line', 'site-point'], labels: LABELS, buildings: ['buildings'] };

const colour = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const palette = () => Array.from({ length: 8 }, (_, index) => colour(`--map-c${index + 1}`));

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

const shift = (from, to, start = DETAIL, end = 9) => ['interpolate', ['linear'], ['zoom'], start, colour(from), end, colour(to)];

const scene = () => {
  const name = rtl ? ['coalesce', ['get', 'name:ar'], ['get', 'name']] : ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']];
  const label = { 'text-color': shift('--sand-100', '--navy-900'), 'text-halo-color': shift('--navy-900', '--white'), 'text-halo-width': 1.4 };
  const base = basemap('globe', 256);
  const keep = (id) => base.layers.find((layer) => layer.id === id);
  return {
    ...base,
    glyphs: config.glyphs,
    sky: {
      'sky-color': colour('--scene-sky'),
      'horizon-color': colour('--scene-horizon'),
      'fog-color': colour('--scene-fog'),
      'sky-horizon-blend': 0.5,
      'horizon-fog-blend': 0.6,
      'fog-ground-blend': 0.75,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0],
    },
    sources: {
      ...base.sources,
      relief: { ...base.sources.relief, maxzoom: 13 },
      dem: { type: 'raster-dem', tiles: [config.terrain], tileSize: 512, maxzoom: 13, encoding: 'terrarium' },
    },
    layers: [
      { id: 'ground', type: 'background', paint: { 'background-color': ['interpolate', ['linear'], ['zoom'], DETAIL - 0.01, colour('--map-ocean'), DETAIL, colour('--map-land'), 9, colour('--scene-ground')] } },
      keep('land'),
      {
        id: 'landcover',
        type: 'fill',
        source: 'base',
        'source-layer': 'landcover',
        minzoom: 7,
        paint: {
          'fill-color': ['match', ['get', 'class'], 'wood', colour('--scene-wood'), 'grass', colour('--scene-grass'), 'farmland', colour('--scene-farm'), 'wetland', colour('--scene-wet'), 'ice', colour('--white'), 'sand', colour('--scene-sand'), colour('--scene-grass')],
          'fill-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0, 10, 1],
        },
      },
      {
        id: 'landuse',
        type: 'fill',
        source: 'base',
        'source-layer': 'landuse',
        minzoom: 10,
        filter: ['match', ['get', 'class'], ['residential', 'suburb', 'neighbourhood', 'commercial', 'industrial', 'retail'], true, false],
        paint: { 'fill-color': colour('--scene-urban'), 'fill-opacity': 0.75 },
      },
      { id: 'park', type: 'fill', source: 'base', 'source-layer': 'park', minzoom: 9, paint: { 'fill-color': colour('--scene-grass') } },
      { ...keep('water'), paint: { 'fill-color': shift('--map-ocean', '--scene-water') } },
      {
        ...keep('relief'),
        paint: {
          'hillshade-shadow-color': shift('--map-shadow', '--scene-shadow'),
          'hillshade-highlight-color': shift('--map-light', '--white'),
          'hillshade-accent-color': shift('--map-shadow', '--scene-shadow'),
          'hillshade-exaggeration': ['interpolate', ['linear'], ['zoom'], DETAIL, 0.75, 11, 0.5],
        },
      },
      keep('coast'),
      { ...keep('roads'), paint: { 'line-color': shift('--map-road', '--white'), 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 12, 1.6, 16, 5] } },
      keep('borders'),
      {
        id: 'buildings',
        type: 'fill-extrusion',
        source: 'base',
        'source-layer': 'building',
        minzoom: 13,
        paint: {
          'fill-extrusion-color': colour('--scene-building'),
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 4],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
          'fill-extrusion-opacity': 0.9,
        },
      },
      { id: 'label-road', type: 'symbol', source: 'base', 'source-layer': 'transportation_name', minzoom: 13, layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': FONT, 'text-size': 12 }, paint: label },
      { id: 'label-water', type: 'symbol', source: 'base', 'source-layer': 'water_name', minzoom: DETAIL, layout: { 'text-field': name, 'text-font': FONT, 'text-size': 13 }, paint: label },
      {
        id: 'label-place',
        type: 'symbol',
        source: 'base',
        'source-layer': 'place',
        minzoom: DETAIL,
        filter: ['match', ['get', 'class'], ['city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood', 'hamlet'], true, false],
        layout: { 'text-field': name, 'text-font': FONT, 'text-size': ['match', ['get', 'class'], 'city', 16, 'town', 14, 12], 'text-max-width': 8 },
        paint: label,
      },
    ],
  };
};

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

const countryCount = () => ['match', ['get', 'iso2'], ...world.countries.flatMap((country) => [country.iso2, country.count]), 0];

function addCountries(map) {
  if (!world?.countries.length) return;
  const count = countryCount();
  const most = Math.max(2, ...world.countries.map((country) => country.count));
  const shared = { source: 'land', maxzoom: DETAIL, filter: ['>', count, 0] };
  map.addLayer(
    {
      id: 'countries',
      type: 'fill',
      ...shared,
      paint: {
        'fill-color': ['interpolate', ['linear'], count, 1, colour('--map-country'), most, colour('--map-country-most')],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 3, 1, 5, 0.35],
      },
    },
    'relief',
  );
  map.addLayer({ id: 'countries-edge', type: 'line', ...shared, paint: { 'line-color': colour('--map-point'), 'line-width': 1.2 } }, 'relief');
}

function worldMarkers(map, maplibregl, { onCountry, onSite, focusable = true, points = true, split = SPLIT }) {
  const badges = (world?.countries ?? []).map((country) => {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = 'world-badge';
    element.dataset.iso2 = country.iso2;
    element.textContent = country.count;
    element.style.setProperty('--grow', Math.min(1, Math.log10(country.count)).toFixed(2));
    element.setAttribute('aria-label', `${country.name} (${world.text.countryCount}: ${country.count})`);
    if (!focusable) element.tabIndex = -1;
    element.addEventListener('click', (event) => {
      event.stopPropagation();
      onCountry(country.iso2, element);
    });
    new maplibregl.Marker({ element }).setLngLat(country.center).addTo(map);
    return element;
  });
  const dots = points
    ? cases.map((item) => {
        const element = document.createElement('a');
        element.className = 'atlas-point';
        element.href = viewSearch({ site: item.slug });
        element.dataset.slug = item.slug;
        element.setAttribute('aria-label', item.title);
        element.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          onSite(item.slug, element);
        });
        new maplibregl.Marker({ element }).setLngLat(item.location).addTo(map);
        return element;
      })
    : [];
  const sync = () => {
    const low = map.getZoom() < split || !dots.length;
    badges.forEach((element) => (element.style.display = low ? '' : 'none'));
    dots.forEach((element) => (element.style.display = low ? 'none' : ''));
  };
  map.on('zoom', sync);
  sync();
  return { badges, dots };
}

function explorer() {
  const shell = document.querySelector('[data-explore]');
  if (!shell || !world) return null;
  document.body.append(shell);
  const panel = shell.querySelector('[data-explore-panel]');
  const box = shell.querySelector('[data-explore-map]');
  const text = world.text;
  const known = { slugs: cases.map((item) => item.slug), countries: world.countries.map((country) => country.iso2) };
  const baseTitle = document.title;
  const details = new Map();
  let map;
  let maplibregl;
  let flight = 0;
  let spin;
  let jump = false;
  let popup;
  let viewer;
  let returnFocus;
  let current;

  const live = (ids) => ids.filter((id) => map.getLayer(id));

  const fly = (camera, duration = 2800) =>
    new Promise((resolve) => {
      if (still || jump) {
        map.jumpTo(camera);
        resolve();
        return;
      }
      map.flyTo({ ...camera, duration, curve: 1.6, essential: true, freezeElevation: true });
      const timer = setTimeout(resolve, duration + 800);
      map.once('moveend', () => {
        clearTimeout(timer);
        resolve();
      });
    });

  const inset = () => {
    const edge = 24;
    const { width, height } = panel.getBoundingClientRect();
    if (window.innerWidth < 640) return { top: edge + 56, right: edge, left: edge, bottom: height + edge };
    return { top: edge, bottom: edge, [rtl ? 'right' : 'left']: width + edge, [rtl ? 'left' : 'right']: edge + 48 };
  };

  const globeZoom = () => Math.log2((Math.min(window.innerWidth, window.innerHeight) * 0.85 * Math.PI) / 512);

  const worldCamera = ([lon, lat]) => ({ center: [lon, lat * 0.5], zoom: globeZoom(), pitch: 0, bearing: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } });

  const fitCamera = ([west, south, east, north], settle) => {
    const padding = inset();
    const mercator = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
    const width = Math.max(box.clientWidth - padding.left - padding.right, 120);
    const height = Math.max(box.clientHeight - padding.top - padding.bottom, 120);
    const x = ((east - west) / 360) * 512;
    const y = ((mercator(north) - mercator(south)) / (2 * Math.PI)) * 512;
    return { center: [(west + east) / 2, (south + north) / 2], padding, ...settle(Math.log2(Math.min(width / x, height / y))) };
  };

  const targetOf = (view) =>
    view.site ? cases.find((item) => item.slug === view.site).location : world.countries.find((country) => country.iso2 === view.country).center;

  function write(view, record) {
    if (record) {
      const url = `${location.pathname}${viewSearch(view)}${location.hash}`;
      if (record === 'push') history.pushState({ madar: true }, '', url);
      else history.replaceState({ madar: Boolean(history.state?.madar) }, '', url);
    }
    document.querySelectorAll('a[data-lang]').forEach((link) => {
      const target = new URL(link.href);
      target.search = location.search;
      link.href = target.href;
    });
  }

  function open(trigger) {
    returnFocus = trigger ?? document.activeElement;
    shell.hidden = false;
    panel.hidden = false;
    for (const element of document.body.children) element.inert = element !== shell;
    document.documentElement.classList.add('is-exploring');
    document.dispatchEvent(new CustomEvent('madar-explore', { detail: true }));
    if (still || jump) shell.classList.add('is-open');
    else requestAnimationFrame(() => shell.classList.add('is-open'));
    map?.resize();
  }

  function finish() {
    shell.hidden = true;
    shell.classList.remove('is-open');
    for (const element of document.body.children) element.inert = false;
    document.documentElement.classList.remove('is-exploring');
    document.title = baseTitle;
    document.dispatchEvent(new CustomEvent('madar-explore', { detail: false }));
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  }

  async function shaping() {
    if (!rtl || !config.rtlPlugin || maplibregl.getRTLTextPluginStatus() !== 'unavailable') return;
    try {
      const response = await fetch(config.rtlPlugin, { integrity: config.rtlPluginIntegrity, mode: 'cors' });
      maplibregl.setRTLTextPlugin(URL.createObjectURL(await response.blob()), false);
    } catch {}
  }

  async function ensure(from) {
    if (map) return;
    maplibregl = await loadLibrary();
    await shaping();
    map = new maplibregl.Map({
      container: box,
      style: scene(),
      center: from,
      zoom: globeZoom(),
      maxZoom: 17,
      maxPitch: 72,
      maxTileCacheSize: 400,
      pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
      attributionControl: false,
      fadeDuration: 0,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), rtl ? 'top-left' : 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), rtl ? 'bottom-left' : 'bottom-right');
    await new Promise((resolve) => map.once('style.load', resolve));
    addCountries(map);
    worldMarkers(map, maplibregl, { split: 3.5, onCountry: (iso2) => go({ country: iso2 }), onSite: (slug) => go({ site: slug }) });
    const hits = () => live([...GROUPS.data, 'countries']);
    map.on('click', (event) => {
      const [feature] = map.queryRenderedFeatures(event.point, { layers: hits() });
      if (!feature) return;
      if (feature.layer.id === 'countries') go({ country: feature.properties.iso2 });
      else attributes(feature, event.lngLat);
    });
    map.on('mousemove', (event) => {
      map.getCanvas().style.cursor = map.queryRenderedFeatures(event.point, { layers: hits() }).length ? 'pointer' : '';
    });
    for (const name of ['mousedown', 'touchstart', 'wheel']) map.on(name, () => orbit(false));
    box.addEventListener('keydown', () => orbit(false));
  }

  function attributes(feature, lngLat) {
    const rows = Object.entries(feature.properties ?? {})
      .slice(0, 14)
      .map(([key, value]) => `<tr><th scope="row">${escape(key)}</th><td>${escape(value)}</td></tr>`)
      .join('');
    popup?.remove();
    popup = new maplibregl.Popup({ maxWidth: '22rem', className: 'explore-popup' })
      .setLngLat(lngLat)
      .setHTML(`<table dir="ltr"><caption>${escape(text.attributes)}</caption>${rows}</table>`)
      .addTo(map);
  }

  function orbit(on) {
    cancelAnimationFrame(spin);
    spin = undefined;
    const button = panel.querySelector('[data-act="orbit"]');
    if (button) {
      button.setAttribute('aria-pressed', String(Boolean(on && !still)));
      button.textContent = on && !still ? text.orbitStop : text.orbit;
    }
    if (!on || still) return;
    let last = performance.now();
    const step = (now) => {
      map.setBearing(map.getBearing() - (now - last) * 0.005);
      last = now;
      spin = requestAnimationFrame(step);
    };
    spin = requestAnimationFrame(step);
  }

  function clearSite() {
    if (!map) return;
    orbit(false);
    popup?.remove();
    for (const id of live(SITE_LAYERS)) map.removeLayer(id);
    for (const id of ['site-overlay', 'site-data']) if (map.getSource(id)) map.removeSource(id);
    for (const id of live([...LABELS, 'buildings'])) map.setLayoutProperty(id, 'visibility', 'visible');
    map.setTerrain(null);
  }

  function addSite(data) {
    const colours = palette();
    if (data.overlay) {
      const [west, south, east, north] = data.overlay.bounds;
      map.addSource('site-overlay', { type: 'image', url: data.overlay.url, coordinates: [[west, north], [east, north], [east, south], [west, south]] });
      map.addLayer({ id: 'site-overlay', type: 'raster', source: 'site-overlay', paint: { 'raster-fade-duration': 0 } }, 'roads');
    }
    if (!data.layer) return;
    const { key, values = [] } = data.layer;
    const tint = key ? ['match', ['to-string', ['get', key]], ...values.flatMap((value, index) => [value, colours[index]]), colours[0]] : colours[0];
    map.addSource('site-data', { type: 'geojson', data: data.layer.url });
    map.addLayer({ id: 'site-fill', type: 'fill', source: 'site-data', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': tint, 'fill-opacity': 0.42 } }, 'label-road');
    map.addLayer({ id: 'site-line', type: 'line', source: 'site-data', filter: ['!=', '$type', 'Point'], paint: { 'line-color': tint, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 3.5] } }, 'label-road');
    map.addLayer({
      id: 'site-point',
      type: 'circle',
      source: 'site-data',
      filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 8], 'circle-color': tint, 'circle-stroke-color': colour('--navy-900'), 'circle-stroke-width': 1.5 },
    }, 'label-road');
  }

  function toggle(key, on) {
    if (key === 'terrain') return map.setTerrain(on ? TERRAIN : null);
    for (const id of live(GROUPS[key] ?? [])) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }

  const focusTitle = () => panel.querySelector('#explore-title')?.focus({ preventScroll: true });

  const head = (sheet) =>
    `<div class="explore-head"><button class="explore-back" type="button" data-act="back">${escape(text.back)}</button>${
      sheet ? `<button class="explore-sheet" type="button" data-act="sheet" aria-expanded="true">${escape(text.details)}</button>` : ''
    }</div>`;

  const credit = () =>
    `<a href="${escape(config.attributionUrl)}">${escape(config.attribution)}</a>. ${escape(config.terrainAttribution)}. ${escape(config.landAttribution)}.`;

  function legend(data) {
    if (!data.layer) return '';
    const colours = palette();
    const items = data.layer.key
      ? data.layer.values.map((value, index) => [colours[index], value.replace(/_/g, ' ')])
      : data.layer.shapes.map((shape) => [colours[0], text.shapes[shape]]);
    return `<div class="explore-legend"><h3>${escape(text.legend)}</h3>${data.layer.key ? `<p class="explore-key" dir="ltr">${escape(data.layer.key)}</p>` : ''}<ul role="list">${items
      .map(([tint, label]) => `<li><span class="explore-swatch" style="background:${tint}"></span><span dir="auto">${escape(label)}</span></li>`)
      .join('')}</ul></div>`;
  }

  function video(data) {
    if (!data.video) return '';
    const spoken = data.video.lang && data.video.lang !== lang ? ` (${escape(text.videoLang[data.video.lang])})` : '';
    return `<h3>${escape(text.video)}${spoken}</h3><video class="explore-video" controls controlslist="nodownload" disablepictureinpicture preload="none" playsinline width="1600" height="900" src="${escape(data.video.src)}"${data.video.poster ? ` poster="${escape(data.video.poster)}"` : ''}></video>`;
  }

  const section = (heading, body) => (body ? `<h3>${escape(heading)}</h3>${body}` : '');

  function renderCountry(place, members) {
    panel.innerHTML = `${head(false)}
<h2 id="explore-title" class="explore-title" tabindex="-1">${escape(place.name)}</h2>
<p class="explore-meta">${escape(text.countryCount)}: ${place.count}</p>
<p>${escape(text.choose)}</p>
<ul class="explore-list" role="list">${members
      .map((item) => `<li><a href="${viewSearch({ site: item.slug })}" data-act="site" data-slug="${escape(item.slug)}"><span class="explore-list-title">${escape(item.title)}</span>${figureMarkup(item, 'figure figure-small')}</a></li>`)
      .join('')}</ul>
<p class="explore-demo">${escape(text.demo)}</p>`;
    focusTitle();
  }

  function renderSite(item, data) {
    if (!data) {
      panel.innerHTML = `${head(false)}<h2 id="explore-title" class="explore-title" tabindex="-1">${escape(item.title)}</h2><p>${escape(text.failed)}</p><p><a class="button" href="${escape(item.url)}">${escape(text.openCase)}</a></p>`;
      focusTitle();
      return;
    }
    const toggles = [
      data.overlay && ['overlay', text.layerOverlay],
      data.layer && ['data', text.layerData],
      ['labels', text.layerLabels],
      ['buildings', text.layerBuildings],
      ['terrain', text.layerTerrain],
    ].filter(Boolean);
    const actions = [
      still ? '' : `<button class="explore-button" type="button" data-act="orbit" aria-pressed="false">${escape(text.orbit)}</button>`,
      data.model ? `<button class="explore-button" type="button" data-act="model">${escape(text.model)}</button>` : '',
    ].join('');
    panel.innerHTML = `${head(true)}
<div class="explore-body">
<p class="explore-meta">${escape(data.country)}${data.country ? ' · ' : ''}<span class="coords">${escape(data.coords)}</span></p>
<h2 id="explore-title" class="explore-title" tabindex="-1">${escape(data.title)}</h2>
<p class="explore-demo">${escape(text.demo)}</p>
${data.headline ? figureMarkup(data.headline, 'figure figure-small') : ''}
${data.service ? `<p class="explore-service">${escape(text.service)}: <a href="${escape(data.service.url)}">${escape(data.service.name)}</a></p>` : ''}
${actions ? `<div class="explore-actions">${actions}</div>` : ''}
${data.model ? '<div class="explore-model" data-model></div>' : ''}
<fieldset class="explore-layers"><legend>${escape(text.layers)}</legend>${toggles
      .map(([key, name]) => `<label><input type="checkbox" data-layer="${key}" checked> <span>${escape(name)}</span></label>`)
      .join('')}</fieldset>
${legend(data)}
${data.overlay ? `<p class="note">${escape(text.overlayNote)}</p>` : ''}
<p class="note explore-hint">${escape(text.hint)}</p>
${video(data)}
${section(text.data, data.data ? `<p>${escape(data.data)}</p>` : '')}
${section(text.method, data.method.length ? `<ol class="explore-steps">${data.method.map((step) => `<li>${escape(step)}</li>`).join('')}</ol>` : '')}
${section(text.limits, data.limits ? `<p>${escape(data.limits)}</p>` : '')}
${section(
  text.images,
  data.images.length
    ? `<div class="explore-images">${data.images
        .map((image) => `<img src="${escape(image.src)}" alt="${escape(image.alt)}"${image.width ? ` width="${image.width}" height="${image.height}"` : ''} loading="lazy" decoding="async">`)
        .join('')}</div>`
    : '',
)}
<p class="explore-open"><a class="button" href="${escape(data.url)}">${escape(text.openCase)}</a></p>
<p class="map-credit">${credit()}</p>
</div>`;
    panel.querySelector('video')?.addEventListener('contextmenu', (event) => event.preventDefault());
    focusTitle();
  }

  function showModel(button, data) {
    viewer ??= new Promise((resolve, reject) => {
      const script = Object.assign(document.createElement('script'), { type: 'module', src: world.model.scriptUrl, integrity: world.model.scriptIntegrity, crossOrigin: 'anonymous' });
      script.onload = resolve;
      script.onerror = reject;
      document.head.append(script);
    });
    const slot = panel.querySelector('[data-model]');
    slot.innerHTML = `<model-viewer src="${escape(data.model.url)}" alt="${escape(data.model.alt)}" camera-controls camera-orbit="-35deg 62deg 55%" interaction-prompt="none"></model-viewer>`;
    button.hidden = true;
    viewer.catch(() => (slot.textContent = text.failed));
  }

  async function detailsOf(item) {
    if (!details.has(item.slug)) {
      details.set(
        item.slug,
        fetch(`${item.url}explore.json`).then((response) => {
          if (!response.ok) throw new Error(response.statusText);
          return response.json();
        }),
      );
    }
    return details.get(item.slug).catch(() => {
      details.delete(item.slug);
      return null;
    });
  }

  async function country(iso2, ticket) {
    const place = world.countries.find((candidate) => candidate.iso2 === iso2);
    const members = cases.filter((item) => item.iso2 === iso2);
    clearSite();
    current = undefined;
    renderCountry(place, members);
    document.title = `${place.name} | ${baseTitle}`;
    await fly(fitCamera(place.bounds, (zoom) => ({ zoom: Math.min(zoom, 7), pitch: 0, bearing: 0 })), 3200);
    if (ticket !== flight || members.length !== 1) return;
    write({ site: members[0].slug }, 'replace');
    await site(members[0].slug, ticket);
  }

  async function site(slug, ticket) {
    const item = cases.find((candidate) => candidate.slug === slug);
    clearSite();
    const data = await detailsOf(item);
    if (ticket !== flight) return;
    current = data;
    renderSite(item, data);
    document.title = `${item.title} | ${baseTitle}`;
    if (data) addSite(data);
    map.setTerrain(TERRAIN);
    const [x, y] = item.location;
    const bounds = data?.view ?? [x - 0.03, y - 0.02, x + 0.03, y + 0.02];
    const camera = fitCamera(bounds, (zoom) => ({ zoom: Math.min(zoom - 0.3, 15), pitch: 60, bearing: -24 }));
    await fly({ ...camera, pitch: 0, bearing: 0 }, 3600);
    if (ticket !== flight) return;
    await fly(camera, 2200);
  }

  async function close(ticket) {
    if (shell.hidden) return;
    clearSite();
    current = undefined;
    panel.hidden = true;
    if (map) await fly(worldCamera(map.getCenter().toArray()), 2400);
    if (ticket !== flight) return;
    shell.classList.remove('is-open');
    setTimeout(() => ticket === flight && finish(), still ? 0 : 350);
  }

  async function go(view, { record, from, trigger, instant = false } = {}) {
    const ticket = ++flight;
    if (!view.site && !view.country) {
      write(view, record);
      return close(ticket);
    }
    const opening = shell.hidden;
    jump = instant;
    write(view, record ?? (opening ? 'push' : 'replace'));
    if (opening) open(trigger);
    else {
      panel.hidden = false;
      shell.classList.add('is-open');
    }
    await ensure(from ?? targetOf(view));
    if (ticket !== flight) return;
    if (opening) map.jumpTo(worldCamera(from ?? targetOf(view)));
    if (view.country) await country(view.country, ticket);
    else await site(view.site, ticket);
    jump = false;
  }

  function back() {
    if (history.state?.madar) history.back();
    else go({}, { record: 'replace' });
  }

  panel.addEventListener('click', (event) => {
    const target = event.target.closest('[data-act]');
    if (!target) return;
    const act = target.dataset.act;
    if (act === 'site') {
      event.preventDefault();
      go({ site: target.dataset.slug });
    }
    if (act === 'back') back();
    if (act === 'orbit') orbit(!spin);
    if (act === 'model' && current?.model) showModel(target, current);
    if (act === 'sheet') {
      const folded = shell.classList.toggle('is-folded');
      target.setAttribute('aria-expanded', String(!folded));
    }
  });
  panel.addEventListener('change', (event) => {
    const input = event.target.closest('[data-layer]');
    if (input && map) toggle(input.dataset.layer, input.checked);
  });
  shell.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.defaultPrevented) back();
  });
  window.addEventListener('popstate', () => go(parseView(location.search, known), { record: false }));
  window.addEventListener('resize', () => map?.resize());

  const initial = parseView(location.search, known);
  if (initial.site || initial.country) go(initial, { record: false, instant: true });

  return { go };
}

async function hero(container, explore) {
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
  addCountries(map);
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
  const { badges } = worldMarkers(map, maplibregl, {
    focusable: false,
    points: false,
    onCountry: (iso2, element) => explore?.go({ country: iso2 }, { from: current, trigger: element }),
  });
  const countryAt = (event) => {
    if (!map.getLayer('countries')) return undefined;
    const box = container.getBoundingClientRect();
    return map.queryRenderedFeatures([event.clientX - box.left, event.clientY - box.top], { layers: ['countries'] })[0];
  };
  container.addEventListener('click', (event) => {
    const feature = countryAt(event);
    if (feature) explore?.go({ country: feature.properties.iso2 }, { from: current });
  });
  container.addEventListener('mousemove', (event) => {
    container.style.cursor = countryAt(event) ? 'pointer' : '';
  });
  reveal(stage, map);

  let index = 0;
  let timer;
  let playing = !still;
  let visible = true;
  let exploring = false;
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
    badges.forEach((element) => element.classList.toggle('is-active', element.dataset.iso2 === item.iso2));
    current = targets[index + 1];
    const target = { center: current, zoom: zoomAt(current) };
    if (animate && !still) map.easeTo({ ...target, duration: 2600, easing: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2) });
    else map.jumpTo(target);
  }

  function schedule() {
    clearTimeout(timer);
    const moving = playing && visible && !exploring;
    orbit.classList.toggle('is-paused', !moving);
    if (moving) {
      timer = setTimeout(() => {
        show(index + 1, true, false);
        schedule();
      }, 6500);
    }
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
  const flyButton = log.querySelector('[data-log="fly"]');
  if (explore) flyButton.addEventListener('click', () => explore.go({ site: order[index].slug }, { from: current, trigger: flyButton }));
  else flyButton.hidden = true;
  pause.addEventListener('click', () => setPlaying(!playing));

  new IntersectionObserver((entries) => {
    visible = entries.some((entry) => entry.isIntersecting);
    schedule();
  }).observe(orbit);
  document.addEventListener('visibilitychange', () => {
    visible = document.visibilityState === 'visible';
    schedule();
  });
  document.addEventListener('madar-explore', (event) => {
    exploring = event.detail;
    schedule();
  });
  window.addEventListener('resize', () => map.jumpTo({ center: current, zoom: zoomAt(current) }));

  show(0, false, false);
  setPlaying(playing);
}

async function atlas(container, explore) {
  const frame = container.closest('.atlas-frame');
  const card = frame.querySelector('[data-atlas-card]');
  const maplibregl = await loadLibrary();
  const lons = cases.map((item) => item.location[0]);
  const lats = cases.map((item) => item.location[1]);
  const map = new maplibregl.Map({
    container,
    style: basemap('mercator', 512),
    bounds: world?.atlas ?? [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    fitBoundsOptions: { padding: 24 },
    attributionControl: { compact: false },
    cooperativeGestures: true,
    maxZoom: 15,
    fadeDuration: 0,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.once('style.load', () => addCountries(map));
  reveal(frame, map);
  const from = () => map.getCenter().toArray();

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
  const show = (item, element) => {
    open = item;
    document.querySelectorAll('.atlas-point.is-active').forEach((other) => other.classList.remove('is-active'));
    element.classList.add('is-active');
    card.innerHTML = `${item.image ? `<img src="${escape(item.image)}" alt="${escape(item.alt)}" width="480" height="300">` : ''}<p class="atlas-title">${escape(item.title)}</p>${figureMarkup(item, 'figure figure-small')}<p class="tile-meta"><span class="coords">${escape(item.coords)}</span></p>`;
    card.hidden = false;
    place();
    requestAnimationFrame(() => card.classList.add('is-open'));
  };
  const hide = (element) => {
    open = undefined;
    element.classList.remove('is-active');
    card.classList.remove('is-open');
    card.hidden = true;
  };
  const { dots } = worldMarkers(map, maplibregl, {
    onCountry: (iso2, element) => explore?.go({ country: iso2 }, { from: from(), trigger: element }),
    onSite: (slug, element) => explore?.go({ site: slug }, { from: from(), trigger: element }),
  });
  for (const element of dots) {
    const item = cases.find((candidate) => candidate.slug === element.dataset.slug);
    element.addEventListener('pointerenter', () => show(item, element));
    element.addEventListener('focus', () => show(item, element));
    element.addEventListener('pointerleave', () => hide(element));
    element.addEventListener('blur', () => hide(element));
  }
  if (world?.countries.length) {
    map.on('click', 'countries', (event) => explore?.go({ country: event.features[0].properties.iso2 }, { from: event.lngLat.toArray() }));
    map.on('mouseenter', 'countries', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'countries', () => (map.getCanvas().style.cursor = ''));
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
  const explore = explorer();
  const heroMap = document.querySelector('[data-hero-map]');
  if (heroMap) {
    const start = () => ('requestIdleCallback' in window ? requestIdleCallback(() => hero(heroMap, explore), { timeout: 1500 }) : setTimeout(() => hero(heroMap, explore), 300));
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
  }
  document.querySelectorAll('[data-atlas]').forEach((element) => whenNear(element, () => atlas(element, explore)));
  document.querySelectorAll('[data-map]').forEach((element) => whenNear(element, () => caseMap(element)));
}
