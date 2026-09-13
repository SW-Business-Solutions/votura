/**
 * Der Hauptrechner meldet sich, wenn er gerufen wird.
 *
 * Ein Gerät im Saal soll nicht mit einer abgetippten IP-Adresse anfangen
 * müssen. Es ruft ins Netz, wer da ist; dieser Dienst antwortet — mit Namen,
 * Port, Bühnen und der Auskunft, ob ein Token nötig ist.
 *
 * ## Was hier bewusst fehlt
 *
 * Das **Zugriffstoken**. Wer den Ruf hört, ist im selben Netz, mehr nicht.
 * Es mitzuschicken hieße, es an jeden zu verteilen, der fragt — und damit
 * wäre es keines mehr. Gesagt wird nur, ob eines gebraucht wird.
 *
 * Der Dienst läuft nur, solange auch die Netzwerkansicht läuft: Ohne sie gibt
 * es nichts anzuzeigen, und ein Rechner, der still sein soll, soll auch nicht
 * antworten.
 */
import { createSocket, type Socket } from 'node:dgram'
import { istSaalAntwort, SUCHRUF, SUCHRUF_PORT, type SaalAntwort } from '@shared/saal'
import { logger } from './logger'

let socket: Socket | null = null

/** Woher die Antwort ihre Angaben nimmt. */
export interface SuchrufQuelle {
  name: () => string
  port: () => number
  version: () => string
  tokenNoetig: () => boolean
  buehnen: () => { id: number; name: string }[]
  prompterBedienung: () => boolean
}

export async function starteSuchruf(quelle: SuchrufQuelle): Promise<void> {
  await stoppeSuchruf()

  const neu = createSocket({ type: 'udp4', reuseAddr: true })

  neu.on('message', (nachricht, absender) => {
    if (nachricht.toString('utf8').trim() !== SUCHRUF) return
    const antwort: SaalAntwort = {
      votura: SUCHRUF,
      name: quelle.name(),
      port: quelle.port(),
      version: quelle.version(),
      tokenNoetig: quelle.tokenNoetig(),
      buehnen: quelle.buehnen(),
      prompterBedienung: quelle.prompterBedienung()
    }
    /* Zurück genau an den, der gefragt hat — nicht wieder an alle. */
    neu.send(JSON.stringify(antwort), absender.port, absender.address, (fehler) => {
      if (fehler) logger.warn(`Suchruf-Antwort an ${absender.address} fehlgeschlagen: ${fehler.message}`)
    })
  })

  neu.on('error', (fehler) => {
    logger.warn(`Suchruf-Dienst: ${fehler.message}`)
    void stoppeSuchruf()
  })

  await new Promise<void>((fertig, fehlgeschlagen) => {
    neu.once('error', fehlgeschlagen)
    neu.bind(SUCHRUF_PORT, () => {
      neu.setBroadcast(true)
      fertig()
    })
  })

  socket = neu
  logger.info(`Suchruf-Dienst antwortet auf UDP ${SUCHRUF_PORT}`)
}

export async function stoppeSuchruf(): Promise<void> {
  if (!socket) return
  const alt = socket
  socket = null
  await new Promise<void>((fertig) => alt.close(fertig))
  logger.info('Suchruf-Dienst beendet.')
}

/**
 * Ruft ins Netz und sammelt, wer sich meldet.
 *
 * Wird auch vom Hauptrechner gebraucht — zur Selbstprüfung im Systemcheck:
 * Wer hier nichts findet, findet es auch im Saal nicht.
 */
export async function sucheHauptrechner(
  wartezeitMs = 1500
): Promise<{ adresse: string; antwort: SaalAntwort }[]> {
  const socket = createSocket({ type: 'udp4', reuseAddr: true })
  const funde = new Map<string, SaalAntwort>()

  socket.on('message', (nachricht, absender) => {
    try {
      const gelesen: unknown = JSON.parse(nachricht.toString('utf8'))
      if (istSaalAntwort(gelesen)) funde.set(absender.address, gelesen)
    } catch {
      /* Fremder Verkehr auf demselben Port — nicht unsere Sache. */
    }
  })

  await new Promise<void>((fertig) => socket.bind(fertig))
  socket.setBroadcast(true)
  socket.send(SUCHRUF, SUCHRUF_PORT, '255.255.255.255')

  await new Promise((fertig) => setTimeout(fertig, wartezeitMs))
  socket.close()

  return [...funde].map(([adresse, antwort]) => ({ adresse, antwort }))
}
