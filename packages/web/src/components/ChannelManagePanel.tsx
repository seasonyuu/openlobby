import React, { useState, useEffect } from 'react';
import { useLobbyStore } from '../stores/lobby-store';
import {
  wsListProviders,
  wsAddProvider,
  wsRemoveProvider,
  wsToggleProvider,
  wsListBindings,
  wsUnbind,
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

function AddProviderForm({ onDone }: { onDone: () => void }) {
  const [channelName, setChannelName] = useState('wecom');
  const [accountId, setAccountId] = useState('');
  const [botId, setBotId] = useState('');
  const [secret, setSecret] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId.trim() || !botId.trim() || !secret.trim()) return;

    wsAddProvider({
      channelName,
      accountId: accountId.trim(),
      credentials: {
        botId: botId.trim(),
        secret: secret.trim(),
      },
      enabled: true,
    });
    onDone();
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 rounded-lg p-4 space-y-3">
      <div>
        <label className="block text-xs text-gray-400 mb-1">Channel Type</label>
        <select
          value={channelName}
          onChange={(e) => setChannelName(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100"
        >
          <option value="wecom">WeCom (Enterprise WeChat)</option>
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

      <div>
        <label className="block text-xs text-gray-400 mb-1">Bot ID</label>
        <input
          type="text"
          value={botId}
          onChange={(e) => setBotId(e.target.value)}
          placeholder="aibxxxxxxxx"
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-400 mb-1">Secret</label>
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-100"
        />
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onDone}
          className="px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-500"
        >
          Add
        </button>
      </div>
    </form>
  );
}
