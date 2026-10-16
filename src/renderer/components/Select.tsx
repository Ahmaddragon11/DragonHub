import React from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export type SelectOption = { value: string; label: string }
export type SelectGroup = { label: string; options: SelectOption[] }

type Props = {
  value: string
  onChange: (value: string) => void
  options?: Array<SelectOption | SelectGroup>
  children?: React.ReactNode
  className?: string
  disabled?: boolean
  id?: string
  title?: string
  name?: string
  'aria-label'?: string
}

const isGroup = (o: SelectOption | SelectGroup): o is SelectGroup => 'options' in o

/** Styled select that paints its own caret element instead of relying on the
 *  CSS background arrow, which tiled into repeated glyphs on native selects. */
export default function Select({ value, onChange, options, children, className, disabled, id, title, name, 'aria-label': ariaLabel }: Props) {
  return (
    <div className={cn('relative flex w-full min-w-0 items-center', className)}>
      <select className="select select-arrowless" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} id={id} title={title} name={name} aria-label={ariaLabel}>
        {options
          ? options.map((o) => isGroup(o)
            ? <optgroup key={o.label} label={o.label}>{o.options.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</optgroup>
            : <option key={o.value} value={o.value}>{o.label}</option>)
          : children}
      </select>
      <ChevronDown size={15} aria-hidden className="pointer-events-none absolute end-3 text-surface-500" />
    </div>
  )
}
