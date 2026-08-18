/**
 * ESC/POS über den Windows-Spooler (USB-Drucker mit Epson-Treiber).
 *
 * Die Bytes werden als RAW-Datentyp übergeben, damit der Treiber sie
 * unverändert an das Gerät reicht. Umgesetzt über die Windows-Druck-API
 * (winspool.drv) via PowerShell — kein natives Zusatzmodul, das den Offline-
 * Installer belasten würde.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { PrinterConfig, PrinterTestResult } from '@shared/types'
import { logger } from '../../logger'
import { appPaths } from '../../paths'
import { encodeDocument } from '../escpos'
import type { PrintOp } from '../ops'
import { PrinterError, type PrinterDriver } from './types'

const RAW_PRINT_SCRIPT = String.raw`
param([Parameter(Mandatory=$true)][string]$PrinterName, [Parameter(Mandatory=$true)][string]$FilePath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;

public static class RawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DOCINFOW {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.Drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);
    [DllImport("winspool.Drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFOW di);
    [DllImport("winspool.Drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);
    [DllImport("winspool.Drv", EntryPoint = "WritePrinter", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static void SendBytes(string printerName, byte[] bytes) {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("Drucker konnte nicht geöffnet werden: " + Marshal.GetLastWin32Error());
        try {
            DOCINFOW di = new DOCINFOW();
            di.pDocName = "Wahlzettel";
            di.pDataType = "RAW";
            if (!StartDocPrinter(hPrinter, 1, ref di))
                throw new Exception("StartDocPrinter fehlgeschlagen: " + Marshal.GetLastWin32Error());
            try {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("StartPagePrinter fehlgeschlagen: " + Marshal.GetLastWin32Error());
                IntPtr buffer = Marshal.AllocCoTaskMem(bytes.Length);
                try {
                    Marshal.Copy(bytes, 0, buffer, bytes.Length);
                    int written;
                    if (!WritePrinter(hPrinter, buffer, bytes.Length, out written))
                        throw new Exception("WritePrinter fehlgeschlagen: " + Marshal.GetLastWin32Error());
                    if (written != bytes.Length)
                        throw new Exception("Es wurden nur " + written + " von " + bytes.Length + " Bytes übergeben.");
                } finally {
                    Marshal.FreeCoTaskMem(buffer);
                }
                EndPagePrinter(hPrinter);
            } finally {
                EndDocPrinter(hPrinter);
            }
        } finally {
            ClosePrinter(hPrinter);
        }
    }
}
'@
[RawPrinter]::SendBytes($PrinterName, [System.IO.File]::ReadAllBytes($FilePath))
Write-Output "OK"
`

/**
 * Führt ein PowerShell-Skript aus. Das Skript wird in eine temporäre Datei
 * geschrieben und mit -File aufgerufen, damit `param(...)` korrekt gebunden wird
 * und Druckernamen mit Leerzeichen oder Anführungszeichen sicher ankommen.
 */
function runPowerShell(script: string, args: string[], timeoutMs = 30000): Promise<string> {
  const scriptFile = join(appPaths().temp, `ps-${randomUUID()}.ps1`)
  // BOM, damit PowerShell die Datei zuverlässig als UTF-8 liest.
  writeFileSync(scriptFile, `﻿${script}`, 'utf8')

  return new Promise<string>((resolve, reject) => {
    const child = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, ...args],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new PrinterError(`Windows-Druck fehlgeschlagen: ${stderr.trim() || error.message}`, true))
          return
        }
        resolve(stdout.trim())
      }
    )
    child.on('error', (error) => reject(new PrinterError(`PowerShell nicht verfügbar: ${error.message}`, false)))
  }).finally(() => {
    try {
      unlinkSync(scriptFile)
    } catch {
      // Aufräumen ist best effort.
    }
  })
}

const PRINTER_STATUS_SCRIPT = String.raw`
param([Parameter(Mandatory=$true)][string]$PrinterName)
$ErrorActionPreference = 'Stop'
$printer = Get-CimInstance -ClassName Win32_Printer | Where-Object { $_.Name -eq $PrinterName }
if ($null -eq $printer) { Write-Output 'NOTFOUND'; exit 0 }
Write-Output ("{0}|{1}|{2}" -f $printer.WorkOffline, $printer.PrinterStatus, $printer.DetectedErrorState)
`

const PRINTER_LIST_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Get-CimInstance -ClassName Win32_Printer | Select-Object -ExpandProperty Name
`

export class EscPosWindowsPrinter implements PrinterDriver {
  constructor(readonly config: PrinterConfig) {
    if (!config.windowsPrinterName) {
      throw new PrinterError('Für den Windows-Treiber muss der exakte Druckername hinterlegt sein.', false)
    }
  }

  async status(): Promise<PrinterTestResult> {
    if (process.platform !== 'win32') {
      return { ok: false, message: 'Dieser Treiber ist nur unter Windows verfügbar.' }
    }
    const name = this.config.windowsPrinterName as string
    try {
      const output = await runPowerShell(PRINTER_STATUS_SCRIPT, [name], 15000)
      if (output === 'NOTFOUND') {
        return {
          ok: false,
          message: `Der Drucker "${name}" ist unter Windows nicht eingerichtet.`,
          details: { drucker: name }
        }
      }
      const [offline, printerStatus, errorState] = output.split('|')
      const isOffline = offline.toLowerCase() === 'true'
      // DetectedErrorState: 4 = Papierstau, 5 = kein Papier, 6 = Ausgabe voll
      const paperOut = errorState === '5'
      return {
        ok: !isOffline && !paperOut,
        message: isOffline
          ? `Der Drucker "${name}" ist offline.`
          : paperOut
            ? `Der Drucker "${name}" meldet Papierende.`
            : `Der Drucker "${name}" ist bereit.`,
        details: { drucker: name, offline: isOffline, papierLeer: paperOut, windowsStatus: printerStatus }
      }
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'Statusabfrage fehlgeschlagen.',
        details: { drucker: name }
      }
    }
  }

  async submit(ops: PrintOp[], meta: { label: string }): Promise<void> {
    if (process.platform !== 'win32') {
      throw new PrinterError('Windows-Druck ist auf diesem Betriebssystem nicht verfügbar.', false)
    }
    const payload = encodeDocument(ops, this.config)
    const file = join(appPaths().temp, `print-${randomUUID()}.bin`)
    writeFileSync(file, payload)
    try {
      await runPowerShell(RAW_PRINT_SCRIPT, [this.config.windowsPrinterName as string, file])
    } catch (error) {
      logger.printer.error(`Windows-Druck (${meta.label}) fehlgeschlagen: ${String(error)}`)
      throw error
    } finally {
      try {
        unlinkSync(file)
      } catch {
        // Temporärdatei aufzuräumen ist best effort.
      }
    }
  }
}

/** Liste der unter Windows eingerichteten Drucker (für die Konfiguration). */
export async function listWindowsPrinters(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  try {
    const output = await runPowerShell(PRINTER_LIST_SCRIPT, [], 15000)
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}
