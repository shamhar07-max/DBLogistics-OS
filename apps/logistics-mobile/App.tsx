import { useEffect, useMemo, useState } from 'react';
import { Button, FlatList, SafeAreaView, Text, TextInput, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { OfflineQueue, type SyncTransport } from '@dbl/offline-sync';
import { SqliteStore } from './src/sqlite-store';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
/** Transport: POST /api/v1/device/commands. Token/tenant come from expo-auth-session + secure store (wiring TODO per deployment). */
const transport = (token: () => string, tenant: string): SyncTransport => ({
  async send(deviceId, commands) {
    const r = await fetch(`${API}/api/v1/device/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}`, 'X-Tenant-Id': tenant }, body: JSON.stringify({ deviceId, commands }) });
    if (!r.ok) throw new Error(`sync ${r.status}`); return (await r.json()).results;
  },
});
export default function App() {
  const [perm, ask] = useCameraPermissions(); const [stop, setStop] = useState(''); const [signed, setSigned] = useState(''); const [pending, setPending] = useState(0); const [conflicts, setConflicts] = useState<string[]>([]);
  const q = useMemo(() => new OfflineQueue(new SqliteStore(), transport(() => process.env.EXPO_PUBLIC_DEV_TOKEN ?? '', process.env.EXPO_PUBLIC_TENANT_ID ?? ''), 'device-local'), []);
  const refresh = async () => { setPending((await q.pending()).length); setConflicts((await q.conflicts()).map((c) => `${c.type}: ${c.lastError ?? c.status}`)); };
  useEffect(() => { refresh(); const t = setInterval(() => q.flush().then(refresh), 15000); return () => clearInterval(t); }, []);
  return (
    <SafeAreaView style={{ flex: 1, padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: '700' }}>Driver · proof of delivery</Text>
      <Text>Queued offline: {pending} · Needs attention: {conflicts.length}</Text>
      {perm?.granted ? <CameraView style={{ height: 160 }} barcodeScannerSettings={{ barcodeTypes: ['code128', 'qr'] }} onBarcodeScanned={({ data }) => { q.enqueue('scan_count', { barcode: data, qty: 1 }).then(refresh); }} /> : <Button title="Allow camera for scanning" onPress={ask} />}
      <TextInput placeholder="Trip stop id" value={stop} onChangeText={setStop} style={{ borderWidth: 1, padding: 10 }} />
      <TextInput placeholder="Receiver name" value={signed} onChangeText={setSigned} style={{ borderWidth: 1, padding: 10 }} />
      <Button title="Capture POD (works offline)" disabled={!stop || !signed} onPress={() => q.enqueue('capture_pod', { tripStopId: stop, signedBy: signed }).then(refresh)} />
      <Text style={{ fontSize: 12 }}>Evidence is saved on the device first. Delivery completion is validated online by the server.</Text>
      <FlatList data={conflicts} keyExtractor={(x, i) => x + i} renderItem={({ item }) => <View><Text style={{ color: '#A80000' }}>{item}</Text></View>} />
    </SafeAreaView>
  );
}
