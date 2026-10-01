import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button';

/**
 * Chrome's "Translate this page" replaces every text node with a <font> of its
 * own. React still holds the original node, so an update that inserts before
 * it or removes it throws ("insertBefore … not a child of this node"), and the
 * whole screen falls to the error page. The button is on every form, and
 * `loading` flips on every submit, so it has to survive that.
 */
function translatePage(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    const font = document.createElement('font');
    font.textContent = node.data;
    node.replaceWith(font);
  }
}

describe('Button on a translated page', () => {
  it('starts and stops loading without touching the label', () => {
    const { rerender } = render(<Button>Sign in</Button>);
    translatePage(screen.getByRole('button'));

    expect(() => rerender(<Button loading>Sign in</Button>)).not.toThrow();
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
    expect(() => rerender(<Button>Sign in</Button>)).not.toThrow();
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-busy');
  });
});
