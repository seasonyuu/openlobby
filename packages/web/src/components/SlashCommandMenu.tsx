import React, { useEffect, useRef } from 'react';

export interface SlashCommand {
  name: string;
  description: string;
  args?: string;
}

// Claude Code CLI built-in commands (all passed through to CLI)
const CLI_COMMANDS: SlashCommand[] = [
  { name: '/compact', description: 'Compact conversation to save context', args: '[instructions]' },
  { name: '/cost', description: 'Show token usage and cost for this session' },
  { name: '/model', description: 'Switch the AI model', args: '<model-name>' },
  { name: '/permissions', description: 'View or update permission rules' },
  { name: '/memory', description: 'Edit CLAUDE.md memory files' },
  { name: '/config', description: 'View or modify settings' },
  { name: '/login', description: 'Switch authentication account' },
  { name: '/logout', description: 'Log out of current account' },
  { name: '/status', description: 'Show account and session status' },
  { name: '/doctor', description: 'Check health of Claude Code' },
  { name: '/review', description: 'Review code changes' },
  { name: '/plan', description: 'Toggle plan mode (read-only exploration)' },
  { name: '/vim', description: 'Toggle vim keybinding mode' },
  { name: '/fast', description: 'Toggle fast mode (same model, faster output)' },
  { name: '/hooks', description: 'Manage event hooks' },
  { name: '/mcp', description: 'Manage MCP servers' },
  { name: '/add-dir', description: 'Add directory to tool access', args: '<path>' },
  { name: '/init', description: 'Initialize CLAUDE.md in project' },
  { name: '/terminal-setup', description: 'Install shell integration (Shift+Enter)' },
  { name: '/help', description: 'Show Claude Code help' },
];

export const SLASH_COMMANDS: SlashCommand[] = CLI_COMMANDS;

interface Props {
  filter: string;
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
}

export function filterCommands(input: string): SlashCommand[] {
  const query = input.toLowerCase();
  if (!query) return SLASH_COMMANDS;
  return SLASH_COMMANDS.filter(
    (cmd) =>
      cmd.name.toLowerCase().includes(query) ||
      cmd.description.toLowerCase().includes(query),
  );
}

export default function SlashCommandMenu({ filter, selectedIndex, onSelect }: Props) {
  const commands = filterCommands(filter);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (commands.length === 0) return null;

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-h-72 overflow-y-auto z-50"
    >
      {commands.map((cmd, i) => (
        <button
          key={cmd.name}
          className={`w-full text-left px-3 py-1.5 flex items-center gap-2 text-sm transition-colors ${
            i === selectedIndex
              ? 'bg-blue-600/30 text-white'
              : 'text-gray-300 hover:bg-gray-800'
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(cmd);
          }}
        >
          <span className="font-mono text-blue-400 font-medium w-28 shrink-0 text-xs">
            {cmd.name}
          </span>
          <span className="text-gray-400 text-xs truncate flex-1">
            {cmd.description}
          </span>
          {cmd.args && (
            <span className="text-[10px] text-gray-600 font-mono shrink-0">{cmd.args}</span>
          )}
        </button>
      ))}
    </div>
  );
}
