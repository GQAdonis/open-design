// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KEY_ENTER_COMMAND } from 'lexical';

import {
  LexicalComposerInput,
  type LexicalComposerInputHandle,
} from '../../../src/components/composer/LexicalComposerInput';
import type { InlineMentionEntity } from '../../../src/utils/inlineMentions';

const KNOWN: InlineMentionEntity[] = [
  { id: 'deck-builder', kind: 'skill', label: 'Deck Builder', token: '@Deck Builder' },
  {
    id: 'designs/landing.html',
    kind: 'file',
    label: 'designs/landing.html',
    token: '@designs/landing.html',
  },
];

type Props = ComponentProps<typeof LexicalComposerInput>;

function setup(overrides: Partial<Props> = {}) {
  const onChange = vi.fn();
  const onTrigger = vi.fn();
  const onEnterSend = vi.fn();
  const onPopoverKey = vi.fn(() => false);
  const ref = { current: null as LexicalComposerInputHandle | null };
  const props: Props = {
    placeholder: 'Message',
    draft: '',
    knownEntities: KNOWN,
    onChange,
    onTrigger,
    onEnterSend,
    onPopoverKey,
    popoverOpen: false,
    ...overrides,
  };
  const utils = render(<LexicalComposerInput ref={ref} {...props} />);
  return { ref, onChange, onTrigger, onEnterSend, onPopoverKey, ...utils };
}

afterEach(() => {
  cleanup();
});

describe('LexicalComposerInput', () => {
  it('mounts the contenteditable with the expected testid', () => {
    const { getByTestId } = setup();
    const editable = getByTestId('chat-composer-input');
    expect(editable.getAttribute('contenteditable')).toBe('true');
    expect(editable.className).toContain('composer-editable');
    expect(editable.className).toContain('ph-no-capture');
  });

  it('seeds from the draft prop and renders known @tokens as atomic pills', async () => {
    const { getByTestId } = setup({ draft: 'Use @designs/landing.html now' });
    await waitFor(() => {
      const pill = getByTestId('chat-composer-input').querySelector(
        '.composer-inline-mention',
      );
      expect(pill?.textContent).toBe('@designs/landing.html');
      expect(pill?.className).toContain('composer-inline-mention--file');
    });
    // The serialized text round-trips byte-identically through getText().
    expect(getByTestId('chat-composer-input').textContent).toContain(
      '@designs/landing.html',
    );
  });

  it('exposes a getText() that round-trips the seeded draft', async () => {
    const { ref } = setup({ draft: 'hello @Deck Builder world' });
    await waitFor(() => expect(ref.current).not.toBeNull());
    expect(ref.current?.getText()).toBe('hello @Deck Builder world');
  });

  it('insertMention adds an atomic pill carrying the real id', async () => {
    const { ref, getByTestId } = setup();
    await waitFor(() => expect(ref.current).not.toBeNull());
    act(() => {
      ref.current?.insertMention({
        token: '@Deck Builder',
        entity: { id: 'deck-builder', kind: 'skill', label: 'Deck Builder' },
      });
    });
    await waitFor(() => {
      const pill = getByTestId('chat-composer-input').querySelector(
        '.composer-inline-mention--skill',
      );
      expect(pill?.textContent).toBe('@Deck Builder');
    });
    expect(ref.current?.getText()).toBe('@Deck Builder ');
  });

  it('clear() empties the editor', async () => {
    const { ref } = setup({ draft: 'something' });
    await waitFor(() => expect(ref.current?.getText()).toBe('something'));
    act(() => ref.current?.clear());
    await waitFor(() => expect(ref.current?.getText()).toBe(''));
  });

  // TODO(lexical-jsdom): jsdom can't make `editor.isComposing()` return true.
  // Lexical flips its internal composition key only from the real browser
  // compositionstart → beforeinput → compositionend pipeline, which jsdom's
  // synthetic CompositionEvent / keyDown does not drive. The #2851 guard
  // itself (`if (editor.isComposing()) return false` at the top of every
  // KeyboardPlugin command) lives in source and must be confirmed against a
  // real IME (Chinese pinyin) via Playwright / human verification — see
  // blueprint risk R1. The plain-Enter test below covers the non-composing
  // branch of the same handler.
  it.skip('does NOT call onEnterSend when Enter fires during IME composition (#2851 guard)', () => {
    // Intentionally skipped — see TODO above.
  });

  it('calls onEnterSend on a plain Enter outside composition', async () => {
    const { onEnterSend, getByTestId } = setup({ draft: 'hi' });
    const editable = getByTestId('chat-composer-input') as HTMLElement & {
      __lexicalEditor?: import('lexical').LexicalEditor;
    };
    // jsdom does not route a synthetic keyDown through Lexical's root
    // keydown → command pipeline, so we dispatch KEY_ENTER_COMMAND directly.
    // This still exercises the real KeyboardPlugin handler (its isComposing /
    // shiftKey / metaKey / popoverOpen / onEnterSend branch logic) — only the
    // DOM-event-to-command hop is replaced.
    const editor = editable.__lexicalEditor;
    expect(editor).toBeTruthy();
    const enterEvent = {
      key: 'Enter',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault() {},
    } as unknown as KeyboardEvent;
    act(() => {
      editor?.dispatchCommand(KEY_ENTER_COMMAND, enterEvent);
    });
    await waitFor(() => expect(onEnterSend).toHaveBeenCalledTimes(1));
  });
});
