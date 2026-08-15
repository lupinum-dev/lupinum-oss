const urlPattern = /https?:\/\/[^\s<>()"'`]+/gu;

export function hasExactUrl(source, expectedUrl) {
  return [...source.matchAll(urlPattern)].some(([url]) => url === expectedUrl);
}
