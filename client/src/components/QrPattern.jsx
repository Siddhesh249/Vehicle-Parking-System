// QR-style visual for the ticket (VPS-F-016). Deterministic pattern derived from the payload;
// it is a visual stand-in, not a scannable QR code.
const SIZE = 21;

function bitsFor(value) {
  let seed = 2166136261;
  for (const ch of value) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  const finder = (x, y) => {
    const inBox = (ox, oy) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7;
    const box = (ox, oy) => {
      const dx = x - ox;
      const dy = y - oy;
      const edge = dx === 0 || dx === 6 || dy === 0 || dy === 6;
      const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
      return edge || core;
    };
    if (inBox(0, 0)) return box(0, 0);
    if (inBox(SIZE - 7, 0)) return box(SIZE - 7, 0);
    if (inBox(0, SIZE - 7)) return box(0, SIZE - 7);
    return null;
  };
  const cells = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      const fixed = finder(x, y);
      if (fixed ?? (seed & 1) === 1) cells.push([x, y]);
    }
  }
  return cells;
}

export default function QrPattern({ value }) {
  const cells = bitsFor(value);
  return (
    <svg
      className="qr-pattern"
      viewBox={`-1 -1 ${SIZE + 2} ${SIZE + 2}`}
      role="img"
      aria-label="QR-style code for this ticket"
      shapeRendering="crispEdges"
    >
      <rect x="-1" y="-1" width={SIZE + 2} height={SIZE + 2} fill="#fff" />
      {cells.map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#000" />
      ))}
    </svg>
  );
}
