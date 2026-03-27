import React, { useState } from 'react';

export interface ChoiceOption {
  label: string;
  description: string;
}

interface Props {
  question: string;
  options: ChoiceOption[];
  onSelect: (label: string) => void;
}

export default function ChoiceCard({ question, options, onSelect }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const handleConfirm = () => {
    if (selected) {
      setConfirmed(true);
      onSelect(selected);
    }
  };

  return (
    <div className="rounded-lg px-4 py-3 my-2 bg-amber-900/30 border border-amber-500/40">
      <div className="text-sm text-amber-300 font-medium mb-3">{question}</div>
      <div className="flex flex-col gap-2">
        {options.map((opt) => {
          const isSelected = selected === opt.label;
          return (
            <button
              key={opt.label}
              disabled={confirmed}
              onClick={() => !confirmed && setSelected(opt.label)}
              className={`text-left rounded-md px-3 py-2 border transition-colors ${
                confirmed
                  ? isSelected
                    ? 'border-amber-400/60 bg-amber-800/40 text-amber-100'
                    : 'border-gray-700/30 bg-gray-800/20 text-gray-500'
                  : isSelected
                    ? 'border-amber-400/60 bg-amber-800/40 text-amber-100'
                    : 'border-gray-600/40 bg-gray-800/30 text-gray-300 hover:border-amber-500/40 hover:bg-amber-900/20'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 ${
                  isSelected
                    ? 'border-amber-400 bg-amber-400'
                    : 'border-gray-500'
                }`}>
                  {isSelected && (
                    <span className="block w-full h-full rounded-full bg-amber-400" />
                  )}
                </span>
                <span className="text-sm font-medium">{opt.label}</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5 ml-5.5 pl-0.5">{opt.description}</div>
            </button>
          );
        })}
      </div>
      {!confirmed && (
        <div className="flex justify-end mt-3">
          <button
            disabled={!selected}
            onClick={handleConfirm}
            className={`px-4 py-1.5 rounded text-xs font-medium transition-colors ${
              selected
                ? 'bg-amber-600 hover:bg-amber-500 text-white'
                : 'bg-gray-700 text-gray-500 cursor-not-allowed'
            }`}
          >
            Select & Continue
          </button>
        </div>
      )}
      {confirmed && (
        <div className="text-xs text-gray-500 mt-2 text-right italic">
          Selected: {selected}
        </div>
      )}
    </div>
  );
}
