// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ChatPane, retryableAssistantMessage } from '../../src/components/ChatPane';
import { DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX } from '../../src/design-system-auto-prompt';
import type { ChatMessage, Conversation, ProjectMetadata } from '../../src/types';

vi.mock('../../src/i18n', () => ({
  useI18n: () => ({
    locale: 'en',
    setLocale: () => undefined,
    t: (key: string) => key,
  }),
  useT: () => (key: string) => key,
}));

vi.mock('../../src/components/AssistantMessage', () => ({
  AssistantMessage: ({ streaming, message }: { streaming: boolean; message: ChatMessage }) => (
    <output data-testid={`assistant-streaming-${message.id}`}>{streaming ? 'streaming' : 'idle'}</output>
  ),
}));

vi.mock('../../src/components/ChatComposer', () => ({
  ChatComposer: forwardRef(({
    streaming,
    incomingAttachments = [],
    onIncomingAttachmentsAccepted,
  }: {
    streaming: boolean;
    incomingAttachments?: Array<{ path: string; name: string }>;
    onIncomingAttachmentsAccepted?: (paths: string[]) => void;
  }, ref) => {
    const [attachments, setAttachments] = useState<Array<{ path: string; name: string }>>([]);
    useImperativeHandle(ref, () => ({
      setDraft: vi.fn(),
      focus: vi.fn(),
    }), []);
    useEffect(() => {
      if (incomingAttachments.length === 0) return;
      setAttachments((current) => {
        const currentPaths = new Set(current.map((item) => item.path));
        const additions: Array<{ path: string; name: string }> = [];
        for (const att of incomingAttachments) {
          if (currentPaths.has(att.path)) continue;
          currentPaths.add(att.path);
          additions.push(att);
        }
        return additions.length > 0 ? [...current, ...additions] : current;
      });
      onIncomingAttachmentsAccepted?.(incomingAttachments.map((att) => att.path));
    }, [incomingAttachments, onIncomingAttachmentsAccepted]);
    return (
      <div>
        <output data-testid="composer-streaming">{streaming ? 'streaming' : 'idle'}</output>
        <div data-testid="mock-staged-attachments">
          {attachments.map((att) => (
            <span key={att.path} data-testid="mock-staged-attachment">{att.name}</span>
          ))}
        </div>
      </div>
    );
  }),
}));

afterEach(() => {
  cleanup();
});

