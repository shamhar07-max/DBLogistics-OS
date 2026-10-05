# Driver & warehouse mobile (Expo)

Offline-first client. **Status: skeleton** — it is excluded from the root npm workspace (Expo's dependency tree is large) and has not been built or run in this repository's CI yet. The *logic* it relies on is tested: `packages/offline-sync` (queue, dedupe, crash-safety) and the server contract (`POST /device/commands`, covered by `apps/api/test/risks.test.ts`).

```bash
cd apps/logistics-mobile && npm install && EXPO_PUBLIC_API_URL=http://<host>:3001 EXPO_PUBLIC_TENANT_ID=<uuid> EXPO_PUBLIC_DEV_TOKEN=<dev jwt> npx expo start
```
Planned next: assigned-task read model (`GET /device/sync?cursor=`), OIDC login via expo-auth-session, photo/POD upload queue to private storage, device registration.
