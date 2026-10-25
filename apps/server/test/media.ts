import sharp from 'sharp';

/** A real PNG of the given size (solid colour plus a label so images differ). */
export async function png(width = 640, height = 400, color = '#4dabf7', label = 'Explorix test') {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/><text x="20" y="60" font-size="40" font-family="Arial" fill="#fff">${label}</text></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};

/**
 * A structurally valid ISO-BMFF (MP4) container with real mvhd/tkhd metadata and
 * `padBytes` of media data. It is not playable, but is sniffed and probed like a recording.
 */
export function mp4({ durationSeconds = 12.5, width = 1280, height = 720, padBytes = 1024 } = {}) {
  const ftyp = box('ftyp', Buffer.from('isom'), Buffer.from([0, 0, 2, 0]), Buffer.from('isomiso2mp41'));
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12); // timescale
  mvhd.writeUInt32BE(Math.round(durationSeconds * 1000), 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(width * 65536, 76);
  tkhd.writeUInt32BE(height * 65536, 80);
  const moov = box('moov', box('mvhd', mvhd), box('trak', box('tkhd', tkhd)));
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(padBytes, 7))]);
}
