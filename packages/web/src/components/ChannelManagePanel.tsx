import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { useLobbyStore } from '../stores/lobby-store';
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

interface Props {
  onClose: () => void;
}

export default function ChannelManagePanel({ onClose }: Props) {
  const [tab, setTab] = useState<'providers' | 'bindings'>('providers');
  const [showAddForm, setShowAddForm] = useState(false);

  const providers = useLobbyStore((s) => s.channelProviders);
  const bindings = useLobbyStore((s) => s.channelBindings);

  useEffect(() => {
    wsListProviders();
    wsListBindings();
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-xl p-6 w-full max-w-lg border border-gray-700 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-gray-100">IM Channels</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 text-xl">
            &times;
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setTab('providers')}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              tab === 'providers'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            Providers ({providers.length})
          </button>
          <button
            onClick={() => setTab('bindings')}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              tab === 'bindings'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            Bindings ({bindings.length})
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2">
          {tab === 'providers' && (
            <>
              {providers.length === 0 && !showAddForm && (
                <p className="text-gray-500 text-sm text-center py-8">
                  No channel providers configured.
                </p>
              )}

              {providers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between bg-gray-800 rounded-lg p-3"
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${p.healthy ? 'bg-green-400' : 'bg-red-400'}`} />
                    <div>
                      <span className="text-gray-100 text-sm font-medium">
                        {p.channelName}
                      </span>
                      <span className="text-gray-500 text-xs ml-2">{p.accountId}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => wsToggleProvider(p.id, !p.enabled)}
                      className={`px-2 py-1 rounded text-xs ${
                        p.enabled
                          ? 'bg-green-900/40 text-green-400 hover:bg-green-900/60'
                          : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                      }`}
                    >
                      {p.enabled ? 'ON' : 'OFF'}
                    </button>
                    <button
                      onClick={() => wsRemoveProvider(p.id)}
                      className="text-red-400 hover:text-red-300 text-xs"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}

              {showAddForm ? (
                <AddProviderForm onDone={() => setShowAddForm(false)} />
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full py-2 border border-dashed border-gray-600 rounded-lg text-gray-400 hover:text-gray-200 hover:border-gray-400 text-sm"
                >
                  + Add Provider
                </button>
              )}
            </>
          )}

          {tab === 'bindings' && (
            <>
              {bindings.length === 0 && (
                <p className="text-gray-500 text-sm text-center py-8">
                  No active channel bindings.
                </p>
              )}

              {bindings.map((b) => (
                <div
                  key={b.identityKey}
                  className="flex items-center justify-between bg-gray-800 rounded-lg p-3"
                >
                  <div>
                    <div className="text-gray-100 text-sm">
                      {b.peerDisplayName ?? b.peerId}
                      <span className="text-gray-500 text-xs ml-2">({b.channelName})</span>
                    </div>
                    <div className="text-gray-500 text-xs mt-0.5">
                      Target: {b.target === 'lobby-manager' ? 'LM' : b.activeSessionId?.slice(0, 8) ?? b.target.slice(0, 8)}
                    </div>
                  </div>
                  <button
                    onClick={() => wsUnbind(b.identityKey)}
                    className="text-gray-400 hover:text-red-400 text-xs"
                  >
                    Unbind
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Per-channel credential field definitions */
const CHANNEL_FIELDS: Record<string, Array<{ key: string; label: string; required: boolean; type: string; placeholder?: string }>> = {
  wecom: [
    { key: 'botId', label: 'Bot ID', required: true, type: 'text', placeholder: 'aibxxxxxxxx' },
    { key: 'secret', label: 'Secret', required: true, type: 'password' },
  ],
  telegram: [
    { key: 'botToken', label: 'Bot Token', required: true, type: 'password', placeholder: '123456:ABC-DEF...' },
    { key: 'webhookUrl', label: 'Webhook URL (optional)', required: false, type: 'text', placeholder: 'https://example.com/webhook/telegram/...' },
    { key: 'webhookSecret', label: 'Webhook Secret (optional)', required: false, type: 'password' },
  ],
};

const CHANNEL_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'wecom', label: 'WeCom (Enterprise WeChat)' },
  { value: 'telegram', label: 'Telegram' },
];

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
