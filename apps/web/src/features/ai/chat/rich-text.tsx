import * as React from 'react';

/**
 * The small slice of Markdown the copilot writes — paragraphs, bullet and
 * numbered lists, **bold**, *italic* and `code` — rendered as React elements.
 *
 * Deliberately not an HTML renderer: model output never reaches the DOM as
 * markup, so nothing it writes can become a script or a link. Half-written
 * syntax (a reply still being typed out) simply shows as text until it closes.
 */

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;

function inline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(INLINE).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code key={key} className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (
      part.length > 2 &&
      ((part.startsWith('*') && part.endsWith('*')) || (part.startsWith('_') && part.endsWith('_')))
    ) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return part;
  });
}

type Block =
  | { kind: 'paragraph'; lines: string[] }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbers'; items: string[] };

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;

function blocks(text: string): Block[] {
  const result: Block[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^#{1,6}\s+/, '');
    const last = result[result.length - 1];

    if (line.trim() === '') {
      result.push({ kind: 'paragraph', lines: [] });
    } else if (BULLET.test(line)) {
      const item = line.replace(BULLET, '');
      if (last?.kind === 'bullets') last.items.push(item);
      else result.push({ kind: 'bullets', items: [item] });
    } else if (NUMBER.test(line)) {
      const item = line.replace(NUMBER, '');
      if (last?.kind === 'numbers') last.items.push(item);
      else result.push({ kind: 'numbers', items: [item] });
    } else if (last?.kind === 'paragraph') {
      last.lines.push(line);
    } else {
      result.push({ kind: 'paragraph', lines: [line] });
    }
  }
  return result.filter((block) => (block.kind === 'paragraph' ? block.lines.length > 0 : true));
}

export function RichText({ text }: { text: string }) {
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks(text).map((block, index) => {
        if (block.kind === 'bullets') {
          return (
            <ul key={index} className="list-disc space-y-1 pl-5 marker:text-primary">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item, `${index}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === 'numbers') {
          return (
            <ol key={index} className="list-decimal space-y-1 pl-5 marker:text-primary">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{inline(item, `${index}-${itemIndex}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={index}>
            {block.lines.map((line, lineIndex) => (
              <React.Fragment key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {inline(line, `${index}-${lineIndex}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
