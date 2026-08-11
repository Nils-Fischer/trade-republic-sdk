const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeUtf8(value: string): number[] {
  const bytes: number[] = [];
  for (const symbol of value) {
    const point = symbol.codePointAt(0)!;
    if (point <= 0x7f) {
      bytes.push(point);
    } else if (point <= 0x7ff) {
      bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
    } else if (point <= 0xffff) {
      bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
    } else {
      bytes.push(
        0xf0 | (point >> 18),
        0x80 | ((point >> 12) & 0x3f),
        0x80 | ((point >> 6) & 0x3f),
        0x80 | (point & 0x3f),
      );
    }
  }
  return bytes;
}

function decodeUtf8(bytes: readonly number[]): string {
  let value = "";
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index++]!;
    let point: number;
    let remaining: number;
    if (first <= 0x7f) {
      point = first;
      remaining = 0;
    } else if ((first & 0xe0) === 0xc0) {
      point = first & 0x1f;
      remaining = 1;
    } else if ((first & 0xf0) === 0xe0) {
      point = first & 0x0f;
      remaining = 2;
    } else if ((first & 0xf8) === 0xf0) {
      point = first & 0x07;
      remaining = 3;
    } else {
      throw new Error("Invalid UTF-8");
    }
    for (let offset = 0; offset < remaining; offset += 1) {
      const continuation = bytes[index++];
      if (continuation === undefined || (continuation & 0xc0) !== 0x80) {
        throw new Error("Invalid UTF-8");
      }
      point = (point << 6) | (continuation & 0x3f);
    }
    value += String.fromCodePoint(point);
  }
  return value;
}

export function encodeBase64(value: string): string {
  const bytes = encodeUtf8(value);
  let encoded = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    encoded += BASE64_ALPHABET[first >> 2];
    encoded += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    encoded +=
      second === undefined ? "=" : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    encoded += third === undefined ? "=" : BASE64_ALPHABET[third & 0x3f];
  }
  return encoded;
}

export function decodeBase64(value: string): string {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error("Invalid Base64");
  }
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 4) {
    const first = BASE64_ALPHABET.indexOf(value[index]!);
    const second = BASE64_ALPHABET.indexOf(value[index + 1]!);
    const third = value[index + 2] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[index + 2]!);
    const fourth = value[index + 3] === "=" ? 0 : BASE64_ALPHABET.indexOf(value[index + 3]!);
    if (first < 0 || second < 0 || third < 0 || fourth < 0) throw new Error("Invalid Base64");
    bytes.push((first << 2) | (second >> 4));
    if (value[index + 2] !== "=") bytes.push(((second & 0x0f) << 4) | (third >> 2));
    if (value[index + 3] !== "=") bytes.push(((third & 0x03) << 6) | fourth);
  }
  return decodeUtf8(bytes);
}
