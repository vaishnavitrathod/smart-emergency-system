import React, { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, UrlTile } from 'react-native-maps';
import { DEFAULT_CENTER, MAP_TILES_URL } from '../config';
import { colors } from '../theme';

const TILES = MAP_TILES_URL;

// Props: markers [{id, lat, lng, label, color}], route [[lat, lng], ...], center {lat, lng}, style
// Earlier markers in the array are drawn on top of later ones.
export default function AppMap({ markers = [], route = [], center, style, onPress }) {
  const ref = useRef(null);
  const start = center || DEFAULT_CENTER;
  const signature = JSON.stringify([markers.map((m) => [m.id, m.lat, m.lng]), route.length, center]);

  useEffect(() => {
    const timer = setTimeout(() => {
      const points = [
        ...route.map(([latitude, longitude]) => ({ latitude, longitude })),
        ...markers.map((m) => ({ latitude: m.lat, longitude: m.lng })),
      ];
      if (points.length > 1) {
        ref.current?.fitToCoordinates(points, {
          edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
          animated: false,
        });
      } else if (points.length === 1) {
        ref.current?.animateToRegion({ ...points[0], latitudeDelta: 0.02, longitudeDelta: 0.02 }, 0);
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return (
    <View style={[style, styles.wrap]}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        onPress={onPress ? (event) => onPress({ lat: event.nativeEvent.coordinate.latitude, lng: event.nativeEvent.coordinate.longitude }) : undefined}
        mapType={Platform.OS === 'android' ? 'none' : 'standard'}
        initialRegion={{
          latitude: start.lat,
          longitude: start.lng,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        <UrlTile urlTemplate={TILES} maximumZ={19} flipY={false} zIndex={-1} />
        {route.length > 1 && (
          <Polyline
            coordinates={route.map(([latitude, longitude]) => ({ latitude, longitude }))}
            strokeColor={colors.blue}
            strokeWidth={5}
          />
        )}
        {markers.map((m, i) => (
          <Marker
            key={m.id}
            zIndex={markers.length - i}
            coordinate={{ latitude: m.lat, longitude: m.lng }}
            title={m.label}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={[styles.dot, { backgroundColor: m.color }]} />
          </Marker>
        ))}
      </MapView>
      <Text style={styles.attribution}>© OpenStreetMap contributors</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  dot: { width: 20, height: 20, borderRadius: 10, borderWidth: 3, borderColor: '#FFFFFF' },
  attribution: {
    position: 'absolute',
    left: 6,
    bottom: 4,
    fontSize: 10,
    color: '#333333',
    backgroundColor: 'rgba(255,255,255,0.8)',
    paddingHorizontal: 4,
  },
});
