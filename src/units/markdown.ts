// Fenced code blocks and inline code spans become spaces of the same length, so offsets, lines
// and columns found in the result still point into the original text.
export function maskCode(markdown: string): string {
  let fence: string | null = null;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence !== null) {
        if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && line.trim() === marker) fence = null;
        return ' '.repeat(line.length);
      }
      if (marker !== undefined) {
        fence = marker;
        return ' '.repeat(line.length);
      }
      return line.replace(/(?<!`)(`+)(.*?[^`])\1(?!`)/g, (span) => ' '.repeat(span.length));
    })
    .join('\n');
}
