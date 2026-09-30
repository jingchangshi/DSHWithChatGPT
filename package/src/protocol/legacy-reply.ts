/** Extract the last [D2C] envelope from a conversational reply. */
export function extractEnvelopeText(reply: string): string | null {
  const index = reply.lastIndexOf('[D2C]')
  if (index < 0) return null
  return reply.slice(index)
}
