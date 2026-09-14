import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          /* Die Begleitanwendung hat einen eigenen Hauptprozess, teilt sich
             aber alles unter `src/shared` mit dem Hauptrechner. */
          saal: resolve(__dirname, 'src/saal/index.ts')
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
          saal: resolve(__dirname, 'src/preload/saal.ts')
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
    plugins: [react()]
  }
})
