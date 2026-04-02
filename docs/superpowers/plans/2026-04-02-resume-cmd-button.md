# Resume Cmd Button Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize the Resume Cmd button with icon-based design, clipboard feedback, and cross-platform fallback.

**Architecture:** Extract a universal `copyToClipboard()` utility with three-level degradation (Clipboard API → execCommand → return false). Redesign the Resume Cmd button as a clipboard icon with tooltip and checkmark feedback. Upgrade both `CopyButton` instances to use the shared utility with fallback popover.

**Tech Stack:** React, TypeScript, Tailwind CSS

---

### Task 1: Create `copyToClipboard` utility

**Files:**
- Create: `packages/web/src/utils/clipboard.ts`

- [ ] **Step 1: Create the utils directory and clipboard utility**

```ts
// packages/web/src/utils/clipboard.ts

/**
 * Copy text to clipboard with three-level degradation:
 * 1. navigator.clipboard.writeText (modern browsers + HTTPS/localhost)
 * 2. document.execCommand('copy') (legacy fallback)
 * 3. Returns false — caller shows fallback UI for manual copy
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Level 1: Clipboard API
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to level 2
    }
  }

  // Level 2: execCommand fallback
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (ok) return true;
  } catch {
    // fall through to level 3
  }

  // Level 3: caller handles fallback UI
  return false;
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && npx tsc --noEmit --project packages/web/tsconfig.json 2>&1 | head -20`
Expected: No errors related to `clipboard.ts`

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/utils/clipboard.ts
git commit -m "feat(web): add copyToClipboard utility with three-level degradation"
```

---

### Task 2: Redesign Resume Cmd button as clipboard icon with feedback

**Files:**
- Modify: `packages/web/src/components/RoomHeader.tsx:1-3,36-58,122-147`

- [ ] **Step 1: Add import for `copyToClipboard`**

At the top of `RoomHeader.tsx`, add the import:

```ts
import { copyToClipboard } from '../utils/clipboard';
```

- [ ] **Step 2: Add state variables for the Resume Cmd button**

Inside the `RoomHeader` component, after the existing `const [messageMode, setMessageMode] = useState('');` (line 40), add:

```ts
const [resumeCopied, setResumeCopied] = useState(false);
const [resumeFallback, setResumeFallback] = useState(false);
```

- [ ] **Step 3: Replace `handleCopyResumeCmd` with async version**

Replace lines 54-58 (the existing `handleCopyResumeCmd` function) with:

```ts
const handleCopyResumeCmd = async () => {
  if (!session.resumeCommand) return;
  const ok = await copyToClipboard(session.resumeCommand);
  if (ok) {
    setResumeCopied(true);
    setTimeout(() => setResumeCopied(false), 1500);
  } else {
    setResumeFallback(true);
  }
};
```

- [ ] **Step 4: Replace the Resume Cmd button markup**

Replace lines 139-147 (the existing Resume Cmd button block) with the new icon button + fallback popover:

```tsx
{session.resumeCommand && (
  <div className="relative">
    <button
      onClick={handleCopyResumeCmd}
      title={`Copy: ${session.resumeCommand}`}
      className="p-1.5 rounded hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors"
    >
      {resumeCopied ? (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
          <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
        </svg>
      )}
    </button>
    {resumeFallback && (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setResumeFallback(false)} />
        <div className="absolute top-full right-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 min-w-[280px]">
          <p className="text-xs text-gray-400 mb-1.5">Copy failed. Select and copy manually:</p>
          <code className="block text-xs text-gray-200 bg-gray-900 rounded px-2 py-1.5 select-all break-all">
            {session.resumeCommand}
          </code>
        </div>
      </>
    )}
  </div>
)}
```

- [ ] **Step 5: Verify it compiles**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && npx tsc --noEmit --project packages/web/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/RoomHeader.tsx
git commit -m "feat(web): redesign Resume Cmd as icon button with clipboard feedback and fallback popover"
```

---

### Task 3: Upgrade `CopyButton` in RoomHeader to use `copyToClipboard`

**Files:**
- Modify: `packages/web/src/components/RoomHeader.tsx:5-23`

- [ ] **Step 1: Replace the `CopyButton` component**

Replace the existing `CopyButton` component (lines 5-23) with the upgraded version that uses `copyToClipboard` and includes a fallback popover:

```tsx
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const [fallbackText, setFallbackText] = useState<string | null>(null);

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setFallbackText(null);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setFallbackText(text);
    }
  };

  return (
    <div className="relative flex items-center justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <button
        onClick={handleCopy}
        className="text-gray-300 hover:text-white font-mono truncate max-w-[200px] ml-2"
        title={text}
      >
        {copied ? 'Copied!' : text}
      </button>
      {fallbackText && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setFallbackText(null)} />
          <div className="absolute top-full right-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 min-w-[240px]">
            <p className="text-xs text-gray-400 mb-1.5">Copy failed. Select and copy manually:</p>
            <code className="block text-xs text-gray-200 bg-gray-900 rounded px-2 py-1.5 select-all break-all">
              {fallbackText}
            </code>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && npx tsc --noEmit --project packages/web/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/web/src/components/RoomHeader.tsx
git commit -m "feat(web): upgrade RoomHeader CopyButton with clipboard fallback"
```

---

### Task 4: Upgrade `CopyButton` in MessageBubble to use `copyToClipboard`

**Files:**
- Modify: `packages/web/src/components/MessageBubble.tsx:1-48`

- [ ] **Step 1: Add import for `copyToClipboard`**

At the top of `MessageBubble.tsx`, after the existing imports (line 6), add:

```ts
import { copyToClipboard } from '../utils/clipboard';
```

- [ ] **Step 2: Replace the `CopyButton` component**

Replace the existing `CopyButton` component (lines 34-48) with the upgraded version:

```tsx
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(true);
      setShowFallback(false);
      setTimeout(() => setCopied(false), 1500);
    } else {
      setShowFallback(true);
    }
  };

  return (
    <div className="relative inline-block">
      <button
        onClick={handleCopy}
        className="text-[10px] text-gray-500 hover:text-gray-300 px-1.5 py-0.5 rounded hover:bg-gray-700 transition-colors"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      {showFallback && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowFallback(false)} />
          <div className="absolute top-full right-0 mt-1 z-50 bg-gray-800 border border-gray-600 rounded-lg shadow-xl p-3 min-w-[240px] max-w-[400px]">
            <p className="text-xs text-gray-400 mb-1.5">Copy failed. Select and copy manually:</p>
            <pre className="text-xs text-gray-200 bg-gray-900 rounded px-2 py-1.5 select-all overflow-auto max-h-40">
              {text}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
```

Note: This version uses `<pre>` instead of `<code>` because code blocks can be multi-line and need preserved formatting + scroll.

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && npx tsc --noEmit --project packages/web/tsconfig.json 2>&1 | head -20`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/MessageBubble.tsx
git commit -m "feat(web): upgrade MessageBubble CopyButton with clipboard fallback"
```

---

### Task 5: Build verification

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `cd /Users/kone/OtherProjects/mist/OpenLobby && pnpm --filter @openlobby/web build 2>&1 | tail -10`
Expected: Build succeeds with no errors

- [ ] **Step 2: Commit any fixups if needed**

Only if build reveals issues. Otherwise skip this step.
