/** Grafiken werden von Vite als URL eingebunden und mitgebündelt (offline). */
declare module '*.svg' {
  const url: string
  export default url
}
