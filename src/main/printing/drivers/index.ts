import type { PrinterConfig } from '@shared/types'
import { EpsonEposPrinter } from './epson-epos'
import { EscPosNetworkPrinter } from './escpos-network'
import { EscPosWindowsPrinter } from './escpos-windows'
import { FileOutputPrinter } from './file-output'
import type { PrinterDriver } from './types'

export function createDriver(config: PrinterConfig): PrinterDriver {
  switch (config.kind) {
    case 'epson_epos':
      return new EpsonEposPrinter(config)
    case 'escpos_network':
      return new EscPosNetworkPrinter(config)
    case 'escpos_windows':
      return new EscPosWindowsPrinter(config)
    case 'pdf_file':
      return new FileOutputPrinter(config)
  }
}

export { listWindowsPrinters } from './escpos-windows'
export { PrinterError } from './types'
export type { PrinterDriver } from './types'
