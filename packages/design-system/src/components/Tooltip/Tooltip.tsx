import { cloneElement, useId, useState, type ReactElement } from "react";
import "./Tooltip.css";

export interface TooltipProps {
  content: string;
  children: ReactElement;
  /** ms before showing, so a passing mouse doesn't spam tooltips. */
  delay?: number;
}

/**
 * Shows on hover AND focus (not hover-only — a keyboard user must be able
 * to trigger it, per CLAUDE.md 5.6 "no interaction unreachable by keyboard").
 * Positioning is a fixed offset below center rather than a floating-ui
 * dependency: Section 2 doesn't list one, and a tooltip's placement need is
 * simple enough not to justify adding a dependency for it.
 */
export function Tooltip({ content, children, delay = 300 }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const tooltipId = useId();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const show = () => {
    timer = setTimeout(() => setVisible(true), delay);
  };
  const hide = () => {
    clearTimeout(timer);
    setVisible(false);
  };

  const trigger = cloneElement(children, {
    "aria-describedby": visible ? tooltipId : undefined,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
  });

  return (
    <span className="fg-tooltip-wrap">
      {trigger}
      {visible && (
        <span role="tooltip" id={tooltipId} className="fg-tooltip">
          {content}
        </span>
      )}
    </span>
  );
}
