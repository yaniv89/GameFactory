import { forwardRef, useEffect, useRef, type InputHTMLAttributes } from "react";
import "./Checkbox.css";

export interface CheckboxProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  indeterminate?: boolean;
}

function mergeRefs<T>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> {
  return (value) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(value);
      else if (ref && typeof ref === "object") (ref as React.MutableRefObject<T | null>).current = value;
    }
  };
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  ({ label, indeterminate = false, disabled, className, ...rest }, ref) => {
    const innerRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    return (
      <label
        className={[
          "fg-checkbox",
          disabled ? "fg-checkbox--disabled" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span style={{ position: "relative", display: "inline-flex" }}>
          <input
            ref={mergeRefs(ref, innerRef)}
            type="checkbox"
            className="fg-checkbox__input"
            disabled={disabled}
            aria-checked={indeterminate ? "mixed" : undefined}
            {...rest}
          />
          <span className="fg-checkbox__box" aria-hidden="true" />
        </span>
        {label}
      </label>
    );
  },
);
Checkbox.displayName = "Checkbox";