describe('ChatPane streaming state', () => {
  it('exposes retry only for the last failed assistant when the pane is idle', () => {
    const failed: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      content: 'Generation failed',
      createdAt: 1,
      runStatus: 'failed',
    };
    const messages: ChatMessage[] = [
      { id: 'user-1', role: 'user', content: 'Create a login page', createdAt: 0 },
      failed,
    ];

    expect(retryableAssistantMessage(messages, failed.id, false)).toBe(failed);
    expect(retryableAssistantMessage(messages, failed.id, true)).toBeNull();
    expect(retryableAssistantMessage([...messages, { ...messages[0]!, id: 'user-2' }], failed.id, false))
      .toBeNull();
  });

  it('renders user turns with the chat bubble styling hook', () => {
    const messages: ChatMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: 'Generate a simple sign-in page',
        createdAt: 1,
      },
    ];

    render(
      <ChatPane
        projectKindForTracking="prototype"
        messages={messages}
        streaming={false}
        error={null}
        projectId="project-1"
        projectFiles={[]}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
        conversations={conversations}
        activeConversationId="conv-1"
        onSelectConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        projectMetadata={projectMetadata}
      />,
    );

    const bubble = screen.getByText('Generate a simple sign-in page');
    expect(bubble.classList.contains('user-bubble')).toBe(true);
    expect(bubble.closest('.msg.user')).not.toBeNull();
  });

  it('summarizes auto-sent design-system workspace prompts', () => {
    const messages: ChatMessage[] = [
      {
        id: 'user-1',
        role: 'user',
        content: `${DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX}
Use the files in this project as the design system source for future projects.
Expected output:
- A clear DESIGN.md with all generated rules.`,
        createdAt: 1,
      },
    ];

    render(
      <ChatPane
        messages={messages}
        streaming={false}
        error={null}
        projectId="project-1"
        projectFiles={[]}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
        conversations={conversations}
        activeConversationId="conv-1"
        onSelectConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        projectMetadata={projectMetadata}
      />,
    );

    expect(screen.getByText('Creating design system workspace')).toBeTruthy();
    expect(screen.queryByText(DESIGN_SYSTEM_WORKSPACE_PROMPT_PREFIX, { exact: false })).toBeNull();
    expect(screen.queryByRole('button', { name: 'chat.copyPrompt' })).toBeNull();
  });

  it('keeps composer idle while active-run messages still render as streaming', () => {
    const messages: ChatMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'still running',
        createdAt: 1,
        runId: 'run-1',
        runStatus: 'running',
      },
    ];

    render(
      <ChatPane
        projectKindForTracking="prototype"
        messages={messages}
        streaming={false}
        error={null}
        projectId="project-1"
        projectFiles={[]}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
        conversations={conversations}
        activeConversationId="conv-1"
        onSelectConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        projectMetadata={projectMetadata}
      />,
    );

    expect(screen.getByTestId('composer-streaming').textContent).toBe('idle');
    expect(screen.getByTestId('assistant-streaming-assistant-1').textContent).toBe('streaming');
  });

  it('stages pending capture attachments into the chat composer and consumes them by path', async () => {
    const onConsumed = vi.fn();

    render(
      <ChatPane
        projectKindForTracking="prototype"
        messages={[]}
        streaming={false}
        error={null}
        projectId="project-1"
        projectFiles={[]}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
        conversations={conversations}
        activeConversationId="conv-1"
        onSelectConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        projectMetadata={projectMetadata}
        composerAttachmentInbox={[
          { path: 'uploads/screenshot-1.png', name: 'screenshot-1.png', kind: 'image', size: 12 },
        ]}
        onComposerAttachmentsAccepted={(paths) => {
          paths.forEach((path) => onConsumed(path));
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText('screenshot-1.png')).toBeTruthy();
    });
    expect(onConsumed).toHaveBeenCalledWith('uploads/screenshot-1.png');
  });

  it('drains queued capture attachments without duplicating repeated paths', async () => {
    function Harness() {
      const [pending, setPending] = useState([
        { path: 'uploads/screenshot-1.png', name: 'screenshot-1.png', kind: 'image' as const, size: 12 },
        { path: 'uploads/screenshot-2.png', name: 'screenshot-2.png', kind: 'image' as const, size: 14 },
        { path: 'uploads/screenshot-2.png', name: 'screenshot-2.png', kind: 'image' as const, size: 14 },
      ]);
      return (
        <ChatPane
          projectKindForTracking="prototype"
          messages={[]}
          streaming={false}
          error={null}
          projectId="project-1"
          projectFiles={[]}
          onEnsureProject={async () => 'project-1'}
          onSend={vi.fn()}
          onStop={vi.fn()}
          conversations={conversations}
          activeConversationId="conv-1"
          onSelectConversation={vi.fn()}
          onDeleteConversation={vi.fn()}
          projectMetadata={projectMetadata}
          composerAttachmentInbox={pending}
          onComposerAttachmentsAccepted={(paths) => {
            const accepted = new Set(paths);
            setPending((current) => current.filter((att) => !accepted.has(att.path)));
          }}
        />
      );
    }

    render(<Harness />);

    await waitFor(() => {
      expect(screen.getByText('screenshot-1.png')).toBeTruthy();
      expect(screen.getByText('screenshot-2.png')).toBeTruthy();
    });
    expect(screen.getAllByTestId('mock-staged-attachment')).toHaveLength(2);
  });

  it('renders a stopped pinned todo after a terminal run without a final TodoWrite', () => {
    const messages: ChatMessage[] = [
      {
        id: 'assistant-1',
        role: 'assistant',
        content: '',
        createdAt: 1,
        startedAt: 1,
        endedAt: 2,
        runStatus: 'failed',
        events: [
          {
            kind: 'tool_use',
            id: 'todo-1',
            name: 'TodoWrite',
            input: {
              todos: [
                {
                  content: 'Build prototype',
                  status: 'in_progress',
                  activeForm: 'Building prototype',
                },
                { content: 'Run QA', status: 'pending' },
              ],
            },
          },
        ],
      },
    ];

    const { container } = render(
      <ChatPane
        messages={messages}
        streaming={false}
        error={null}
        projectId="project-1"
        projectFiles={[]}
        onEnsureProject={async () => 'project-1'}
        onSend={vi.fn()}
        onStop={vi.fn()}
        conversations={conversations}
        activeConversationId="conv-1"
        onSelectConversation={vi.fn()}
        onDeleteConversation={vi.fn()}
        projectMetadata={projectMetadata}
      />,
    );

    expect(screen.getByText('0/2')).toBeTruthy();
    expect(container.querySelector('.todo-stopped')?.textContent).toContain('Build prototype');
    expect(container.querySelector('.todo-in_progress')).toBeNull();
    expect(container.querySelector('.op-todo-current')).toBeNull();
  });
});

const conversations: Conversation[] = [
  {
    id: 'conv-1',
    projectId: 'project-1',
    title: 'Conversation 1',
    createdAt: 1,
    updatedAt: 1,
  },
];

const projectMetadata: ProjectMetadata = {
  kind: 'prototype',
};
