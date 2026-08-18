/**
 * PDF-Erzeugung über ein unsichtbares Fenster (Chromium-Renderer).
 * Keine externe Bibliothek, keine Netzverbindung, keine externen Schriften —
 * es werden ausschließlich Systemschriften verwendet (§2.2).
 */
import { BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'

export async function htmlToPdf(html: string, target: string, landscape = false): Promise<string> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, sandbox: true, contextIsolation: true }
  })
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    const buffer = await window.webContents.printToPDF({
      pageSize: 'A4',
      landscape,
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
    })
    writeFileSync(target, buffer)
    return target
  } finally {
    window.destroy()
  }
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Gemeinsames Grundlayout aller PDF-Ausgaben: schwarz auf weiß, gut lesbar. */
export function documentShell(title: string, body: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Arial, sans-serif; color: #000; background: #fff; font-size: 11pt; line-height: 1.45; }
  h1 { font-size: 18pt; margin: 0 0 4pt; }
  h2 { font-size: 13pt; margin: 16pt 0 6pt; border-bottom: 1px solid #000; padding-bottom: 2pt; }
  h3 { font-size: 11.5pt; margin: 12pt 0 4pt; }
  table { width: 100%; border-collapse: collapse; margin: 6pt 0; }
  th, td { border: 1px solid #666; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  th { background: #eee; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  .meta { color: #333; font-size: 9.5pt; }
  .mono { font-family: "Consolas", "Courier New", monospace; font-size: 9pt; white-space: pre-wrap; }
  .ballot { border: 1px solid #000; padding: 8pt; width: 78mm; font-family: "Consolas", "Courier New", monospace;
            font-size: 8.5pt; line-height: 1.35; white-space: pre; }
  .hint { border-left: 3px solid #000; padding: 4pt 8pt; margin: 8pt 0; background: #f4f4f4; font-size: 9.5pt; }
  .footer { margin-top: 18pt; font-size: 8.5pt; color: #333; border-top: 1px solid #999; padding-top: 4pt; }
  ul { margin: 4pt 0 4pt 14pt; padding: 0; }
</style></head><body>${body}</body></html>`
}
