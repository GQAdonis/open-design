import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

interface TooltipState {
  target: HTMLElement;
  text: string;
  placement: TooltipPlacement;
  style: {
    left: number;
    top: number;
    visibility: 'hidden' | 'visible';
  };
}

const TOOLTIP_MARGIN = 8;
const TOOLTIP_GAP = 7;

function isTooltipTarget(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement
    && el.classList.contains('od-tooltip')
    && Boolean(el.dataset.tooltip?.trim())
    && el.getAttribute('aria-expanded') !== 'true';
}

function readTooltipTarget(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof Element)) return null;
  const candidate = start.closest('.od-tooltip[data-tooltip]');
  return isTooltipTarget(candidate) ? candidate : null;
}

function tooltipPlacement(target: HTMLElement): TooltipPlacement {
  const raw = target.dataset.tooltipPlacement;
  return raw === 'bottom' || raw === 'left' || raw === 'right' ? raw : 'top';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function positionTooltip(
  target: HTMLElement,
  tooltip: HTMLElement,
  placement: TooltipPlacement,
): TooltipState['style'] {
  const rect = target.getBoundingClientRect();
  const tip = tooltip.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const maxLeft = Math.max(TOOLTIP_MARGIN, viewportWidth - tip.width - TOOLTIP_MARGIN);
  const maxTop = Math.max(TOOLTIP_MARGIN, viewportHeight - tip.height - TOOLTIP_MARGIN);

  let left = rect.left + rect.width / 2 - tip.width / 2;
  let top = rect.top - tip.height - TOOLTIP_GAP;

  if (placement === 'bottom') {
    top = rect.bottom + TOOLTIP_GAP;
  } else if (placement === 'left') {
    left = rect.left - tip.width - TOOLTIP_GAP;
    top = rect.top + rect.height / 2 - tip.height / 2;
  } else if (placement === 'right') {
    left = rect.right + TOOLTIP_GAP;
    top = rect.top + rect.height / 2 - tip.height / 2;
  }

  return {
    left: clamp(left, TOOLTIP_MARGIN, maxLeft),
    top: clamp(top, TOOLTIP_MARGIN, maxTop),
    visibility: 'visible',
  };
}

export function TooltipLayer() {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<TooltipState | null>(null);

  const hideTooltip = useCallback(() => {
    setState(null);
  }, []);

  const showTooltip = useCallback((target: HTMLElement) => {
    const text = target.dataset.tooltip?.trim();
    if (!text) return;
    setState({
      target,
      text,
      placement: tooltipPlacement(target),
      style: { left: 0, top: 0, visibility: 'hidden' },
    });
  }, []);

  const updatePosition = useCallback(() => {
    setState((current) => {
      if (!current) return null;
      if (!document.contains(current.target)) return null;
      if (current.target.getAttribute('aria-expanded') === 'true') return null;
      const node = tooltipRef.current;
      if (!node) return current;
      return {
        ...current,
        text: current.target.dataset.tooltip?.trim() ?? current.text,
        placement: tooltipPlacement(current.target),
        style: positionTooltip(current.target, node, tooltipPlacement(current.target)),
      };
    });
  }, []);

  useLayoutEffect(() => {
    if (!state) return;
    updatePosition();
  }, [state?.target, state?.text, state?.placement, updatePosition]);

  useEffect(() => {
    const onPointerOver = (event: PointerEvent) => {
      const target = readTooltipTarget(event.target);
      if (target) showTooltip(target);
    };
    const onPointerOut = (event: PointerEvent) => {
      const target = readTooltipTarget(event.target);
      if (!target) return;
      const next = event.relatedTarget;
      if (next instanceof Node && target.contains(next)) return;
      hideTooltip();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = readTooltipTarget(event.target);
      if (target) showTooltip(target);
    };
    const onFocusOut = (event: FocusEvent) => {
      const target = readTooltipTarget(event.target);
      if (!target) return;
      const next = event.relatedTarget;
      if (next instanceof Node && target.contains(next)) return;
      hideTooltip();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideTooltip();
    };

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [hideTooltip, showTooltip, updatePosition]);

  if (!state || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={tooltipRef}
      className="od-tooltip-layer"
      role="tooltip"
      style={{
        left: state.style.left,
        top: state.style.top,
        visibility: state.style.visibility,
      }}
    >
      {state.text}
    </div>,
    document.body,
  );
}
