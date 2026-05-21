import { describe, expect, it } from 'vitest';

import { composeSystemPrompt } from '../src/prompts/system.js';

describe('composeSystemPrompt', () => {
  it('carries the app locale and Chinese quick brief localization instructions', () => {
    const prompt = composeSystemPrompt({
      metadata: { kind: 'prototype', locale: 'zh-CN' } as any,
    });

    expect(prompt).toContain('- **appLocale**: zh-CN');
    expect(prompt).toContain('localize every user-visible form string into Simplified Chinese');
    expect(prompt).toContain('`Quick brief — 30 seconds` → `快速简报 — 30 秒`');
    expect(prompt).toContain('`Target platform` → `目标平台`');
    expect(prompt).toContain('`Visual tone` → `视觉风格`');
    expect(prompt).toContain('"value": "pick_direction"');
    expect(prompt).toContain('"value": "brand_spec"');
    expect(prompt).toContain('"value": "reference_match"');
  });

  it('treats an active design system as the visual direction', () => {
    const prompt = composeSystemPrompt({
      designSystemTitle: 'ComfyUI',
      designSystemBody: '# ComfyUI\n\n--accent: #ffd500',
      metadata: { kind: 'prototype' } as any,
      activeStageBlocks: [
        '\n\n## Active stage: plan\n\n### direction-picker\n\nAsk for 3-5 directions.',
      ],
    });

    expect(prompt).toContain('## Active design system — ComfyUI');
    expect(prompt).toContain('Active design system exception');
    expect(prompt).toContain(
      'the active design system is the visual direction for this project',
    );
    expect(prompt).toContain('Do not ask the user to pick a separate theme color');
    expect(prompt).toContain('Do not emit a direction question-form');
    expect(prompt).not.toContain('<question-form id="direction"');
    expect(prompt.indexOf('## Active design system visual direction')).toBeGreaterThan(
      prompt.indexOf('### direction-picker'),
    );
  });
});
