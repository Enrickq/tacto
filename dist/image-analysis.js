import { t } from './i18n.js';

const MAX_PIXELS = 1_000_000;
const MAX_SUGGESTIONS = 6;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

function validAnalysis(analysis) {
  if (!analysis || !Number.isInteger(analysis.width) || !Number.isInteger(analysis.height)
    || analysis.width < 1 || analysis.height < 1) return false;
  const size = analysis.width * analysis.height;
  return size <= MAX_PIXELS && analysis.luminance?.length >= size
    && analysis.edges?.length >= size && analysis.contrast?.length >= size
    && analysis.rgb?.length >= size * 3;
}

/**
 * Pure pixel analysis, not object recognition. RGBA is composited onto white.
 * Brightness uses an approximate, encoded-RGB luma; Sobel edges and contrast
 * describe local changes, not semantic contours, depth, texture or meaning.
 */
export function analyzeImageData(imageData) {
  const { width, height, data } = imageData ?? {};
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(t('scan.dimensions'));
  }
  const pixelCount = width * height;
  if (!Number.isSafeInteger(pixelCount) || pixelCount > MAX_PIXELS) {
    throw new RangeError(t('scan.tooManyPixels'));
  }
  if (!ArrayBuffer.isView(data) || data.BYTES_PER_ELEMENT !== 1 || data.length < pixelCount * 4) {
    throw new TypeError(t('scan.buffer'));
  }

  const luminance = new Uint8Array(pixelCount);
  const edges = new Uint8Array(pixelCount);
  const contrast = new Uint8Array(pixelCount);
  const rgb = new Uint8Array(pixelCount * 3);
  let sum = 0;
  let squareSum = 0;
  for (let i = 0; i < pixelCount; i++) {
    const source = i * 4;
    const destination = i * 3;
    const alpha = data[source + 3] / 255;
    const red = Math.round(data[source] * alpha + 255 * (1 - alpha));
    const green = Math.round(data[source + 1] * alpha + 255 * (1 - alpha));
    const blue = Math.round(data[source + 2] * alpha + 255 * (1 - alpha));
    rgb[destination] = red;
    rgb[destination + 1] = green;
    rgb[destination + 2] = blue;
    const value = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    luminance[i] = value;
    sum += value;
    squareSum += value * value;
  }

  let edgeSum = 0;
  let maxEdge = 0;
  // The outer one-pixel margin remains zero: it has no full 3×3 neighbourhood.
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const a = luminance[i - width - 1];
      const b = luminance[i - width];
      const c = luminance[i - width + 1];
      const d = luminance[i - 1];
      const e = luminance[i];
      const f = luminance[i + 1];
      const g = luminance[i + width - 1];
      const h = luminance[i + width];
      const j = luminance[i + width + 1];
      const gx = -a - 2 * d - g + c + 2 * f + j;
      const gy = -a - 2 * b - c + g + 2 * h + j;
      const strength = Math.min(255, Math.round(Math.hypot(gx, gy) / 4));
      edges[i] = strength;
      contrast[i] = Math.max(a, b, c, d, e, f, g, h, j) - Math.min(a, b, c, d, e, f, g, h, j);
      edgeSum += strength;
      if (strength > maxEdge) maxEdge = strength;
    }
  }

  const meanLuminance = sum / pixelCount;
  return {
    width, height, pixelCount, luminance, edges, contrast, rgb,
    meanLuminance,
    standardDeviation: Math.sqrt(Math.max(0, squareSum / pixelCount - meanLuminance ** 2)),
    meanEdge: edgeSum / pixelCount,
    maxEdge,
    edgeThreshold: Math.max(18, Math.min(72, maxEdge * 0.25)),
    method: 'sobel-luminance',
  };
}

/** x and y are image coordinates in [0, 1], including the final row/column. */
export function sampleImageAnalysis(analysis, x, y) {
  if (!validAnalysis(analysis) || !Number.isFinite(x) || !Number.isFinite(y)
    || x < 0 || x > 1 || y < 0 || y > 1) return null;
  const pixelX = Math.min(analysis.width - 1, Math.floor(x * analysis.width));
  const pixelY = Math.min(analysis.height - 1, Math.floor(y * analysis.height));
  const i = pixelY * analysis.width + pixelX;
  const light = analysis.luminance[i];
  const edge = analysis.edges[i];
  const localContrast = analysis.contrast[i];
  const isEdge = edge >= (analysis.edgeThreshold ?? 36);
  const tone = isEdge ? 'edge' : light >= 180 ? 'light' : light <= 85 ? 'dark' : 'middle';
  const label = t(`scan.${tone}`);
  const colorOffset = i * 3;
  return {
    id: `image-${tone}`,
    label,
    description: t('scan.description', {
      brightness: Math.round(light / 255 * 100),
      contrast: Math.round(localContrast / 255 * 100),
    }),
    color: `rgb(${analysis.rgb[colorOffset]}, ${analysis.rgb[colorOffset + 1]}, ${analysis.rgb[colorOffset + 2]})`,
    frequency: 180 + light / 255 * 520,
    waveform: isEdge ? 'triangle' : 'sine',
    pattern: isEdge ? [18, 32, 18] : [10],
    pan: clamp(x * 2 - 1, -1, 1),
    gain: 0.12 + localContrast / 255 * 0.58,
    brightness: light / 255,
    edgeStrength: edge / 255,
    contrast: localContrast / 255,
  };
}

