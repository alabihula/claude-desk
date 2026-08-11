function hunkStarts(line) {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line)
  return match ? { old: Number(match[1]), next: Number(match[2]) } : null
}

function cell(number, text, kind) {
  return { number, text, kind }
}

function flushChanges(rows, removed, added) {
  const length = Math.max(removed.length, added.length)
  for (let index = 0; index < length; index += 1) {
    rows.push({ type: 'change', old: removed[index] || null, next: added[index] || null })
  }
  removed.length = 0
  added.length = 0
}

export function sideBySideDiff(content) {
  const rows = []
  const removed = []
  const added = []
  let oldLine = 1
  let nextLine = 1
  let inHunk = false

  for (const line of String(content || '').split('\n')) {
    const starts = hunkStarts(line)
    if (starts) {
      flushChanges(rows, removed, added)
      oldLine = starts.old
      nextLine = starts.next
      inHunk = true
      rows.push({ type: 'hunk', text: line })
      continue
    }
    if (line.startsWith('diff --git ') || line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ') || line.startsWith('\\ No newline')) continue
    if (!inHunk && !line.startsWith('+')) continue
    if (line.startsWith('-')) {
      removed.push(cell(oldLine, line.slice(1), 'deletion'))
      oldLine += 1
      continue
    }
    if (line.startsWith('+')) {
      added.push(cell(nextLine, line.slice(1), 'addition'))
      nextLine += 1
      continue
    }
    flushChanges(rows, removed, added)
    const text = line.startsWith(' ') ? line.slice(1) : line
    rows.push({ type: 'context', old: cell(oldLine, text, 'context'), next: cell(nextLine, text, 'context') })
    oldLine += 1
    nextLine += 1
  }
  flushChanges(rows, removed, added)
  return rows
}
