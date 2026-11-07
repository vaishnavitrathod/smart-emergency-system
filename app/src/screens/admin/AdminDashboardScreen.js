import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../../firebase';
import AppMap from '../../components/AppMap';
import BarChart from '../../components/BarChart';
import { INCIDENT_CATEGORIES } from '../../services/classify';
import { assignResponder, createPartner, decideResponder, deletePartner, getIncidentIdentity, loadResponders, manageUser, subscribeUsers } from '../../services/admin';
import { subscribeIncidents } from '../../services/incidents';
import { subscribePartners } from '../../services/partners';
import { colors, priorityColors, shared } from '../../theme';

const STATUSES = ['ACTIVE', 'ASSIGNED', 'EN_ROUTE', 'ARRIVED', 'RESOLVED', 'CANCELLED', 'ESCALATED'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const ROLE_ALIASES = { student: 'user', guard: 'responder' };

function asDate(value) {
  if (value?.toDate) return value.toDate();
  if (value?.seconds) return new Date(value.seconds * 1000);
  if (typeof value === 'string') return new Date(value);
  return value instanceof Date ? value : null;
}

function minutesBetween(start, end) {
  const first = asDate(start)?.getTime();
  const last = asDate(end)?.getTime();
  return first && last && last >= first ? (last - first) / 60_000 : null;
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function countRows(items, label) {
  const counts = new Map();
  items.forEach((item) => {
    const key = label(item) || 'Unknown';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts].map(([key, value]) => ({ label: key, value }));
}

function safeCsv(value) {
  let text = value == null ? '' : String(value);
  if (/^[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function formatted(value) {
  const date = asDate(value);
  return date ? date.toLocaleString() : '';
}

function FilterPills({ label, values, selected, onSelect }) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={shared.heading}>{label}</Text>
      <View style={shared.row}>
        {values.map((value) => (
          <Pressable key={value} onPress={() => onSelect(value)} style={{ ...shared.pill, borderColor: selected === value ? colors.red : colors.border }} accessibilityRole="button" accessibilityState={{ selected: selected === value }}>
            <Text style={shared.pillText}>{value}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function AdminDashboardScreen({ navigation, readOnly = false, profile }) {
  const [incidents, setIncidents] = useState(null);
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [priorityFilter, setPriorityFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [selectedResponder, setSelectedResponder] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [newRole, setNewRole] = useState('user');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [identities, setIdentities] = useState({});
  const [partners, setPartners] = useState([]);
  const [auditRows, setAuditRows] = useState([]);
  const [partnerName, setPartnerName] = useState('');
  const [partnerType, setPartnerType] = useState('hospital');
  const [partnerPhone, setPartnerPhone] = useState('');
  const [partnerLat, setPartnerLat] = useState('');
  const [partnerLng, setPartnerLng] = useState('');

  useEffect(() => subscribeIncidents(setIncidents, (e) => { setIncidents([]); setError(`Could not load incidents: ${e.message}`); }), []);
  useEffect(() => {
    if (!readOnly) return subscribeUsers(setUsers, (e) => { setUsers([]); setError(`Could not load users: ${e.message}`); });
    let active = true;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try { const rows = await loadResponders(); if (active) setUsers(rows.map((row) => ({ ...row, role: 'responder' }))); }
      catch (e) { if (active) setError(`Could not load responders: ${e.message}`); }
      finally { loading = false; }
    };
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => { active = false; clearInterval(timer); };
  }, [readOnly]);
  useEffect(() => subscribePartners(setPartners, (e) => setError(`Could not load partners: ${e.message}`)), []);
  useEffect(() => {
    if (readOnly || profile?.role !== 'admin') return undefined;
    return onSnapshot(query(collection(db, 'auditLog'), orderBy('createdAt', 'desc'), limit(30)), (snapshot) => {
      setAuditRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
    }, (e) => setError(`Could not load audit history: ${e.message}`));
  }, [readOnly, profile?.role]);

  const freshResponders = useMemo(() => (users || []).filter((user) => {
    const seen = asDate(user.lastSeen)?.getTime();
    const role = ROLE_ALIASES[user.role] || user.role;
    return role === 'responder' && user.verified !== false && user.onDuty && !user.disabled && seen && Date.now() - seen < 120_000 && user.location;
  }), [users]);

  const visibleIncidents = useMemo(() => (incidents || []).filter((item) => {
    if (statusFilter !== 'All' && item.status !== statusFilter) return false;
    if (priorityFilter !== 'All' && item.priority !== priorityFilter) return false;
    if (categoryFilter !== 'All' && (item.category || item.type) !== categoryFilter) return false;
    const day = asDate(item.createdAt)?.toISOString().slice(0, 10) || '';
    if (fromDate && day < fromDate) return false;
    if (toDate && day > toDate) return false;
    return true;
  }), [incidents, statusFilter, priorityFilter, categoryFilter, fromDate, toDate]);

  const activeIncidents = (incidents || []).filter((item) => !['RESOLVED', 'CANCELLED'].includes(item.status));
  const markers = [
    ...activeIncidents.filter((item) => item.userLocation || item.location).map((item) => {
      const point = item.userLocation || item.location;
      return { id: item.id, lat: point.lat, lng: point.lng, label: `${item.type} · ${item.priority}`, color: priorityColors[item.priority] || colors.red };
    }),
    ...(users || []).filter((user) => ['responder', 'guard'].includes(user.role) && user.onDuty && !user.disabled && user.location).map((user) => ({
      id: `responder-${user.id}`, lat: user.location.lat, lng: user.location.lng, label: `On-duty responder · ${user.name || 'Responder'}`, color: '#1565C0',
    })),
  ];

  const acceptedAverage = average((incidents || []).map((item) => minutesBetween(item.createdAt, item.acceptedAt)));
  const arrivedAverage = average((incidents || []).map((item) => minutesBetween(item.createdAt, item.arrivedAt)));
  const resolvedAverage = average((incidents || []).map((item) => minutesBetween(item.createdAt, item.resolvedAt)));
  const falseRate = incidents?.length ? ((incidents.filter((item) => item.status === 'CANCELLED').length / incidents.length) * 100).toFixed(1) : '0.0';
  const categoryRows = countRows(incidents || [], (item) => item.category || item.type);
  const hourRows = countRows(incidents || [], (item) => {
    const date = asDate(item.createdAt);
    return date ? `${String(date.getHours()).padStart(2, '0')}:00` : 'Unknown';
  });
  const landmarkRows = countRows(incidents || [], (item) => {
    const point = item.location || item.userLocation;
    return point ? `${Number(point.lat).toFixed(2)}, ${Number(point.lng).toFixed(2)}` : 'Unknown';
  });

  async function doAssign(incidentId) {
    if (!selectedResponder) { setError('Choose an available responder first.'); return; }
    setBusy(`assign-${incidentId}`); setError(''); setNotice('');
    try { await assignResponder(incidentId, selectedResponder); setNotice('Incident assigned.'); }
    catch (e) { setError(`Could not assign the incident: ${e.message}`); }
    finally { setBusy(''); }
  }

  async function reviewResponder(uid, decision) {
    setBusy(`responder-${uid}`); setError(''); setNotice('');
    try { await decideResponder(uid, decision); setNotice(`Responder application ${decision}d.`); }
    catch (e) { setError(`Could not review application: ${e.message}`); }
    finally { setBusy(''); }
  }

  async function savePartner() {
    setBusy('partner'); setError(''); setNotice('');
    try {
      await createPartner({ name: partnerName, type: partnerType, phone: partnerPhone, lat: partnerLat, lng: partnerLng });
      setPartnerName(''); setPartnerPhone(''); setPartnerLat(''); setPartnerLng(''); setNotice('Partner saved.');
    } catch (e) { setError(`Could not save partner: ${e.message}`); }
    finally { setBusy(''); }
  }

  async function removePartner(id) {
    setBusy(`partner-${id}`); setError(''); setNotice('');
    try { await deletePartner(id); setNotice('Partner removed.'); }
    catch (e) { setError(`Could not remove partner: ${e.message}`); }
    finally { setBusy(''); }
  }

  async function revealIdentity(incidentId) {
    setBusy(`identity-${incidentId}`); setError('');
    try {
      const identity = await getIncidentIdentity(incidentId);
      setIdentities((items) => ({ ...items, [incidentId]: identity }));
    } catch (e) { setError(`Could not load incident identity: ${e.message}`); }
    finally { setBusy(''); }
  }

  async function setUserRole(email, role, disabled = false) {
    setBusy(`user-${email}`); setError(''); setNotice('');
    try {
      await manageUser(email, role, disabled);
      setNotice(`${email} is now ${disabled ? 'deactivated' : role}.`);
      if (email.toLowerCase() === userEmail.toLowerCase()) setUserEmail('');
    } catch (e) { setError(`Could not update user: ${e.message}`); }
    finally { setBusy(''); }
  }

  async function exportCsv() {
    const rows = visibleIncidents.map((item) => [
      item.id, item.status, item.priority, item.type, formatted(item.createdAt), formatted(item.acceptedAt),
      formatted(item.arrivedAt), formatted(item.resolvedAt), item.nearestLandmark, item.landmarkDistanceM, item.anonymous ? 'yes' : 'no',
    ]);
    const csv = [['Incident ID', 'Status', 'Priority', 'Category', 'Created', 'Accepted', 'Arrived', 'Resolved', 'Landmark', 'Distance m', 'Anonymous'], ...rows]
      .map((row) => row.map(safeCsv).join(',')).join('\r\n');
    try {
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url; anchor.download = `emergency-response-${fromDate || 'all'}-${toDate || 'all'}.csv`;
        anchor.click(); URL.revokeObjectURL(url);
      } else await Share.share({ title: 'Emergency response report', message: csv });
    } catch (e) { setError(`Could not export report: ${e.message}`); }
  }

  return (
    <ScrollView style={shared.screen} contentContainerStyle={shared.content}>
      <View style={shared.card}>
        <Text style={shared.title}>{readOnly ? 'Operator dashboard' : 'Emergency operations'}</Text>
        <Text style={shared.muted}>{activeIncidents.length} open incidents · {freshResponders.length} verified responders on duty with recent location</Text>
        {!readOnly && <Pressable style={shared.buttonOutline} onPress={() => navigation.navigate('AdminLocations')} accessibilityRole="button"><Text style={shared.buttonOutlineText}>Manage configured locations</Text></Pressable>}
      </View>
      {!!error && <Text style={shared.error}>{error}</Text>}
      {!!notice && <Text style={{ color: colors.green, fontWeight: '700' }}>{notice}</Text>}

      <View style={shared.card}>
        <Text style={shared.title}>Live map</Text>
        <View style={{ height: 360, borderRadius: 12, overflow: 'hidden' }}><AppMap style={{ height: 360 }} markers={markers} /></View>
        <Text style={shared.muted}>Red/orange/amber/green markers are incidents by priority. Blue markers are on-duty responders.</Text>
      </View>

      <View style={shared.card}>
        <Text style={shared.title}>Incident table</Text>
        <FilterPills label="Status" values={['All', ...STATUSES]} selected={statusFilter} onSelect={setStatusFilter} />
        <FilterPills label="Priority" values={['All', ...PRIORITIES]} selected={priorityFilter} onSelect={setPriorityFilter} />
        <FilterPills label="Category" values={['All', ...INCIDENT_CATEGORIES]} selected={categoryFilter} onSelect={setCategoryFilter} />
        <View style={shared.row}>
          <TextInput style={[shared.input, { flex: 1 }]} placeholder="From date YYYY-MM-DD" value={fromDate} onChangeText={setFromDate} />
          <TextInput style={[shared.input, { flex: 1 }]} placeholder="To date YYYY-MM-DD" value={toDate} onChangeText={setToDate} />
        </View>
        {users === null && <ActivityIndicator color={colors.red} />}
        {freshResponders.length > 0 && <>
          <Text style={shared.heading}>Assign responder</Text>
          <View style={shared.row}>{freshResponders.map((responder) => <Pressable key={responder.id} style={{ ...shared.pill, borderColor: selectedResponder === responder.id ? colors.red : colors.border }} onPress={() => setSelectedResponder(responder.id)}><Text style={shared.pillText}>{responder.name || 'Responder'} · {responder.responderType || 'volunteer'}</Text></Pressable>)}</View>
        </>}
        {incidents === null && <ActivityIndicator color={colors.red} />}
        {incidents && visibleIncidents.length === 0 && <Text style={shared.muted}>No incidents match these filters.</Text>}
        {visibleIncidents.map((item) => (
          <View key={item.id} style={[shared.card, { borderLeftWidth: 6, borderLeftColor: priorityColors[item.priority] || colors.red }]}>
            <Text style={shared.heading}>{item.id} · {item.category || item.type} · {item.priority}</Text>
            <Text style={shared.muted}>{item.status} · {formatted(item.createdAt)}</Text>
            <Text style={shared.muted}>{item.address || item.generalArea || item.nearestLandmark || 'Location address unavailable'}</Text>
            {!!item.description && <Text style={shared.text}>{item.description}</Text>}
            {item.anonymous && <Text style={shared.muted}>Anonymous report</Text>}
            {!readOnly && item.anonymous && <>
              {!identities[item.id] ? <Pressable style={shared.buttonOutline} onPress={() => revealIdentity(item.id)} disabled={busy === `identity-${item.id}`}><Text style={shared.buttonOutlineText}>{busy === `identity-${item.id}` ? 'Loading…' : 'View identity (admin only)'}</Text></Pressable> : <Text style={shared.muted}>Admin identity: {identities[item.id].name} · {identities[item.id].email} · {identities[item.id].phone}</Text>}
            </>}
            {selectedResponder && !['RESOLVED', 'CANCELLED'].includes(item.status) && <Pressable style={shared.buttonOutline} onPress={() => doAssign(item.id)} disabled={busy === `assign-${item.id}`}><Text style={shared.buttonOutlineText}>{busy === `assign-${item.id}` ? 'Assigning…' : `Assign to ${freshResponders.find((responder) => responder.id === selectedResponder)?.name || 'selected responder'}`}</Text></Pressable>}
          </View>
        ))}
      </View>

      <View style={shared.card}>
        <Text style={shared.title}>Response analytics</Text>
        <Text style={shared.text}>Average time to accept: {acceptedAverage === null ? '—' : `${acceptedAverage.toFixed(1)} min`}</Text>
        <Text style={shared.text}>Average time to arrive: {arrivedAverage === null ? '—' : `${arrivedAverage.toFixed(1)} min`}</Text>
        <Text style={shared.text}>Average time to resolve: {resolvedAverage === null ? '—' : `${resolvedAverage.toFixed(1)} min`}</Text>
        <Text style={shared.text}>False-alarm rate: {falseRate}%</Text>
      </View>
      <BarChart title="Incidents by category" rows={categoryRows} />
      <BarChart title="Incidents by hour" rows={hourRows} limit={24} />
      <BarChart title="Top 5 area hotspots (rounded coordinates)" rows={landmarkRows} limit={5} />

      <View style={shared.card}>
        <Text style={shared.title}>Export report</Text>
        <Text style={shared.muted}>The CSV includes incidents visible under the current filters and date range.</Text>
        <Pressable style={shared.button} onPress={exportCsv} accessibilityRole="button"><Text style={shared.buttonText}>{Platform.OS === 'web' ? 'Download CSV' : 'Share CSV'}</Text></Pressable>
      </View>

      {!readOnly && <>
        <View style={shared.card}>
          <Text style={shared.title}>Responder applications</Text>
          {(users || []).filter((user) => user.responderApplication?.status === 'pending').length === 0 && <Text style={shared.muted}>No applications are waiting for review.</Text>}
          {(users || []).filter((user) => user.responderApplication?.status === 'pending').map((user) => (
            <View key={user.id} style={[shared.card, { gap: 6 }]}>
              <Text style={shared.heading}>{user.name || user.email} · {user.responderApplication.type}</Text>
              <Text style={shared.muted}>{user.email}</Text>
              <Text style={shared.text}>{user.responderApplication.note}</Text>
              <View style={shared.row}>
                <Pressable style={[shared.button, { flex: 1 }]} onPress={() => reviewResponder(user.id, 'approve')} disabled={Boolean(busy)}><Text style={shared.buttonText}>Approve and verify</Text></Pressable>
                <Pressable style={[shared.buttonOutline, { flex: 1 }]} onPress={() => reviewResponder(user.id, 'reject')} disabled={Boolean(busy)}><Text style={shared.buttonOutlineText}>Reject</Text></Pressable>
              </View>
            </View>
          ))}
        </View>

        <View style={shared.card}>
          <Text style={shared.title}>Manage accounts</Text>
          <Text style={shared.muted}>Assign user, operator, or admin roles. Responders are verified from their applications above.</Text>
          <TextInput style={shared.input} placeholder="Account email" autoCapitalize="none" keyboardType="email-address" value={userEmail} onChangeText={setUserEmail} />
          <FilterPills label="New role" values={['user', 'operator', 'admin']} selected={newRole} onSelect={setNewRole} />
          <Pressable style={shared.button} onPress={() => setUserRole(userEmail.trim(), newRole)} disabled={!userEmail.trim() || Boolean(busy)} accessibilityRole="button"><Text style={shared.buttonText}>{busy.startsWith('user-') ? 'Updating…' : 'Apply role'}</Text></Pressable>
          {users === null && <ActivityIndicator color={colors.red} />}
          {users && users.map((user) => {
            const role = ROLE_ALIASES[user.role] || user.role;
            return <View key={user.id} style={[shared.card, { gap: 6 }]}>
              <Text style={shared.heading}>{user.name || user.email || user.id}{user.reviewFlag ? ' · REVIEW' : ''}</Text>
              <Text style={shared.muted}>{user.email} · {role}{user.disabled ? ' · deactivated' : ''}{user.verified ? ' · verified responder' : ''}</Text>
              {!!user.reviewFlagReason && <Text style={shared.error}>{user.reviewFlagReason}</Text>}
              {role !== 'admin' && <Pressable style={shared.buttonOutline} onPress={() => setUserRole(user.email, role, !user.disabled)} disabled={Boolean(busy)}><Text style={shared.buttonOutlineText}>{user.disabled ? 'Reactivate account' : 'Deactivate account'}</Text></Pressable>}
              {role !== 'admin' && user.email && <View style={shared.row}>{['user', 'operator', 'admin'].filter((nextRole) => nextRole !== role).map((nextRole) => <Pressable key={nextRole} style={shared.buttonOutline} onPress={() => setUserRole(user.email, nextRole, Boolean(user.disabled))} disabled={Boolean(busy)}><Text style={shared.buttonOutlineText}>Make {nextRole}</Text></Pressable>)}</View>}
            </View>;
          })}
        </View>

        <View style={shared.card}>
          <Text style={shared.title}>Partner directory</Text>
          <Text style={shared.muted}>Add local hospitals, police/fire services, NGOs, and helplines shown alongside map search results.</Text>
          <TextInput style={shared.input} placeholder="Partner name" value={partnerName} onChangeText={setPartnerName} />
          <FilterPills label="Partner type" values={['hospital', 'police', 'fire', 'ngo', 'helpline']} selected={partnerType} onSelect={setPartnerType} />
          <TextInput style={shared.input} placeholder="Phone (optional)" value={partnerPhone} onChangeText={setPartnerPhone} keyboardType="phone-pad" />
          <View style={shared.row}>
            <TextInput style={[shared.input, { flex: 1 }]} placeholder="Latitude" value={partnerLat} onChangeText={setPartnerLat} keyboardType="decimal-pad" />
            <TextInput style={[shared.input, { flex: 1 }]} placeholder="Longitude" value={partnerLng} onChangeText={setPartnerLng} keyboardType="decimal-pad" />
          </View>
          <Pressable style={shared.button} onPress={savePartner} disabled={!partnerName.trim() || !partnerLat || !partnerLng || Boolean(busy)}><Text style={shared.buttonText}>{busy === 'partner' ? 'Saving…' : 'Add partner'}</Text></Pressable>
          {partners.map((partner) => <View key={partner.id} style={shared.row}>
            <Text style={[shared.text, { flex: 1 }]}>{partner.name} · {partner.type}</Text>
            <Pressable style={shared.buttonOutline} onPress={() => removePartner(partner.id)} disabled={Boolean(busy)}><Text style={shared.buttonOutlineText}>Remove</Text></Pressable>
          </View>)}
        </View>

        <View style={shared.card}>
          <Text style={shared.title}>Recent audit history</Text>
          {auditRows.length === 0 && <Text style={shared.muted}>No admin actions recorded yet.</Text>}
          {auditRows.map((row) => <Text key={row.id} style={shared.muted}>{formatted(row.createdAt)} · {row.action} · {row.targetType} {row.targetId}</Text>)}
        </View>
      </>}
    </ScrollView>
  );
}
