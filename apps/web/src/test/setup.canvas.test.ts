import axe from 'axe-core';
import { expect, it } from 'vitest';

interface AxeVirtualNode {
  children: AxeVirtualNode[];
  props: {
    nodeName: string;
    nodeValue?: string;
  };
}

interface AxeTextInternals {
  commons: {
    text: {
      isIconLigature(node: AxeVirtualNode): boolean;
    };
  };
  utils: {
    getFlattenedTree(root: Node): AxeVirtualNode[];
  };
}

function findTextNode(nodes: AxeVirtualNode[], value: string): AxeVirtualNode | undefined {
  for (const node of nodes) {
    if (node.props.nodeName === '#text' && node.props.nodeValue === value) return node;
    const child = findTextNode(node.children, value);
    if (child) return child;
  }
  return undefined;
}

it('keeps ordinary UI text eligible for axe contrast rules', () => {
  document.body.innerHTML =
    '<span style="font-family: PuntovivoSetupIntegrity, sans-serif">Save</span>';
  const axeInternals = axe as unknown as AxeTextInternals;
  const textNode = findTextNode(axeInternals.utils.getFlattenedTree(document), 'Save');

  expect(textNode).toBeDefined();
  expect(axeInternals.commons.text.isIconLigature(textNode!)).toBe(false);
});
