export const FONT_FAMILY = 'IBMBios'

const FONT_URL = `${import.meta.env.BASE_URL}web_ibm_bios-s5396Krr.woff`

let loadPromise: Promise<void> | null = null

export function loadFont(family: string = FONT_FAMILY): Promise<void> {
  if (loadPromise) return loadPromise

  if (typeof document === 'undefined' || !('fonts' in document)) {
    loadPromise = Promise.resolve()
    return loadPromise
  }

  const face = new FontFace(family, `url("${FONT_URL}")`)
  loadPromise = face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded)
    })
    .catch((err) => {
      console.error(`Failed to load font "${family}" from ${FONT_URL}`, err)
    })

  return loadPromise
}
