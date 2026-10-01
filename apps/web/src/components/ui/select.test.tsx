import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './select';

/**
 * Radix shows the chosen option by portalling that item's text into the
 * trigger. Chrome's "Translate this page" swaps that text node for a <font>,
 * and when the selection changed React tried to remove the node it portalled
 * and threw. Forty-odd screens use this Select, so it has to survive that.
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

function Picker({ value }: { value: string }) {
  return (
    <Select value={value}>
      <SelectTrigger aria-label="Fuel">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="petrol">Petrol</SelectItem>
        <SelectItem value="diesel">Diesel</SelectItem>
      </SelectContent>
    </Select>
  );
}

describe('Select on a translated page', () => {
  it('changes the shown value without removing a translated text node', () => {
    const { rerender } = render(<Picker value="petrol" />);
    const trigger = screen.getByRole('combobox', { name: 'Fuel' });
    expect(trigger).toHaveTextContent('Petrol');
    translatePage(trigger);

    expect(() => rerender(<Picker value="diesel" />)).not.toThrow();
    expect(trigger).toHaveTextContent('Diesel');
  });
});
