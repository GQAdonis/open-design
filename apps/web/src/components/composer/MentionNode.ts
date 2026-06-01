import {
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from 'lexical';
import type { InlineMentionEntity, InlineMentionKind } from '../../utils/inlineMentions';

// The atomic @mention node. It extends TextNode in `'token'` mode so the
// caret treats it as a single indivisible glyph: one arrow-step crosses it,
// one Backspace removes the whole thing, and the IME never composes inside
// it. Because the node's *text* is the literal `@token`, serialization back
// to the wire format is free — `getTextContent()` already yields `@token`.
type Kind = InlineMentionKind;

export interface MentionPayload {
  mentionId: string;
  mentionKind: Kind;
  token: string; // literal "@..." — this IS the node text
  label: string;
  title?: string | undefined;
}

export type SerializedMentionNode = Spread<
  {
    mentionId: string;
    mentionKind: Kind;
    token: string;
    label: string;
    title?: string;
  },
  SerializedTextNode
>;

export class MentionNode extends TextNode {
  __mentionId: string;
  __mentionKind: Kind;
  __token: string;
  __label: string;
  __title: string | undefined;

  static getType(): string {
    return 'composer-mention';
  }

  static clone(node: MentionNode): MentionNode {
    return new MentionNode(
      {
        mentionId: node.__mentionId,
        mentionKind: node.__mentionKind,
        token: node.__token,
        label: node.__label,
        title: node.__title,
      },
      node.__text,
      node.__key,
    );
  }

  constructor(p: MentionPayload, text?: string, key?: NodeKey) {
    super(text ?? p.token, key); // node TEXT = token → serializes verbatim
    this.__mentionId = p.mentionId;
    this.__mentionKind = p.mentionKind;
    this.__token = p.token;
    this.__label = p.label;
    this.__title = p.title;
    this.setMode('token'); // atomic: single caret stop, whole-node delete
  }

  getEntity(): InlineMentionEntity {
    return {
      id: this.__mentionId,
      kind: this.__mentionKind,
      label: this.__label,
      token: this.__token,
      ...(this.__title ? { title: this.__title } : {}),
    };
  }

  getToken(): string {
    return this.__token;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config); // <span> wrapping the token text
    dom.className = `composer-inline-mention composer-inline-mention--${this.__mentionKind}`;
    dom.setAttribute('data-mention', '');
    dom.setAttribute('data-mention-id', this.__mentionId);
    dom.setAttribute('data-mention-kind', this.__mentionKind);
    if (this.__title) dom.setAttribute('title', this.__title);
    return dom;
  }

  updateDOM(prev: this, dom: HTMLElement, config: EditorConfig): boolean {
    // `TextNode.updateDOM` declares its previous-node param with a polymorphic
    // `this`. Match that signature exactly so the override is type-compatible;
    // inside MentionNode `this` is MentionNode, so the `__mention*` reads below
    // are still well typed.
    const updated = super.updateDOM(prev, dom, config);
    if (prev.__mentionKind !== this.__mentionKind) {
      dom.className = `composer-inline-mention composer-inline-mention--${this.__mentionKind}`;
      dom.setAttribute('data-mention-kind', this.__mentionKind);
    }
    if (prev.__title !== this.__title) {
      if (this.__title) dom.setAttribute('title', this.__title);
      else dom.removeAttribute('title');
    }
    return updated;
  }

  // Nothing may merge into or split a mention — keeps the token indivisible.
  isToken(): true {
    return true;
  }
  canInsertTextBefore(): boolean {
    return false;
  }
  canInsertTextAfter(): boolean {
    return false;
  }

  exportJSON(): SerializedMentionNode {
    return {
      ...super.exportJSON(),
      type: MentionNode.getType(),
      version: 1,
      mentionId: this.__mentionId,
      mentionKind: this.__mentionKind,
      token: this.__token,
      label: this.__label,
      ...(this.__title ? { title: this.__title } : {}),
    };
  }

  static importJSON(json: SerializedMentionNode): MentionNode {
    return $createMentionNode({
      mentionId: json.mentionId,
      mentionKind: json.mentionKind,
      token: json.token,
      label: json.label,
      title: json.title,
    });
  }
}

export function $createMentionNode(p: MentionPayload): MentionNode {
  return new MentionNode(p);
}

export function $isMentionNode(n: LexicalNode | null | undefined): n is MentionNode {
  return n instanceof MentionNode;
}
