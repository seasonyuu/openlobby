# WeCom QR Code Scan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a QR code scanning flow to add WeCom bots — backend generates QR via WeCom API, polls for scan result, frontend displays QR and auto-adds the provider on success.

**Architecture:** New `wecom-qr.ts` server module handles WeCom API calls (generate QR, poll result, verify credentials). WebSocket handler pipes status updates to frontend. Frontend `ChannelManagePanel` adds QR scan mode as default for WeCom, with manual input as fallback. Also fixes credential field mismatch (`corpId`/`agentId` → `botId`/`secret`).

**Tech Stack:** TypeScript, native `fetch` + `crypto`, WebSocket, React, `qrcode` npm package

---

### Task 1: Add WebSocket Protocol Types

**Files:**
- Modify: `packages/core/src/protocol.ts`

- [ ] **Step 1: Add new message types to ClientMessage and ServerMessage**

In `packages/core/src/protocol.ts`, add to the `ClientMessage` union (before the closing semicolon):

```typescript
  | { type: 'wecom.qr-start' }
  | { type: 'wecom.qr-cancel' }
```

Add to the `ServerMessage` union:

```typescript
  | { type: 'wecom.qr-status'; status: 'generating' | 'waiting' | 'success' | 'expired' | 'error'; qrUrl?: string; botId?: string; secret?: string; error?: string }
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/protocol.ts
git commit -m "feat(core): add wecom.qr-start/cancel/status WebSocket message types"
```

---

### Task 2: Create Backend wecom-qr.ts Module

**Files:**
- Create: `packages/server/src/channels/wecom-qr.ts`

- [ ] **Step 1: Create the wecom-qr.ts module**

Create `packages/server/src/channels/wecom-qr.ts`:

```typescript
import { createHash, randomBytes } from 'node:crypto';

/** Status updates pushed to the WebSocket client */
export interface WeComQrStatus {
  status: 'generating' | 'waiting' | 'success' | 'expired' | 'error';
  qrUrl?: string;
  botId?: string;
  secret?: string;
  error?: string;
}

const QR_GENERATE_URL = 'https://work.weixin.qq.com/ai/qc/generate';
const QR_QUERY_URL = 'https://work.weixin.qq.com/ai/qc/query_result';
const VERIFY_URL = 'https://qyapi.weixin.qq.com/cgi-bin/aibot/cli/get_mcp_config';

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function getPlatformType(): number {
  switch (process.platform) {
    case 'darwin': return 1;
    case 'win32': return 2;
    default: return 3; // linux and others
  }
}

/**
 * Run the WeCom QR code scanning flow.
 *
 * 1. Generate QR code via WeCom API
 * 2. Poll for scan result every 3s (up to 5 min)
 * 3. Verify credentials on success
 *
 * @param onStatus - callback to push status updates to the client
 * @param signal - AbortSignal to cancel the flow
 */
export async function startWeComQrFlow(
  onStatus: (status: WeComQrStatus) => void,
  signal: AbortSignal,
): Promise<void> {
  // Step 1: Generate QR code
  onStatus({ status: 'generating' });

  let scode: string;
  let authUrl: string;

  try {
    const res = await fetch(QR_GENERATE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'wecom_cli_external',
        type: getPlatformType(),
      }),
      signal,
    });

    if (!res.ok) {
      onStatus({ status: 'error', error: `QR generate failed: HTTP ${res.status}` });
      return;
    }

    const data = await res.json();
    scode = data.scode ?? data.data?.scode;
    authUrl = data.auth_url ?? data.data?.auth_url;

    if (!scode || !authUrl) {
      onStatus({ status: 'error', error: 'QR generate returned invalid response' });
      return;
    }
  } catch (err) {
    if (signal.aborted) return;
    onStatus({ status: 'error', error: `QR generate failed: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }

  // Step 2: Push QR URL to client
  onStatus({ status: 'waiting', qrUrl: authUrl });

  // Step 3: Poll for scan result
  const startTime = Date.now();

  while (!signal.aborted) {
    if (Date.now() - startTime > POLL_TIMEOUT_MS) {
      onStatus({ status: 'expired' });
      return;
    }

    await new Promise((resolve) => {
      const timer = setTimeout(resolve, POLL_INTERVAL_MS);
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve(undefined); }, { once: true });
    });

    if (signal.aborted) return;

    try {
      const res = await fetch(`${QR_QUERY_URL}?scode=${encodeURIComponent(scode)}`, { signal });

      if (!res.ok) continue; // retry on transient errors

      const data = await res.json();
      const status = data.status ?? data.data?.status;

      if (status === 'success' || status === 'authorized') {
        const botId = data.bot_id ?? data.data?.bot_id;
        const botSecret = data.bot_secret ?? data.data?.bot_secret;

        if (!botId || !botSecret) {
          onStatus({ status: 'error', error: 'Scan succeeded but credentials missing from response' });
          return;
        }

        // Step 4: Verify credentials
        const verified = await verifyCredentials(botId, botSecret, signal);
        if (signal.aborted) return;

        if (verified) {
          onStatus({ status: 'success', botId, secret: botSecret });
        } else {
          onStatus({ status: 'error', error: 'Credential verification failed' });
        }
        return;
      }

      // Not yet scanned — continue polling
    } catch (err) {
      if (signal.aborted) return;
      // Transient network error — continue polling
      console.warn('[WeComQR] Poll error (will retry):', err instanceof Error ? err.message : err);
    }
  }
}

