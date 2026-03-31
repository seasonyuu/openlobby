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
    default: return 3;
  }
}

export async function startWeComQrFlow(
  onStatus: (status: WeComQrStatus) => void,
  signal: AbortSignal,
): Promise<void> {
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

  onStatus({ status: 'waiting', qrUrl: authUrl });

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

      if (!res.ok) continue;

      const data = await res.json();
      const status = data.status ?? data.data?.status;

      if (status === 'success' || status === 'authorized') {
        const botId = data.bot_id ?? data.data?.bot_id;
        const botSecret = data.bot_secret ?? data.data?.bot_secret;

        if (!botId || !botSecret) {
          onStatus({ status: 'error', error: 'Scan succeeded but credentials missing from response' });
          return;
        }

        const verified = await verifyCredentials(botId, botSecret, signal);
        if (signal.aborted) return;

        if (verified) {
          onStatus({ status: 'success', botId, secret: botSecret });
        } else {
          onStatus({ status: 'error', error: 'Credential verification failed' });
        }
        return;
      }
    } catch (err) {
      if (signal.aborted) return;
      console.warn('[WeComQR] Poll error (will retry):', err instanceof Error ? err.message : err);
    }
  }
}

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
    return data.errcode === 0 || data.errcode === undefined;
  } catch {
    return false;
  }
}
