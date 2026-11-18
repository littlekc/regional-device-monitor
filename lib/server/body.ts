export async function readText(body: ReadableStream<Uint8Array> | null, limit: number): Promise<string> {
  if (!body) return ''
  const reader = body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0
  let text = ''
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) return text + decoder.decode()
      size += next.value.byteLength
      if (size > limit) throw new Error('Response or request exceeds byte limit.')
      text += decoder.decode(next.value, { stream: true })
    }
  } catch (error) {
    void reader.cancel().catch(() => {})
    throw error
  } finally {
    reader.releaseLock()
  }
}