/**
 * Conservative candidate boxes for clean, high-contrast diagrams. This does
 * not segment objects: nearby strokes can merge, and photographs may give [].
 * Linear pass over <=1M pixels, followed by bounded coarse-grid components.
 */
export function suggestRegions(analysis, limit = MAX_SUGGESTIONS) {
  if (!validAnalysis(analysis)) return [];
  const count = Number.isFinite(limit) ? clamp(Math.floor(limit), 0, MAX_SUGGESTIONS) : MAX_SUGGESTIONS;
  if (!count || analysis.standardDeviation < 8 || analysis.maxEdge < 18) return [];
  const { width, height, luminance, edges } = analysis;
  const size = width * height;
  const step = Math.max(1, Math.ceil(Math.max(width, height) / 160));
  const columns = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const gridSize = columns * rows;
  const areas = new Uint32Array(gridSize);
  const foreground = new Uint32Array(gridSize);
  const strongEdges = new Uint32Array(gridSize);
  let borderSum = 0;
  let borderCount = 0;
  for (let x = 0; x < width; x++) {
    borderSum += luminance[x];
    borderCount++;
    if (height > 1) { borderSum += luminance[(height - 1) * width + x]; borderCount++; }
  }
  for (let y = 1; y < height - 1; y++) {
    borderSum += luminance[y * width];
    borderCount++;
    if (width > 1) { borderSum += luminance[y * width + width - 1]; borderCount++; }
  }
  const background = borderSum / Math.max(1, borderCount);
  const lightBackground = background >= 128;
  const foregroundThreshold = lightBackground ? background - 40 : background + 40;
  const edgeThreshold = analysis.edgeThreshold ?? 36;
  let foregroundTotal = 0;
  let edgeTotal = 0;
  for (let y = 0; y < height; y++) {
    const cellY = Math.floor(y / step);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const cell = cellY * columns + Math.floor(x / step);
      areas[cell]++;
      const isForeground = lightBackground ? luminance[i] < foregroundThreshold : luminance[i] > foregroundThreshold;
      if (isForeground) { foreground[cell]++; foregroundTotal++; }
      if (edges[i] >= edgeThreshold) { strongEdges[cell]++; edgeTotal++; }
    }
  }
  // Dense texture and huge foreground regions are not useful contour proposals.
  if (foregroundTotal / size > 0.45 || edgeTotal / size > 0.22) return [];
  const occupied = new Uint8Array(gridSize);
  for (let i = 0; i < gridSize; i++) {
    occupied[i] = Number(foreground[i] / areas[i] >= 0.12
      || strongEdges[i] >= Math.max(1, areas[i] * 0.03));
  }

  const visited = new Uint8Array(gridSize);
  const queue = new Int32Array(gridSize);
  const candidates = [];
  for (let start = 0; start < gridSize; start++) {
    if (!occupied[start] || visited[start]) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    let left = columns;
    let top = rows;
    let right = 0;
    let bottom = 0;
    let signal = 0;
    while (head < tail) {
      const cell = queue[head++];
      const cx = cell % columns;
      const cy = Math.floor(cell / columns);
      left = Math.min(left, cx);
      right = Math.max(right, cx);
      top = Math.min(top, cy);
      bottom = Math.max(bottom, cy);
      signal += foreground[cell] + strongEdges[cell] * 2;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || cx + dx < 0 || cx + dx >= columns || cy + dy < 0 || cy + dy >= rows) continue;
          const neighbour = (cy + dy) * columns + cx + dx;
          if (!occupied[neighbour] || visited[neighbour]) continue;
          visited[neighbour] = 1;
          queue[tail++] = neighbour;
        }
      }
    }
    const boxWidth = Math.min(width, (right + 1) * step) - left * step;
    const boxHeight = Math.min(height, (bottom + 1) * step) - top * step;
    const boxArea = boxWidth * boxHeight;
    if (boxWidth < Math.max(3, width * 0.018) || boxHeight < Math.max(3, height * 0.018)
      || boxArea < Math.max(25, size * 0.0015) || boxArea > size * 0.85) continue;
    const padding = Math.max(1, Math.round(step / 2));
    const x0 = Math.max(0, left * step - padding);
    const y0 = Math.max(0, top * step - padding);
    const x1 = Math.min(width, (right + 1) * step + padding);
    const y1 = Math.min(height, (bottom + 1) * step + padding);
    candidates.push({ x: x0 / width, y: y0 / height, width: (x1 - x0) / width, height: (y1 - y0) / height, signal });
  }
  return candidates.sort((a, b) => b.signal - a.signal || a.y - b.y || a.x - b.x)
    .slice(0, count).sort((a, b) => a.y - b.y || a.x - b.x)
    .map(({ signal, ...rectangle }, index) => ({
      id: `contour-${index + 1}`,
      label: t('scan.outline', { n: index + 1 }),
      description: t('scan.outlineDescription'),
      ...rectangle,
      color: '#74b9b0',
      source: 'contrast',
    }));
}
