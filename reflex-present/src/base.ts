// The app is served from '/' by the dev server and from '/axis/' on GitHub Pages
// (vite.config.ts takes the base from BASE_PATH). Routes and public files go through these.

const BASE = import.meta.env.BASE_URL

/** A path inside the app, e.g. at('/pitch') → '/axis/pitch' on GitHub Pages. */
export const at = (path: string) => BASE + path.replace(/^\//, '')

/** The current route without the base or a trailing slash, e.g. '/pitch' ('/' for the presenter board). */
export const currentRoute = () => '/' + window.location.pathname.slice(BASE.length).replace(/\/+$/, '')
