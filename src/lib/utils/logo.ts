let cachedLogoDataUri: string | null = null

export async function getLogoDataUri(): Promise<string> {
  if (cachedLogoDataUri) return cachedLogoDataUri

  try {
    const response = await fetch('/logo-black.png')
    const blob = await response.blob()
    const buffer = await blob.arrayBuffer()
    const base64 = btoa(
      new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    )
    cachedLogoDataUri = `data:image/png;base64,${base64}`
    return cachedLogoDataUri
  } catch {
    return ''
  }
}
