/**
 * Eine eigene Konfiguration für die Lastprobe.
 *
 * Der gewöhnliche Prüflauf schließt sie aus (`vitest.config.ts`), denn
 * fünfhundert Abläufe über eine echte Leitung dauern Minuten — und ein
 * Prüflauf, der Minuten braucht, wird irgendwann übersprungen. Der Ausschluss
 * lässt sich über die Befehlszeile aber nicht wieder aufheben; deshalb steht
 * sie hier für sich.
 *
 *     npm run lastprobe
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    environment: 'node',
    include: ['tests/lastprobe.test.ts'],
    globals: false,
    /* Eine Versammlung nach der anderen: Zwei Lastproben gleichzeitig würden
       sich gegenseitig messen. */
    fileParallelism: false,
    testTimeout: 900_000,
    hookTimeout: 600_000
  }
})
