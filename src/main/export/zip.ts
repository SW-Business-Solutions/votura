/**
 * Minimaler ZIP-Schreiber (Deflate) für das Archivpaket (§32).
 * Bewusst ohne Fremdbibliothek – das Archiv muss offline und ohne Zusatzsoftware
 * erzeugbar sein.
 */
import { deflateRawSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'

interface Entry {
  name: string
  data: Buffer
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index++) {
    let value = index
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

function crc32(data: Buffer): number {
  let crc = 0xffffffff
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2) & 0x1f)
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: day }
}

export class ZipWriter {
  private entries: Entry[] = []

  add(name: string, data: Buffer | string): void {
    this.entries.push({
      name: name.replace(/\\/g, '/'),
      data: typeof data === 'string' ? Buffer.from(data, 'utf8') : data
    })
  }

  toBuffer(now = new Date()): Buffer {
    const { time, date } = dosDateTime(now)
    const locals: Buffer[] = []
    const centrals: Buffer[] = []
    let offset = 0

    for (const entry of this.entries) {
      const nameBytes = Buffer.from(entry.name, 'utf8')
      const compressed = deflateRawSync(entry.data)
      const useDeflate = compressed.length < entry.data.length
      const payload = useDeflate ? compressed : entry.data
      const method = useDeflate ? 8 : 0
      const crc = crc32(entry.data)

      const localHeader = Buffer.alloc(30)
      localHeader.writeUInt32LE(0x04034b50, 0)
      localHeader.writeUInt16LE(20, 4) // Version
      localHeader.writeUInt16LE(0x0800, 6) // UTF-8-Flag
      localHeader.writeUInt16LE(method, 8)
      localHeader.writeUInt16LE(time, 10)
      localHeader.writeUInt16LE(date, 12)
      localHeader.writeUInt32LE(crc, 14)
      localHeader.writeUInt32LE(payload.length, 18)
      localHeader.writeUInt32LE(entry.data.length, 22)
      localHeader.writeUInt16LE(nameBytes.length, 26)
      localHeader.writeUInt16LE(0, 28)

      locals.push(localHeader, nameBytes, payload)

      const centralHeader = Buffer.alloc(46)
      centralHeader.writeUInt32LE(0x02014b50, 0)
      centralHeader.writeUInt16LE(20, 4)
      centralHeader.writeUInt16LE(20, 6)
      centralHeader.writeUInt16LE(0x0800, 8)
      centralHeader.writeUInt16LE(method, 10)
      centralHeader.writeUInt16LE(time, 12)
      centralHeader.writeUInt16LE(date, 14)
      centralHeader.writeUInt32LE(crc, 16)
      centralHeader.writeUInt32LE(payload.length, 20)
      centralHeader.writeUInt32LE(entry.data.length, 24)
      centralHeader.writeUInt16LE(nameBytes.length, 28)
      centralHeader.writeUInt16LE(0, 30)
      centralHeader.writeUInt16LE(0, 32)
      centralHeader.writeUInt16LE(0, 34)
      centralHeader.writeUInt16LE(0, 36)
      centralHeader.writeUInt32LE(0, 38)
      centralHeader.writeUInt32LE(offset, 42)

      centrals.push(centralHeader, nameBytes)
      offset += localHeader.length + nameBytes.length + payload.length
    }

    const centralBuffer = Buffer.concat(centrals)
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(0, 4)
    end.writeUInt16LE(0, 6)
    end.writeUInt16LE(this.entries.length, 8)
    end.writeUInt16LE(this.entries.length, 10)
    end.writeUInt32LE(centralBuffer.length, 12)
    end.writeUInt32LE(offset, 16)
    end.writeUInt16LE(0, 20)

    return Buffer.concat([Buffer.concat(locals), centralBuffer, end])
  }

  writeTo(file: string): number {
    const buffer = this.toBuffer()
    writeFileSync(file, buffer)
    return buffer.length
  }
}
