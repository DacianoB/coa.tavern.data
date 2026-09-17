function encodeIconPathSegment(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

export function iconNameToUrl(icon: string | null | undefined) {
  if (!icon) {
    return null;
  }

  if (/^https?:\/\//i.test(icon) || icon.startsWith('/')) {
    return icon;
  }

  const iconName =
    icon
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      ?.replace(/\.(jpg|jpeg|png|webp|blp)$/i, '')
      .toLowerCase() ?? '';

  return iconName
    ? `/game-icons/medium/${encodeIconPathSegment(iconName)}.jpg`
    : null;
}
