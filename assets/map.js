const section = document.querySelector('[data-map-section]');
const container = document.querySelector('[data-map]');

const extend = (box, coordinates) => {
  if (typeof coordinates[0] === 'number') {
    const [x, y] = coordinates;
    return [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)];
  }
  return coordinates.reduce(extend, box);
};

const geometries = (data) => {
  if (data.type === 'FeatureCollection') return data.features.flatMap(geometries);
  if (data.type === 'Feature') return data.geometry ? geometries(data.geometry) : [];
  if (data.type === 'GeometryCollection') return data.geometries.flatMap(geometries);
  return [data];
};

const boundsOf = (data) =>
  geometries(data).reduce((box, geometry) => extend(box, geometry.coordinates), [Infinity, Infinity, -Infinity, -Infinity]);

async function showMap() {
  const response = await fetch(container.dataset.geojson);
  if (!response.ok) return;
  const data = await response.json();
  const [west, south, east, north] = boundsOf(data);
  if (!Number.isFinite(west)) return;
  section.hidden = false;
  const styles = getComputedStyle(container);
  const fill = styles.getPropertyValue('--map-fill').trim();
  const line = styles.getPropertyValue('--map-line').trim();
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        base: { type: 'raster', tiles: [container.dataset.tiles], tileSize: 256, maxzoom: 19, attribution: container.dataset.attribution },
      },
      layers: [{ id: 'base', type: 'raster', source: 'base' }],
    },
    bounds: [west, south, east, north],
    fitBoundsOptions: { padding: 40, maxZoom: 16 },
    attributionControl: { compact: false },
    cooperativeGestures: true,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
  map.on('load', () => {
    map.addSource('demo', { type: 'geojson', data });
    map.addLayer({ id: 'demo-fill', type: 'fill', source: 'demo', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': fill, 'fill-opacity': 0.35 } });
    map.addLayer({ id: 'demo-line', type: 'line', source: 'demo', filter: ['!=', '$type', 'Point'], paint: { 'line-color': line, 'line-width': 1 } });
    map.addLayer({
      id: 'demo-point',
      type: 'circle',
      source: 'demo',
      filter: ['==', '$type', 'Point'],
      paint: { 'circle-radius': 6, 'circle-color': fill, 'circle-stroke-color': line, 'circle-stroke-width': 2 },
    });
  });
}

if (section && container && window.maplibregl) showMap();
