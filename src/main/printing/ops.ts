/**
 * Druck-Befehlsmodell.
 *
 * Layout wird EINMAL erzeugt und dann in drei Ausgaben übersetzt:
 * ESC/POS-Bytes, Epson-ePOS-XML und Monospace-Textvorschau. Damit kann der
 * gedruckte Stimmzettel nicht vom vorab geprüften abweichen.
 */
export interface TextStyle {
  align?: 'left' | 'center' | 'right'
  bold?: boolean
  doubleWidth?: boolean
  doubleHeight?: boolean
  underline?: boolean
  /** Invertiert (weiß auf schwarz) – für Testdruck-Kennzeichnung. */
  invert?: boolean
}

export type PrintOp =
  | ({ type: 'text'; text: string } & TextStyle)
  | { type: 'feed'; lines: number }
  | { type: 'spacing'; dots: number | 'default' }
  | { type: 'cut' }
  /**
   * Ein QR-Code.
   *
   * **Der Drucker zeichnet ihn selbst.** Thermodrucker können das seit
   * Jahrzehnten; ein Bild zu rechnen und als Punktgrafik zu schicken wäre
   * langsamer, gröber und brächte eine Bibliothek ins Projekt, die nur an
   * dieser einen Stelle gebraucht würde.
   *
   * `size` ist die Modulbreite in Punkten (3 bis 8). Bei 80-mm-Papier ergibt
   * 6 einen Code, den jedes Telefon aus einer Handbreit Entfernung liest.
   */
  | { type: 'qr'; data: string; size?: number; align?: 'left' | 'center' | 'right' }

export function text(value: string, style: TextStyle = {}): PrintOp {
  return { type: 'text', text: value, ...style }
}

export function feed(lines = 1): PrintOp {
  return { type: 'feed', lines }
}

export function spacing(dots: number | 'default'): PrintOp {
  return { type: 'spacing', dots }
}

export function cut(): PrintOp {
  return { type: 'cut' }
}

export function qr(data: string, size = 6, align: 'left' | 'center' | 'right' = 'center'): PrintOp {
  return { type: 'qr', data, size, align }
}

/** Bricht Text auf die Zeilenbreite um; Folgezeilen werden eingerückt (Wahlformen §37). */
export function wrapText(value: string, width: number, hangingIndent = 0): string[] {
  if (width <= 0) return [value]
  const words = value.split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  let limit = width

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= limit) {
      current = candidate
      continue
    }
    if (current) lines.push(current)
    limit = width - hangingIndent
    current = word.length > limit ? word.slice(0, limit) : word
    if (word.length > limit) {
      let rest = word.slice(limit)
      while (rest.length > limit) {
        lines.push(current)
        current = rest.slice(0, limit)
        rest = rest.slice(limit)
      }
      if (rest) {
        lines.push(current)
        current = rest
      }
    }
  }
  if (current) lines.push(current)

  return lines.map((line, index) => (index === 0 ? line : ' '.repeat(hangingIndent) + line))
}

export function centerText(value: string, width: number): string {
  if (value.length >= width) return value
  const left = Math.floor((width - value.length) / 2)
  return ' '.repeat(left) + value
}

export function ruler(width: number, char = '-'): string {
  return char.repeat(width)
}

/** Zählt die Druckzeilen – Grundlage der Papierverbrauchsschätzung (§66). */
export function countLines(ops: PrintOp[]): number {
  let lines = 0
  for (const op of ops) {
    if (op.type === 'text') lines += op.doubleHeight ? 2 : 1
    else if (op.type === 'feed') lines += op.lines
    else if (op.type === 'cut') lines += 2
    /* Ein QR-Code ist so hoch wie breit; bei Modulbreite 6 sind das rund
       sieben Textzeilen. Die Schätzung geht in den Papierverbrauch ein. */
    else if (op.type === 'qr') lines += Math.max(4, Math.round((op.size ?? 6) * 1.2))
  }
  return lines
}
