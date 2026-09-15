import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs'
import type { ServerResponse } from 'node:http'
import { extname, join, resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import type { Plugin, ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { SPRACHMODELL_PFAD } from './src/shared/sprachmodell'

/**
 * Das Sprachmodell in der Entwicklungsfassung.
 *
 * Im fertigen Programm liefert der Hauptprozess es unter dem Pultschema aus —
 * mit der vollen Suchreihenfolge: erst das selbst hinterlegte Modell, dann das
 * mitgelieferte. Beim Entwickeln kommt die Prompterseite aber vom
 * Vite-Server, der von alledem nichts weiß: Die Erkennung lief ins Leere, und
 * am Pult stand „Kein Sprachmodell hinterlegt", obwohl eines danebenlag.
 *
 * Der Server reicht deshalb das mitgelieferte Archiv durch. Nur dieses eine —
 * ein selbst hinterlegtes liegt im Benutzerordner des Betriebssystems, und
 * dessen Pfad hier nachzubauen hieße, eine Regel an zwei Stellen zu pflegen.
 */
function sprachmodellImEntwurf(): Plugin {
  const ordner = resolve(__dirname, 'resources', 'sprachmodell')
  return {
    name: 'votura-sprachmodell-entwurf',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(SPRACHMODELL_PFAD, (_anfrage, antwort: ServerResponse) => {
        const archiv = existsSync(ordner)
          ? readdirSync(ordner)
              .filter((name) => /^\.(zip|gz|tgz)$/i.test(extname(name)))
              .sort()[0]
          : undefined
        if (!archiv) {
          antwort.statusCode = 404
          antwort.end('Kein Sprachmodell in resources/sprachmodell.')
          return
        }
        const datei = join(ordner, archiv)
        antwort.setHeader('Content-Type', 'application/octet-stream')
        antwort.setHeader('Content-Length', String(statSync(datei).size))
        antwort.setHeader('Cache-Control', 'no-store')
        createReadStream(datei).pipe(antwort)
      })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          /* Die Begleitanwendung hat einen eigenen Hauptprozess, teilt sich
             aber alles unter `src/shared` mit dem Hauptrechner. */
          saal: resolve(__dirname, 'src/saal/index.ts'),
          /* Der Kameraempfänger läuft als eigener Prozess — fremder, nativer
             Code gehört nicht in den, der die Wahl führt. */
          'kamera-empfaenger': resolve(__dirname, 'src/ndi/empfaenger.ts')
        }
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
          audience: resolve(__dirname, 'src/preload/audience.ts'),
          prompter: resolve(__dirname, 'src/preload/prompter.ts'),
          teleprompter: resolve(__dirname, 'src/preload/teleprompter.ts'),
          saal: resolve(__dirname, 'src/preload/saal.ts'),
          /* Kamerabilder empfängt ein Gerät im Saal selbst — siehe
             src/preload/saal-kamera.ts. */
          'saal-kamera': resolve(__dirname, 'src/preload/saal-kamera.ts'),
          /* Das Fenster, das für die Untertitel zuhört — die schmalste
             Brücke im Programm, weil dieses Fenster ein Mikrofon hat. */
          zuhoerer: resolve(__dirname, 'src/preload/zuhoerer.ts')
        },
        output: { format: 'cjs', entryFileNames: '[name].js' }
      }
    },
    resolve: {
      alias: { '@shared': resolve(__dirname, 'src/shared') }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          audience: resolve(__dirname, 'src/renderer/audience.html'),
          prompter: resolve(__dirname, 'src/renderer/prompter.html'),
          teleprompter: resolve(__dirname, 'src/renderer/teleprompter.html'),
          /* Versteckt und ohne Oberfläche: Es hält Mikrofon und Erkennung für
             die Untertitel. Läuft wie das Pult unter eigenem Schema — unter
             `file://` gäbe es weder Mikrofon noch Worker. */
          zuhoerer: resolve(__dirname, 'src/renderer/zuhoerer.html'),
          einrichtung: resolve(__dirname, 'src/renderer/einrichtung.html'),
          /* Die Seite für das Telefon eines Teilnehmers. Sie wird nicht in
             einem Fenster geöffnet, sondern über das Netz ausgeliefert. */
          wahl: resolve(__dirname, 'src/renderer/wahl.html'),
          /* Das Gerät des Wahlausschusses — es hält den Schlüssel. */
          ausschuss: resolve(__dirname, 'src/renderer/ausschuss.html')
        }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'src/shared'),
        '@': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react(), sprachmodellImEntwurf()]
  }
})
