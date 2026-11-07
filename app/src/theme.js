import { StyleSheet } from 'react-native';

export const colors = {
  red: '#D32F2F',
  redDark: '#B71C1C',
  white: '#FFFFFF',
  bg: '#FFF5F5',
  text: '#1B1B1B',
  muted: '#6B6B6B',
  border: '#F0CFCF',
  blue: '#1565C0',
  green: '#2E7D32',
};

export const priorityColors = {
  Critical: '#D32F2F',
  High: '#F57C00',
  Medium: '#FFB300',
  Low: '#388E3C',
};

export const statusColors = {
  ACTIVE: '#D32F2F',
  ASSIGNED: '#1565C0',
  EN_ROUTE: '#6A1B9A',
  ARRIVED: '#00838F',
  RESOLVED: '#2E7D32',
  CANCELLED: '#6B6B6B',
  ESCALATED: '#F57C00',
};

export const markerColors = {
  user: '#111111',
  hospital: '#D32F2F',
  police: '#1565C0',
  nearest: '#2E7D32',
};

export const shared = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 16, gap: 12 },
  card: {
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 6,
  },
  title: { fontSize: 20, fontWeight: '700', color: colors.text },
  heading: { fontSize: 16, fontWeight: '700', color: colors.text },
  text: { fontSize: 16, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
  error: { fontSize: 14, color: colors.redDark, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  button: {
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.red,
  },
  buttonText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  buttonOutline: {
    minHeight: 48,
    borderRadius: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.red,
    backgroundColor: colors.white,
  },
  buttonOutlineText: { color: colors.red, fontSize: 16, fontWeight: '700' },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.white,
  },
  pill: {
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  pillText: { fontSize: 14, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
});
