export type DiffLine = {
  type: 'remove' | 'add' | 'same';
  text: string;
};

export function diffText(before: string, after: string): DiffLine[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  if (before === after) {
    return beforeLines.map((text) => ({ type: 'same', text }));
  }

  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) {
    prefix += 1;
  }

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] ===
      afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix += 1;
  }

  const result: DiffLine[] = [];
  for (let i = 0; i < prefix; i += 1) {
    result.push({ type: 'same', text: beforeLines[i] });
  }

  const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
  const added = afterLines.slice(prefix, afterLines.length - suffix);
  for (const text of removed) {
    result.push({ type: 'remove', text });
  }
  for (const text of added) {
    result.push({ type: 'add', text });
  }
  for (let i = beforeLines.length - suffix; i < beforeLines.length; i += 1) {
    result.push({ type: 'same', text: beforeLines[i] });
  }

  return result;
}

export function compactDiffLines(lines: DiffLine[]): DiffLine[] {
  const changed = lines.filter((line) => line.type !== 'same');
  return changed.length > 0 ? changed : lines;
}
