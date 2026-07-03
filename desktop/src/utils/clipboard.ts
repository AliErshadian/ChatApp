export async function copyTextToClipboard(text: string, source?: HTMLElement | null) {
  if (window.electronAPI?.copyToClipboard) {
    await window.electronAPI.copyToClipboard(text);
    return;
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to execCommand.
    }
  }

  const target =
    source instanceof HTMLInputElement || source instanceof HTMLTextAreaElement
      ? source
      : (() => {
          const el = document.createElement('textarea');
          el.value = text;
          el.setAttribute('readonly', '');
          el.style.position = 'fixed';
          el.style.left = '-9999px';
          document.body.appendChild(el);
          return el;
        })();

  const isTemporary = target !== source;

  try {
    target.focus();
    target.select();
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      target.setSelectionRange(0, text.length);
    }
    if (!document.execCommand('copy')) {
      throw new Error('Copy failed');
    }
  } finally {
    if (isTemporary) {
      document.body.removeChild(target);
    }
  }
}
