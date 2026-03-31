import React from 'react';
import { useLobbyStore } from '../stores/lobby-store';
import { wsSetAdapterDefault } from '../hooks/useWebSocket';

interface Props {
  onClose: () => void;
}

export default function GlobalSettingsDialog({ onClose }: Props) {
  const adapterDefaults = useLobbyStore((s) => s.adapterDefaults);
  const adapterMeta = useLobbyStore((s) => s.adapterPermissionMeta);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 rounded-xl p-6 w-full max-w-md border border-gray-700"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold mb-5 text-gray-100">Global Settings</h2>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-300">Default Permission Mode per Adapter</h3>
          {adapterDefaults.map((def) => {
            const meta = adapterMeta[def.adapterName];
            return (
              <div key={def.adapterName}>
                <label className="block text-sm text-gray-400 mb-1">{def.displayName}</label>
                <select
                  value={def.permissionMode}
                  onChange={(e) => wsSetAdapterDefault(def.adapterName, e.target.value)}
                  className="w-full bg-gray-800 text-gray-100 rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {(['auto', 'supervised', 'readonly'] as const).map((mode) => {
                    const native = meta?.modeLabels?.[mode] ?? '';
                    const label = mode.charAt(0).toUpperCase() + mode.slice(1);
                    return (
                      <option key={mode} value={mode}>
                        {label}{native ? ` (${native})` : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            );
          })}
        </div>

        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 rounded-lg hover:bg-gray-800"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
