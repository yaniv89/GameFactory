import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "../Button/Button";
import "./Menu.css";

export interface MenuItemDef {
  id: string;
  label: ReactNode;
  onSelect?: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export interface MenuProps {
  label: string;
  items: MenuItemDef[];
}

/**
 * A button that opens a role="menu" popup. Keyboard model follows the
 * WAI-ARIA menu button pattern: ArrowDown/Up move the active item, Home/End
 * jump to the ends, Enter/Space activates, Escape closes and returns focus
 * to the trigger (CLAUDE.md 5.6: focus order, visible focus, keyboard-first).
 */
export function Menu({ label, items }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) menuRef.current?.focus();
  }, [open]);

  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const selectableIndices = items
    .map((item, i) => (item.disabled ? -1 : i))
    .filter((i) => i >= 0);

  const moveActive = (dir: 1 | -1) => {
    if (selectableIndices.length === 0) return;
    const pos = selectableIndices.indexOf(activeIndex);
    const nextPos =
      (pos + dir + selectableIndices.length) % selectableIndices.length;
    setActiveIndex(selectableIndices[nextPos] ?? selectableIndices[0]!);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveActive(-1);
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(selectableIndices[0] ?? 0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(selectableIndices[selectableIndices.length - 1] ?? 0);
        break;
      case "Enter":
      case " ": {
        e.preventDefault();
        const item = items[activeIndex];
        if (item && !item.disabled) {
          item.onSelect?.();
          close();
        }
        break;
      }
      case "Escape":
        e.preventDefault();
        close();
        break;
      case "Tab":
        close();
        break;
    }
  };

  return (
    <span className="fg-menu-wrap">
      <Button
        ref={triggerRef}
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setActiveIndex(selectableIndices[0] ?? 0);
          setOpen((v) => !v);
        }}
      >
        {label}
      </Button>
      {open && (
        <ul
          ref={menuRef}
          role="menu"
          tabIndex={-1}
          className="fg-menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setOpen(false);
            }
          }}
        >
          {items.map((item, i) => (
            <li
              key={item.id}
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              data-active={i === activeIndex}
              className={[
                "fg-menu__item",
                item.destructive ? "fg-menu__item--destructive" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onMouseEnter={() => !item.disabled && setActiveIndex(i)}
              onClick={() => {
                if (item.disabled) return;
                item.onSelect?.();
                close();
              }}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
