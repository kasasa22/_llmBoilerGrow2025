export function isThinContent(text: string, minChars: number): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return text.trim().length < minChars || words.length < Math.max(20, Math.floor(minChars / 8));
}
