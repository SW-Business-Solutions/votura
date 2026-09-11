/**
 * Der Arbeiter-Bau von pdf.js hat keine Typdeklaration.
 *
 * Er wird hier absichtlich als gewöhnliches Modul geladen, nicht als Worker:
 * Die Anwendung läuft aus `file://`, und ein echter Worker von dort wird von
 * Chromium abgewiesen. pdf.js sucht seinen Nachrichtenbehandler dann unter
 * `globalThis.pdfjsWorker` — siehe PdfFrame.tsx.
 */
declare module 'pdfjs-dist/build/pdf.worker.mjs' {
  export const WorkerMessageHandler: unknown
}
