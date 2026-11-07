import React, { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { subscribeMyIncidents } from '../services/incidents';
import { updateStudentLocation } from '../services/tracking';
import { subscribeActiveSafeWalks, updateSafeWalkLocation } from '../services/safeWalks';

const CLOSED = new Set(['RESOLVED', 'CANCELLED']);

export default function StudentTrackingCoordinator({ uid, onIssue }) {
  const [incidents, setIncidents] = useState([]);
  const [safeWalks, setSafeWalks] = useState([]);

  useEffect(
    () =>
      subscribeMyIncidents(
        uid,
        setIncidents,
        (error) => onIssue(`Could not load active incidents for location sharing: ${error.message}`)
      ),
    [uid, onIssue]
  );

  useEffect(
    () => subscribeActiveSafeWalks(
      uid,
      setSafeWalks,
      (error) => onIssue(`Could not load Safe Walks for location sharing: ${error.message}`)
    ),
    [uid, onIssue]
  );

  const activeIds = incidents.filter((incident) => !CLOSED.has(incident.status)).map((incident) => incident.id).sort().join(',');
  const activeWalkIds = safeWalks.map((walk) => walk.id).sort().join(',');

  useEffect(() => {
    if (!activeIds && !activeWalkIds) return undefined;
    let cancelled = false;
    let subscription = null;
    let lastSentAt = 0;
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          onIssue('Allow location access to share your position while an incident is open.');
          return;
        }
        const watch = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 0 },
          (position) => {
            const now = Date.now();
            if (now - lastSentAt < 5000) return;
            lastSentAt = now;
            const location = { lat: position.coords.latitude, lng: position.coords.longitude };
            const updates = [
              ...(activeIds ? activeIds.split(',').map((id) => updateStudentLocation(id, location)) : []),
              ...(activeWalkIds ? activeWalkIds.split(',').map((id) => updateSafeWalkLocation(id, location)) : []),
            ];
            Promise.all(updates)
              .then(() => onIssue(''))
              .catch((error) => onIssue(`Could not update incident location: ${error.message}`));
          }
        );
        if (cancelled) watch.remove();
        else subscription = watch;
      } catch (error) {
        onIssue(`Could not start incident location sharing: ${error.message}`);
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [activeIds, activeWalkIds, onIssue, uid]);

  return null;
}