/**
 * Verify bot credentials via WeCom MCP config endpoint.
 * Uses SHA-256 signature: hash = SHA256(secret + bot_id + timestamp + nonce)
 */
async function verifyCredentials(
  botId: string,
  secret: string,
  signal: AbortSignal,
): Promise<boolean> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomBytes(16).toString('hex');
  const hash = createHash('sha256')
    .update(secret + botId + timestamp + nonce)
    .digest('hex');

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bot_id: botId,
        timestamp,
        nonce,
        hash,
      }),
      signal,
    });

    if (!res.ok) return false;

    const data = await res.json();
    // errcode 0 means success
    return data.errcode === 0 || data.errcode === undefined;
  } catch {
    return false;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/channels/wecom-qr.ts
git commit -m "feat(server): add wecom-qr module for QR code scanning flow"
```

---

### Task 3: Add WebSocket Handler Integration

**Files:**
- Modify: `packages/server/src/ws-handler.ts`

- [ ] **Step 1: Add QR flow state tracking and handlers**

In `packages/server/src/ws-handler.ts`, add an import at the top:

```typescript
import { startWeComQrFlow } from './channels/wecom-qr.js';
```

Inside the `handleWebSocket` function, right after the `const listenerId = ...` line, add a variable to track the active QR flow:

```typescript
  let activeQrAbort: AbortController | null = null;
```

Inside the `switch (data.type)` block, before the `default:` case, add:

```typescript
        case 'wecom.qr-start': {
          // Cancel any existing QR flow for this connection
          if (activeQrAbort) {
            activeQrAbort.abort();
            activeQrAbort = null;
          }

          const abort = new AbortController();
          activeQrAbort = abort;

          startWeComQrFlow(
            (status) => {
              send({
                type: 'wecom.qr-status',
                ...status,
              } as any);
            },
            abort.signal,
          ).finally(() => {
            if (activeQrAbort === abort) {
              activeQrAbort = null;
            }
          });
          break;
        }

        case 'wecom.qr-cancel': {
          if (activeQrAbort) {
            activeQrAbort.abort();
            activeQrAbort = null;
          }
          break;
        }
```

In the `socket.on('close', ...)` handler, add cleanup:

```typescript
    // Abort any active QR flow
    if (activeQrAbort) {
      activeQrAbort.abort();
      activeQrAbort = null;
    }
```

- [ ] **Step 2: Commit**

```bash
git add packages/server/src/ws-handler.ts
git commit -m "feat(server): add wecom.qr-start/cancel WebSocket handlers"
```

---

### Task 4: Install qrcode Package

**Files:**
- Modify: `packages/web/package.json`

- [ ] **Step 1: Install qrcode dependency**

```bash
cd /Users/kone/OtherProjects/mist/OpenLobby
pnpm --filter @openlobby/web add qrcode @types/qrcode
```

- [ ] **Step 2: Commit**

```bash
git add packages/web/package.json pnpm-lock.yaml
git commit -m "deps(web): add qrcode package for QR code rendering"
```

---

### Task 5: Add Frontend WebSocket Helpers and Message Handler

**Files:**
- Modify: `packages/web/src/hooks/useWebSocket.ts`
- Modify: `packages/web/src/stores/lobby-store.ts`

- [ ] **Step 1: Add QR status state to lobby-store**

In `packages/web/src/stores/lobby-store.ts`, add to the `LobbyState` interface:

```typescript
  // WeCom QR scan state
  wecomQrStatus: null | {
    status: 'generating' | 'waiting' | 'success' | 'expired' | 'error';
    qrUrl?: string;
    botId?: string;
    secret?: string;
    error?: string;
  };
  setWecomQrStatus: (status: LobbyState['wecomQrStatus']) => void;
```

Add initial state and setter in the `create` call:

```typescript
  wecomQrStatus: null,
  setWecomQrStatus: (status) => set({ wecomQrStatus: status }),
```

- [ ] **Step 2: Add message handler in useWebSocket.ts**

In the `onmessage` switch block of `useWebSocketInit`, add:

```typescript
      case 'wecom.qr-status': {
        const { status, qrUrl, botId, secret, error } = data as any;
        state.setWecomQrStatus({ status, qrUrl, botId, secret, error });
        break;
      }
```

Add send helpers at the bottom of the file (near other channel helpers):

```typescript
export function wsWecomQrStart(): void {
  wsSend({ type: 'wecom.qr-start' });
}

export function wsWecomQrCancel(): void {
  wsSend({ type: 'wecom.qr-cancel' });
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/stores/lobby-store.ts packages/web/src/hooks/useWebSocket.ts
git commit -m "feat(web): add WeCom QR status state and WebSocket helpers"
```

---

### Task 6: Update ChannelManagePanel — Fix Credential Fields and Add QR Scan UI

**Files:**
- Modify: `packages/web/src/components/ChannelManagePanel.tsx`

- [ ] **Step 1: Fix CHANNEL_FIELDS for WeCom**

Replace the wecom entry in `CHANNEL_FIELDS` (lines 162-166):

```typescript
  wecom: [
    { key: 'botId', label: 'Bot ID', required: true, type: 'text', placeholder: 'aibxxxxxxxx' },
    { key: 'secret', label: 'Secret', required: true, type: 'password' },
  ],
```

- [ ] **Step 2: Add QR scan mode to AddProviderForm**

Add imports at the top:

```typescript
import QRCode from 'qrcode';
import {
  wsListProviders,
  wsAddProvider,
  wsRemoveProvider,
  wsToggleProvider,
  wsListBindings,
  wsUnbind,
  wsWecomQrStart,
  wsWecomQrCancel,
} from '../hooks/useWebSocket';
```

Replace the entire `AddProviderForm` component with:

```typescript
function AddProviderForm({ onDone }: { onDone: () => void }) {
  const [channelName, setChannelName] = useState('wecom');
  const [accountId, setAccountId] = useState('');
  const [credentials, setCredentials] = useState<Record<string, string>>({});
  const [manualMode, setManualMode] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const qrStatus = useLobbyStore((s) => s.wecomQrStatus);
  const setQrStatus = useLobbyStore((s) => s.setWecomQrStatus);

  const fields = CHANNEL_FIELDS[channelName] ?? [];
  const isWecom = channelName === 'wecom';

  // Generate QR data URL when qrUrl arrives
  useEffect(() => {
    if (qrStatus?.status === 'waiting' && qrStatus.qrUrl) {
      QRCode.toDataURL(qrStatus.qrUrl, { width: 256, margin: 2 })
        .then(setQrDataUrl)
        .catch(() => setQrDataUrl(null));
    } else {
      setQrDataUrl(null);
    }
  }, [qrStatus?.status, qrStatus?.qrUrl]);

  // Auto-add provider on scan success
  useEffect(() => {
    if (qrStatus?.status === 'success' && qrStatus.botId && qrStatus.secret && accountId.trim()) {
      wsAddProvider({
        channelName: 'wecom',
        accountId: accountId.trim(),
        credentials: { botId: qrStatus.botId, secret: qrStatus.secret },
        enabled: true,
      });
      setQrStatus(null);
      onDone();
    }
  }, [qrStatus?.status, qrStatus?.botId, qrStatus?.secret, accountId, onDone, setQrStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      wsWecomQrCancel();
      setQrStatus(null);
    };
  }, [setQrStatus]);

  const updateCredential = (key: string, value: string) => {
    setCredentials((prev) => ({ ...prev, [key]: value }));
  };

  const handleChannelChange = (name: string) => {
    setChannelName(name);
    setCredentials({});
    setAccountId('');
    setManualMode(false);
    wsWecomQrCancel();
    setQrStatus(null);
  };

  const isManualValid = () => {
    if (!accountId.trim()) return false;
    return fields.filter((f) => f.required).every((f) => credentials[f.key]?.trim());
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isManualValid()) return;

    const creds: Record<string, string> = {};
    for (const field of fields) {
      const val = credentials[field.key]?.trim();
      if (val) creds[field.key] = val;
    }

    wsAddProvider({
      channelName,
      accountId: accountId.trim(),
      credentials: creds,
      enabled: true,
    });
    onDone();
  };

  const handleStartQr = () => {
    if (!accountId.trim()) return;
    setQrStatus(null);
    wsWecomQrStart();
  };

  // QR Scan Mode UI (WeCom only, non-manual)
  if (isWecom && !manualMode) {
    return (
      <div className="bg-gray-800 rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-300 font-medium">Add WeCom Bot (Scan)</span>
          <button onClick={onDone} className="text-gray-400 hover:text-gray-200 text-xs">Cancel</button>
        </div>

        <div>
          <label className="block text-xs text-gray-400 mb-1">Account ID</label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="e.g. my-bot-1"
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100"
          />
        </div>

        {/* QR Code Display Area */}
        <div className="flex flex-col items-center py-3 space-y-2">
          {!qrStatus && (
            <button
              onClick={handleStartQr}
              disabled={!accountId.trim()}
              className={`px-4 py-2 rounded-lg text-sm ${
                accountId.trim()
                  ? 'bg-blue-600 text-white hover:bg-blue-500'
                  : 'bg-gray-700 text-gray-500 cursor-not-allowed'
              }`}
            >
              Generate QR Code
            </button>
          )}

          {qrStatus?.status === 'generating' && (
            <p className="text-gray-400 text-sm">Generating QR code...</p>
          )}

          {qrStatus?.status === 'waiting' && qrDataUrl && (
            <>
              <img src={qrDataUrl} alt="WeCom QR Code" className="w-48 h-48 rounded-lg" />
              <p className="text-gray-400 text-xs">Scan with WeCom app</p>
            </>
          )}

          {qrStatus?.status === 'expired' && (
            <div className="text-center space-y-2">
              <p className="text-yellow-400 text-sm">QR code expired</p>
              <button
                onClick={handleStartQr}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-500"
              >
                Regenerate
              </button>
            </div>
          )}

          {qrStatus?.status === 'error' && (
            <div className="text-center space-y-2">
              <p className="text-red-400 text-sm">{qrStatus.error ?? 'Unknown error'}</p>
              <button
                onClick={handleStartQr}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-500"
              >
                Retry
              </button>
            </div>
          )}

          {qrStatus?.status === 'success' && (
            <p className="text-green-400 text-sm">Scan successful! Adding provider...</p>
          )}
        </div>

        {/* Manual input toggle */}
        <div className="text-center">
          <button
            onClick={() => { setManualMode(true); wsWecomQrCancel(); setQrStatus(null); }}
            className="text-xs text-gray-500 hover:text-gray-300 underline"
          >
            Manual input (botId + secret)
          </button>
        </div>
      </div>
    );
  }

  // Manual Mode (existing form, also used for non-WeCom channels)
  return (
    <form onSubmit={handleManualSubmit} className="bg-gray-800 rounded-lg p-4 space-y-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Channel Type</label>
        <select
          value={channelName}
          onChange={(e) => handleChannelChange(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100"
        >
          {CHANNEL_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Account ID</label>
        <input
          type="text"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder="e.g. my-bot-1"
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100"
        />
      </div>

      {fields.map((field) => (
        <div key={field.key}>
          <label className="block text-xs text-gray-400 mb-1">{field.label}</label>
          <input
            type={field.type}
            value={credentials[field.key] ?? ''}
            onChange={(e) => updateCredential(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100"
          />
        </div>
      ))}

      <div className="flex gap-2 justify-end items-center">
        {isWecom && (
          <button
            type="button"
            onClick={() => { setManualMode(false); }}
            className="text-xs text-gray-500 hover:text-gray-300 underline mr-auto"
          >
            Back to QR scan
          </button>
        )}
        <button
          type="button"
          onClick={onDone}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!isManualValid()}
          className={`px-3 py-1.5 rounded text-sm ${
            isManualValid()
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-gray-700 text-gray-500 cursor-not-allowed'
          }`}
        >
          Add
        </button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/ChannelManagePanel.tsx
git commit -m "feat(web): add WeCom QR scan mode and fix credential fields"
```

---

### Task 7: Build and Verify

**Files:** None (verification only)

- [ ] **Step 1: Build all packages**

```bash
cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm -r build
```

Expected: All packages build with no errors.

- [ ] **Step 2: Fix any build errors**

Common issues:
- Missing `qrcode` types — ensure `@types/qrcode` was installed
- Import path issues in `ws-handler.ts` — ensure `.js` extension for ESM

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues from WeCom QR scan feature"
```
