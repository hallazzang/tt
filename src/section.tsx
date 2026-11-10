import { Box, Text } from 'ink';
import type { ReactNode } from 'react';
import type { Cell, SourceState, Task } from './types.js';

type Props = { name: string; state: SourceState; width: number; height: number };

export function Section({ name, state, width, height }: Props) {
  const { tasks, error } = state;
  const inner = Math.max(height - 2, 0); // rows between top and bottom border

  let body: ReactNode;
  if (!tasks) {
    body = error ? <Text color="red" wrap="truncate-end">{error}</Text> : <Text dimColor>loading…</Text>;
  } else if (tasks.length === 0) {
    body = <Text dimColor>Nothing here ✓</Text>;
  } else {
    const overflow = tasks.length > inner;
    const shown = overflow ? tasks.slice(0, Math.max(inner - 1, 0)) : tasks;
    // Column widths from the widest cell in each position.
    const widths = (pick: (t: Task) => Cell[]) =>
      shown.reduce<number[]>((w, t) => pick(t).map((c, i) => Math.max(w[i] ?? 0, c.text.length)), []);
    const leftW = widths((t) => t.left);
    const rightW = widths((t) => t.right);
    body = (
      <>
        {shown.map((t) => (
          <Box key={t.id} columnGap={1}>
            {t.left.map((c, i) => (
              <Box key={i} width={leftW[i]} flexShrink={0}>
                <CellText cell={c} />
              </Box>
            ))}
            <Box flexGrow={1} flexShrink={1}>
              <Text wrap="truncate-end">{t.title}</Text>
            </Box>
            {t.badges?.length ? (
              <Box flexShrink={0} columnGap={1}>
                {t.badges.map((c, i) => (
                  <CellText key={i} cell={c} />
                ))}
              </Box>
            ) : null}
            {t.right.map((c, i) => (
              <Box key={i} width={rightW[i]} flexShrink={0} justifyContent="flex-end">
                <CellText cell={c} />
              </Box>
            ))}
          </Box>
        ))}
        {overflow && <Text dimColor>… +{tasks.length - shown.length} more</Text>}
      </>
    );
  }

  // Top border with the title embedded: ╭─ Linear (stale: …) ───╮
  const room = width - name.length - 5;
  let stale = tasks && error ? ` (stale: ${error})` : '';
  if (stale.length > room) stale = room > 1 ? stale.slice(0, room - 1) + '…' : '';
  const fill = Math.max(room - stale.length, 0);

  return (
    <Box flexDirection="column" width={width} height={height}>
      <Text>
        <Text color="gray">╭─ </Text>
        <Text bold>{name}</Text>
        <Text dimColor>{stale}</Text>
        <Text color="gray"> {'─'.repeat(fill)}╮</Text>
      </Text>
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderTop={false} borderColor="gray" paddingX={1} overflow="hidden">
        {body}
      </Box>
    </Box>
  );
}

function CellText({ cell }: { cell: Cell }) {
  return (
    <Text color={cell.color} dimColor={cell.dim}>
      {link(cell.text, cell.url)}
    </Text>
  );
}

// OSC 8 terminal hyperlink: clicking the text opens the URL in the default browser.
function link(text: string, url?: string): string {
  return url ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text;
}
