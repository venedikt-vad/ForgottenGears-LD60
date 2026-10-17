export const FONT_FAMILY = 'IBMBios'
export const LOST_LANGUAGE_FAMILY = 'VVF01_LostLanguage'

const FONT_SOURCES: Record<string, string> = {
  [FONT_FAMILY]: `${import.meta.env.BASE_URL}web_ibm_bios-s5396Krr.woff`,
  [LOST_LANGUAGE_FAMILY]: `${import.meta.env.BASE_URL}VVF01_LostLanguage.ttf`,
}

const loadPromises = new Map<string, Promise<void>>()

export function loadFont(family: string = FONT_FAMILY): Promise<void> {
  const existing = loadPromises.get(family)
  if (existing) return existing

  const url = FONT_SOURCES[family]

  let promise: Promise<void>
  if (!url || typeof document === 'undefined' || !('fonts' in document)) {
    promise = Promise.resolve()
  } else {
    const face = new FontFace(family, `url("${url}")`)
    promise = face
      .load()
      .then((loaded) => {
        document.fonts.add(loaded)
      })
      .catch((err) => {
        console.error(`Failed to load font "${family}" from ${url}`, err)
      })
  }

  loadPromises.set(family, promise)
  return promise
}
