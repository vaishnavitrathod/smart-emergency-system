import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DEFAULT_CENTER, MAP_TILES_URL } from '../config';
import { colors } from '../theme';

const TILES = MAP_TILES_URL;

// Props: markers [{id, lat, lng, label, color}], route [[lat, lng], ...], center {lat, lng}, style
// Earlier markers in the array are drawn on top of later ones.
export default function AppMap({ markers = [], route = [], center, style, onPress }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);
  const fit = useRef(null);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => {
    const start = center || DEFAULT_CENTER;
    const m = L.map(el.current).setView([start.lat, start.lng], 13);
    L.tileLayer(TILES, { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(m);
    const click = (event) => onPressRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng });
    m.on('click', click);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // The container may be laid out after Leaflet starts, so re-measure and re-fit on every resize.
    const observer = new ResizeObserver(() => {
      m.invalidateSize();
      if (fit.current) fit.current();
    });
    observer.observe(el.current);
    return () => {
      observer.disconnect();
      m.off('click', click);
      m.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw and refit only when the content actually changes, not on every parent render.
  const signature = JSON.stringify([markers, route, center]);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    layer.current.clearLayers();
    const points = [];
    if (route.length > 1) {
      L.polyline(route, { color: colors.blue, weight: 5, opacity: 0.85 }).addTo(layer.current);
      points.push(...route);
    }
    [...markers].reverse().forEach((mk) => {
      L.circleMarker([mk.lat, mk.lng], {
        radius: 9,
        color: '#FFFFFF',
        weight: 2,
        fillColor: mk.color,
        fillOpacity: 1,
      })
        .bindTooltip(mk.label || '')
        .addTo(layer.current);
      points.push([mk.lat, mk.lng]);
    });
    fit.current = () => {
      if (points.length > 1) m.fitBounds(points, { padding: [40, 40], maxZoom: 16, animate: false });
      else if (points.length === 1) m.setView(points[0], 15, { animate: false });
      else if (center) m.setView([center.lat, center.lng], 13, { animate: false });
    };
    fit.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <View style={[style, { zIndex: 0, overflow: 'hidden' }]}>
      <div ref={el} style={{ width: '100%', height: '100%' }} />
    </View>
  );
}
