import React from 'react';
import type { ControlRequestData } from '../stores/lobby-store';

interface Props {
  request: ControlRequestData;
  onRespond: (requestId: string, decision: 'allow' | 'deny') => void;
}

export default function ControlCard({ request, onRespond }: Props) {
  return (
    <div className="rounded-lg px-4 py-3 mb-2 bg-orange-900/40 border border-orange-500/50">
      <div className="flex items-center justify-between mb-2">
        <div>
          <span className="text-xs text-orange-400 font-semibold">APPROVAL REQUIRED</span>
          <span className="text-orange-300 font-mono font-bold text-sm ml-2">{request.toolName}</span>
        </div>
        <div className="flex gap-2">
          <button
            className="px-3 py-1 rounded bg-green-700 hover:bg-green-600 text-white text-xs font-medium transition-colors"
            onClick={() => onRespond(request.requestId, 'allow')}
          >
            Allow
          </button>
          <button
            className="px-3 py-1 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors"
            onClick={() => onRespond(request.requestId, 'deny')}
          >
            Deny
          </button>
        </div>
      </div>
      <pre className="text-gray-300 text-xs overflow-auto max-h-40 p-2 bg-gray-900/50 rounded font-mono">
        {JSON.stringify(request.toolInput, null, 2)}
      </pre>
    </div>
  );
}
