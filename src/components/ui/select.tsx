"use client";

import {
  Children,
  Fragment,
  isValidElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

type Option = {
  value: string;
  label: string;
  disabled: boolean;
  group?: string;
};
type SelectProps = Omit<
  SelectHTMLAttributes<HTMLSelectElement>,
  "multiple" | "size"
>;

function optionText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number")
        return String(child);
      return isValidElement<{ children?: ReactNode }>(child)
        ? optionText(child.props.children)
        : "";
    })
    .join("");
}

function collectOptions(
  children: ReactNode,
  group?: string,
  disabled = false,
): Option[] {
  const options: Option[] = [];
  Children.forEach(children, (child) => {
    if (
      !isValidElement<{
        children?: ReactNode;
        value?: string | number;
        disabled?: boolean;
        label?: string;
      }>(child)
    )
      return;
    if (child.type === Fragment)
      options.push(...collectOptions(child.props.children, group, disabled));
    if (child.type === "optgroup")
      options.push(
        ...collectOptions(
          child.props.children,
          child.props.label,
          disabled || !!child.props.disabled,
        ),
      );
    if (child.type === "option") {
      const label = child.props.label ?? optionText(child.props.children);
      options.push({
        value: String(child.props.value ?? label),
        label,
        disabled: disabled || !!child.props.disabled,
        group,
      });
    }
  });
  return options;
}

/** Styled single select, retaining native form values, change events and reset behavior. */
export function Select({
  children,
  value,
  defaultValue,
  disabled,
  required,
  name,
  id,
  form,
  className,
  style,
  onChange,
  onInvalid,
  autoFocus,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  ...nativeProps
}: SelectProps) {
  const options = collectOptions(children);
  const firstValue = options.find((option) => !option.disabled)?.value ?? "";
  const initialValue = String(defaultValue ?? firstValue);
  const [uncontrolledValue, setUncontrolledValue] = useState(initialValue);
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const native = useRef<HTMLSelectElement>(null);
  const requestedValue =
    value === undefined ? uncontrolledValue : String(value);
  const selected =
    options.find((option) => option.value === requestedValue) ??
    options.find((option) => !option.disabled);
  const selectedValue = selected?.value ?? "";
  const isDisabled = disabled || !options.some((option) => !option.disabled);
  const dialog = trigger?.closest("dialog");

  useEffect(() => {
    const associatedForm = native.current?.form;
    if (!associatedForm) return;
    const reset = () => setUncontrolledValue(initialValue);
    associatedForm.addEventListener("reset", reset);
    return () => associatedForm.removeEventListener("reset", reset);
  }, [initialValue, trigger]);

  function choose(encoded: string) {
    const next = encoded.slice("option:".length);
    const control = native.current;
    if (!control) return;
    // A genuine select change preserves FormData and ancestor onChange handlers
    // (checkout uses them to invalidate a previously calculated quote).
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )?.set?.call(control, next);
    control.dispatchEvent(new Event("change", { bubbles: true }));
    if (value !== undefined) control.value = selectedValue;
  }

  return (
    <span
      className={`select-field ${className ?? ""}`}
      style={style}
      data-disabled={isDisabled ? "" : undefined}
      onChange={(event) => {
        // Only our named native control should notify the parent form; Radix
        // also renders an unnamed select and bubbles its encoded value.
        if (event.target !== native.current) event.stopPropagation();
      }}
    >
      <SelectPrimitive.Root
        value={`option:${selectedValue}`}
        onValueChange={choose}
        disabled={isDisabled}
      >
        <SelectPrimitive.Trigger
          ref={setTrigger}
          id={id}
          className="select-trigger"
          type="button"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          aria-required={required || undefined}
          autoFocus={autoFocus}
        >
          <SelectPrimitive.Value>
            {selected?.label ?? "Chưa có lựa chọn"}
          </SelectPrimitive.Value>
          <SelectPrimitive.Icon className="select-chevron">
            <ChevronDown size={16} strokeWidth={1.7} />
          </SelectPrimitive.Icon>
        </SelectPrimitive.Trigger>
        <SelectPrimitive.Portal container={dialog ?? undefined}>
          <SelectPrimitive.Content
            className="select-content"
            position="popper"
            sideOffset={7}
            align="start"
            collisionPadding={12}
          >
            <SelectPrimitive.ScrollUpButton className="select-scroll-button">
              <ChevronUp size={15} />
            </SelectPrimitive.ScrollUpButton>
            <SelectPrimitive.Viewport className="select-viewport">
              {options.map((option, index) => (
                <Fragment key={option.value}>
                  {option.group &&
                    options[index - 1]?.group !== option.group && (
                      <div className="select-group-label">{option.group}</div>
                    )}
                  <SelectPrimitive.Item
                    className="select-item"
                    value={`option:${option.value}`}
                    disabled={option.disabled}
                    textValue={option.label}
                  >
                    <SelectPrimitive.ItemText>
                      {option.label}
                    </SelectPrimitive.ItemText>
                    <SelectPrimitive.ItemIndicator className="select-check">
                      <Check size={15} strokeWidth={1.8} />
                    </SelectPrimitive.ItemIndicator>
                  </SelectPrimitive.Item>
                </Fragment>
              ))}
            </SelectPrimitive.Viewport>
            <SelectPrimitive.ScrollDownButton className="select-scroll-button">
              <ChevronDown size={15} />
            </SelectPrimitive.ScrollDownButton>
          </SelectPrimitive.Content>
        </SelectPrimitive.Portal>
      </SelectPrimitive.Root>
      <select
        {...nativeProps}
        ref={native}
        className="select-native"
        name={name}
        form={form}
        disabled={isDisabled}
        required={required}
        value={selectedValue}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          // This native bridge is always controlled by Select, including when
          // its caller uses defaultValue and supplies no change callback.
          if (value === undefined)
            setUncontrolledValue(event.currentTarget.value);
          onChange?.(event);
        }}
        onInvalid={(event) => {
          event.preventDefault();
          trigger?.focus();
          onInvalid?.(event);
        }}
      >
        {children}
      </select>
    </span>
  );
}
