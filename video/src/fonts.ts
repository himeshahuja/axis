import { continueRender, delayRender, staticFile } from 'remotion'

// The site's faces (DM Sans, Gravitas One), bundled locally so renders never depend on
// the network. Rendering waits until both are loaded.
let started = false
export function loadFonts() {
  if (started || typeof document === 'undefined') return
  started = true
  const handle = delayRender('fonts')
  const faces = [
    new FontFace('DM Sans', `url(${staticFile('fonts/DMSans-wght.woff2')}) format('woff2')`, { weight: '100 1000' }),
    new FontFace('Gravitas One', `url(${staticFile('fonts/GravitasOne.woff2')}) format('woff2')`, { weight: '400' }),
  ]
  Promise.all(faces.map((f) => f.load()))
    .then((loaded) => {
      loaded.forEach((f) => (document.fonts as unknown as Set<FontFace>).add(f))
      return document.fonts.ready
    })
    .then(() => continueRender(handle))
    .catch((err) => {
      console.error(err)
      continueRender(handle)
    })
}
