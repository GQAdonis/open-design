// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  $createParagraphNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';

import {
  MentionNode,
  $createMentionNode,
  $isMentionNode,
} from '../../../src/components/composer/MentionNode';

function makeEditor(): LexicalEditor {
  return createEditor({
    namespace: 'mention-node-test',
    nodes: [MentionNode],
    onError: (e) => {
      throw e;
    },
  });
}

describe('MentionNode', () => {
  it('uses the @token as its text content so the wire format is free', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createMentionNode({
          mentionId: 'deck-builder',
          mentionKind: 'skill',
          token: '@Deck Builder',
          label: 'Deck Builder',
        });
        expect(node.getTextContent()).toBe('@Deck Builder');
        expect(node.getToken()).toBe('@Deck Builder');
        expect($isMentionNode(node)).toBe(true);
        expect(node.isToken()).toBe(true);
        expect(node.getMode()).toBe('token');
      },
      { discrete: true },
    );
  });

  it('exposes the backing entity (id/kind/label/title)', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createMentionNode({
          mentionId: 'slack',
          mentionKind: 'mcp',
          token: '@Slack MCP',
          label: 'Slack MCP',
          title: 'MCP: Slack MCP',
        });
        expect(node.getEntity()).toEqual({
          id: 'slack',
          kind: 'mcp',
          label: 'Slack MCP',
          token: '@Slack MCP',
          title: 'MCP: Slack MCP',
        });
      },
      { discrete: true },
    );
  });

  it('round-trips through export/import JSON', () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createMentionNode({
          mentionId: 'designs/x.html',
          mentionKind: 'file',
          token: '@designs/x.html',
          label: 'designs/x.html',
        });
        const json = node.exportJSON();
        expect(json.type).toBe('composer-mention');
        expect(json.mentionId).toBe('designs/x.html');
        const clone = MentionNode.importJSON(json);
        expect(clone.getEntity()).toEqual(node.getEntity());
      },
      { discrete: true },
    );
  });

  it('renders a kind-scoped pill span in the DOM when mounted in an editor', () => {
    // `createDOM` requires the reconciler's active-editor DOM context, so drive
    // it through a real mounted editor + root element rather than calling
    // createDOM() in isolation. The reconciler renders the MentionNode's span
    // with the kind class + data attributes.
    const root = document.createElement('div');
    document.body.appendChild(root);
    const editor = makeEditor();
    editor.setRootElement(root);
    editor.update(
      () => {
        const p = $createParagraphNode();
        p.append(
          $createMentionNode({
            mentionId: 'p1',
            mentionKind: 'plugin',
            token: '@Deck',
            label: 'Deck',
          }),
        );
        $getRoot().clear();
        $getRoot().append(p);
      },
      { discrete: true },
    );
    const pill = root.querySelector('.composer-inline-mention');
    expect(pill).not.toBeNull();
    expect(pill?.className).toContain('composer-inline-mention--plugin');
    expect(pill?.getAttribute('data-mention-id')).toBe('p1');
    expect(pill?.getAttribute('data-mention-kind')).toBe('plugin');
    expect(pill?.textContent).toBe('@Deck');
    editor.setRootElement(null);
    root.remove();
  });
});
