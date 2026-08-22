import { forwardRef } from 'react'

export function parseMoeda(v: string): number {
  if (v == null || v === '') return 0
  let s = String(v).trim()
  if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else {
    s = s.replace(/[^\d.-]/g, '')
  }
  const n = Number(s)
  return isNaN(n) ? 0 : n
}

export function formatarMoeda(n: number): string {
  if (isNaN(n)) return ''
  return n.toFixed(2).replace('.', ',')
}

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoFocus?: boolean
  className?: string
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => boolean | undefined | void
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void
}

const CampoDinheiro = forwardRef<HTMLInputElement, Props>(function CampoDinheiro(
  { value, onChange, placeholder, autoFocus, className, onKeyDown, onClick },
  ref
) {
  return (
    <input
      ref={ref}
      className={className}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={value}
      autoFocus={autoFocus}
      placeholder={placeholder ?? '0,00'}
      onClick={onClick}
      onFocus={(e) => {
        e.target.select()
      }}
      onChange={(e) => {
        const digitos = e.target.value.replace(/[^\d]/g, '').slice(0, 12)
        const n = Number(digitos) / 100
        onChange(Number.isNaN(n) ? '' : formatarMoeda(n))
      }}
      onKeyDown={(e) => {
        if (onKeyDown) {
          const continuar = onKeyDown(e)
          if (continuar === false) return
        }
        if (['Enter', 'Tab', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
        if (e.key.length === 1 && !/[0-9]/.test(e.key)) e.preventDefault()
      }}
    />
  )
})

export default CampoDinheiro
