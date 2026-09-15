import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /*
     * Die Lastprobe läuft nicht mit.
     *
     * Fünfhundert Abläufe über eine echte Leitung dauern Minuten. Ein
     * Prüflauf, der Minuten braucht, wird irgendwann übersprungen — und dann
     * fehlen auch die 500 kurzen Prüfungen daneben. Sie läuft deshalb auf
     * Aufforderung: `npm run lastprobe`.
     */
    exclude: ['tests/lastprobe.test.ts', '**/node_modules/**'],
    globals: false
  }
})
