import * as React from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** Radix reserves "" for "no value", so an empty option maps to this internally. */
const EMPTY = "__cp-empty__"

type OptionProps = { value?: string | number; disabled?: boolean; children?: React.ReactNode }

/**
 * A drop-in for a plain <select>: it takes <option> children, `value` and an
 * `onChange(event)` like the native element, but renders the styled Select, so
 * no browser-default list appears anywhere (user preference). `compact`
 * matches small buttons (36 px); the default matches buttons (40 px).
 */
function NativeSelect({
  className,
  compact,
  value,
  defaultValue,
  onChange,
  disabled,
  children,
  id,
  name,
  required,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
}: Omit<React.ComponentProps<"select">, "onChange"> & {
  compact?: boolean
  onChange?: (event: { target: { value: string }; currentTarget: { value: string } }) => void
}) {
  const options = React.Children.toArray(children).flatMap((child) =>
    React.isValidElement<OptionProps>(child) && child.type === "option"
      ? [{ value: String(child.props.value ?? ""), label: child.props.children, disabled: !!child.props.disabled }]
      : [],
  )
  const toItem = (v: string) => (v === "" ? EMPTY : v)
  const fromItem = (v: string) => (v === EMPTY ? "" : v)
  return (
    <Select
      value={value === undefined ? undefined : toItem(String(value))}
      defaultValue={defaultValue === undefined ? undefined : toItem(String(defaultValue))}
      onValueChange={(v) => {
        const picked = fromItem(v)
        onChange?.({ target: { value: picked }, currentTarget: { value: picked } })
      }}
      disabled={disabled}
      name={name}
      required={required}
    >
      <SelectTrigger
        id={id}
        data-slot="native-select"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        size={compact ? "sm" : "default"}
        className={cn("min-w-0", className)}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={toItem(o.value)} disabled={o.disabled}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { NativeSelect }
