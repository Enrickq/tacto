/** Local, raster-only lessons. No network access, SVG imports, or dependencies. */
import { t } from './i18n.js';

const SCHEMA = 'tacto.lesson.v1';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DATA_URL_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 64;
const MAX_REGIONS = 16;
const DEFAULT_PATTERN = [45, 65, 85];
const DEFAULT_COLOR = '#74e8bd';
const CANVAS_WIDTH = 1000;
const CANVAS_HEIGHT = 640;

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function text(value, fallback, maxLength) {
  if (typeof value !== 'string') return fallback;
  const clean = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  return clean ? [...clean].slice(0, maxLength).join('') : fallback;
}

function escapeXML(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function requiredNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(t('custom.notFinite', { field }));
  }
  return value;
}

function validateImage(raw) {
  if (!isRecord(raw)) throw new Error(t('custom.imageMissing'));
  if (typeof raw.dataUrl !== 'string' || raw.dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new Error(t('custom.imageLocal'));
  }

  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(raw.dataUrl);
  if (!match || match[2].length % 4 !== 0) {
    throw new Error(t('custom.imageFormat'));
  }

  const [, format, encoded] = match;
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  const byteLength = encoded.length / 4 * 3 - padding;
  if (byteLength > MAX_IMAGE_BYTES) throw new Error(t('custom.imageTooLarge'));

  // Verify the binary signature as well as the declared MIME type. In particular,
  // an SVG/XML payload cannot enter the scene disguised as data:image/png.
  let header;
  try {
    header = globalThis.atob(encoded.slice(0, 32));
  } catch {
    throw new Error(t('custom.imageBase64'));
  }
  const bytes = [...header].map(character => character.charCodeAt(0));
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => bytes[index] === byte);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = header.slice(0, 4) === 'RIFF' && header.slice(8, 12) === 'WEBP';
  if (!({ png, jpeg, webp })[format]) {
    throw new Error(t('custom.imageSignature'));
  }

  const width = requiredNumber(raw.width, t('custom.fieldImageWidth'));
  const height = requiredNumber(raw.height, t('custom.fieldImageHeight'));
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 64 * 1024 * 1024) {
    throw new Error(t('custom.imageDimensions'));
  }

  return { dataUrl: raw.dataUrl, width, height };
}

function safeId(value, index, usedIds) {
  let base = typeof value === 'string' ? value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase() : '';
  base = base.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  if (!base) base = `region-${index + 1}`;
  if (!/^[a-z]/.test(base) || ['constructor', 'prototype', '__proto__'].includes(base)) base = `region-${base}`;
  base = base.slice(0, 48);
  let id = base;
  let suffix = 2;
  while (usedIds.has(id)) {
    const ending = `-${suffix++}`;
    id = base.slice(0, 48 - ending.length) + ending;
  }
  usedIds.add(id);
  return id;
}

function safeColor(value) {
  if (typeof value !== 'string') return DEFAULT_COLOR;
  if (/^#[\da-f]{6}$/i.test(value)) return value.toLowerCase();
  if (/^#[\da-f]{3}$/i.test(value)) return '#' + [...value.slice(1)].map(character => character + character).join('').toLowerCase();
  return DEFAULT_COLOR;
}

function safePattern(value, name) {
  if (value === undefined) return [...DEFAULT_PATTERN];
  if (!Array.isArray(value)) throw new Error(t('custom.patternList', { label: name }));
  if (!value.length) return [...DEFAULT_PATTERN];
  let pattern = value.slice(0, 9).map(duration => Math.round(clamp(requiredNumber(duration, t('custom.fieldDuration', { label: name })), 0, 750)));
  const total = pattern.reduce((sum, duration) => sum + duration, 0);
  if (!total) return [...DEFAULT_PATTERN];
  if (total > 3000) pattern = pattern.map(duration => Math.floor(duration * 3000 / total));
  return pattern;
}

/**
 * Return a fresh, JSON-serializable project, or an error message in the page
 * language. Empty lessons are valid editor drafts. At most 16 regions.
 */
export function validateProject(raw) {
  if (!isRecord(raw)) throw new Error(t('custom.projectObject'));
  if (raw.schema !== undefined && raw.schema !== SCHEMA) throw new Error(t('custom.schema'));
  if (raw.scanEnabled !== undefined && typeof raw.scanEnabled !== 'boolean') throw new Error(t('custom.scanBoolean'));
  const image = validateImage(raw.image);
  const rawRegions = raw.regions === undefined ? [] : raw.regions;
  if (!Array.isArray(rawRegions)) throw new Error(t('custom.regionsList'));
  if (rawRegions.length > MAX_REGIONS) throw new Error(t('custom.regionsMax'));

  const usedIds = new Set();
  const regions = rawRegions.map((region, index) => {
    if (!isRecord(region)) throw new Error(t('custom.regionObject', { n: index + 1 }));
    const label = text(region.label, t('custom.regionDefault', { n: index + 1 }), 80);
    if (!['ellipse', 'rect'].includes(region.shape)) throw new Error(t('custom.regionShape', { label }));
    const x = requiredNumber(region.x, t('custom.fieldX', { label }));
    const y = requiredNumber(region.y, t('custom.fieldY', { label }));
    let width = requiredNumber(region.width, t('custom.fieldWidth', { label }));
    let height = requiredNumber(region.height, t('custom.fieldHeight', { label }));
    if (x < 0 || x > 1 || y < 0 || y > 1 || width <= 0 || width > 1 || height <= 0 || height > 1 || x + width > 1 + 1e-10 || y + height > 1 + 1e-10) {
      throw new Error(t('custom.regionBounds', { label }));
    }
    // Remove only insignificant floating-point overflow at a canvas edge.
    width = Math.min(width, 1 - x);
    height = Math.min(height, 1 - y);
    if (width <= 0 || height <= 0) throw new Error(t('custom.regionEmpty', { label }));

    const frequency = region.frequency === undefined ? 260 + index * 40 : requiredNumber(region.frequency, t('custom.fieldFrequency', { label }));
    return {
      id: safeId(region.id, index, usedIds), label,
      description: text(region.description, '', 600), shape: region.shape,
      x, y, width, height, color: safeColor(region.color),
      frequency: clamp(frequency, 70, 1100),
      waveform: region.waveform === 'triangle' ? 'triangle' : 'sine',
      pattern: safePattern(region.pattern, label),
    };
  });

  return {
    schema: SCHEMA,
    title: text(raw.title, t('custom.defaultTitle'), 100),
    description: text(raw.description, '', 600),
    scanEnabled: raw.scanEnabled === undefined ? true : raw.scanEnabled,
    image, regions,
  };
}

/** Start an editor draft with its own validated copy of the imported image. */
export function makeBlankProject(image) {
  return validateProject({ schema: SCHEMA, title: t('custom.defaultTitle'), description: '', scanEnabled: true, image, regions: [] });
}

function contains(region, x, y) {
  const localX = (x - region.x) / region.width;
  const localY = (y - region.y) / region.height;
  if (region.shape === 'rect') return localX >= 0 && localX <= 1 && localY >= 0 && localY <= 1;
  return ((localX - 0.5) * 2) ** 2 + ((localY - 0.5) * 2) ** 2 <= 1 + 1e-12;
}

function topIndex(regions, x, y) {
  for (let index = regions.length - 1; index >= 0; index -= 1) {
    if (contains(regions[index], x, y)) return index;
  }
  return -1;
}

function visibleAnchor(regions, index) {
  const region = regions[index];
  const fractions = [0.5, 0.2, 0.8, 0.05, 0.95];
  for (const fy of fractions) {
    for (const fx of fractions) {
      const point = { x: region.x + region.width * fx, y: region.y + region.height * fy };
      if (topIndex(regions, point.x, point.y) === index) return point;
    }
  }

  // A thin uncovered strip can lie between every regular grid point. Search
  // actual horizontal intervals as well, subtracting all higher-layer spans.
  const cuts = [region.y, region.y + region.height];
  for (const upper of regions.slice(index + 1)) {
    for (const y of [upper.y, upper.y + upper.height / 2, upper.y + upper.height]) {
      if (y > region.y && y < region.y + region.height) cuts.push(y);
    }
  }
  cuts.sort((a, b) => a - b);
  const rows = fractions.map(fraction => region.y + region.height * fraction);
  for (let cut = 1; cut < cuts.length; cut += 1) rows.push((cuts[cut - 1] + cuts[cut]) / 2);

  for (const y of rows) {
    const span = horizontalSpan(region, y);
    if (!span || span[1] <= span[0]) continue;
    const covers = regions.slice(index + 1).map(upper => horizontalSpan(upper, y))
      .filter(cover => cover && cover[1] >= span[0] && cover[0] <= span[1])
      .sort((a, b) => a[0] - b[0]);
    let cursor = span[0];
    for (const cover of covers) {
      if (cover[0] > cursor) {
        const point = { x: (cursor + Math.min(cover[0], span[1])) / 2, y };
        if (topIndex(regions, point.x, point.y) === index) return point;
      }
      cursor = Math.max(cursor, cover[1]);
      if (cursor >= span[1]) break;
    }
    if (cursor < span[1]) {
      const point = { x: (cursor + span[1]) / 2, y };
      if (topIndex(regions, point.x, point.y) === index) return point;
    }
  }
  return null;
}

function horizontalSpan(region, y) {
  if (y < region.y || y > region.y + region.height) return null;
  if (region.shape === 'rect') return [region.x, region.x + region.width];
  const normalizedY = ((y - region.y) / region.height - 0.5) * 2;
  const halfWidth = region.width / 2 * Math.sqrt(Math.max(0, 1 - normalizedY ** 2));
  const centerX = region.x + region.width / 2;
  return [centerX - halfWidth, centerX + halfWidth];
}

function regionSVG(region, index) {
  const x = region.x * CANVAS_WIDTH;
  const y = region.y * CANVAS_HEIGHT;
  const width = region.width * CANVAS_WIDTH;
  const height = region.height * CANVAS_HEIGHT;
  const attributes = `fill="${escapeXML(region.color)}" fill-opacity=".13" stroke="${escapeXML(region.color)}" stroke-width="3" vector-effect="non-scaling-stroke"`;
  const geometry = region.shape === 'ellipse'
    ? `<ellipse cx="${escapeXML(x + width / 2)}" cy="${escapeXML(y + height / 2)}" rx="${escapeXML(width / 2)}" ry="${escapeXML(height / 2)}" ${attributes}/>`
    : `<rect x="${escapeXML(x)}" y="${escapeXML(y)}" width="${escapeXML(width)}" height="${escapeXML(height)}" ${attributes}/>`;
  // Numbering stays within the shape's bounding box; full text is provided by
  // the accessible region controls, rather than by a tiny paragraph on the image.
  const badgeX = region.shape === 'ellipse' ? x + width / 2 : x + Math.min(18, width / 2);
  const badgeY = region.shape === 'ellipse' ? y + height / 2 : y + Math.min(18, height / 2);
  const badgeRadius = Math.min(13, width / 5, height / 5);
  return `<g data-region="${escapeXML(region.id)}"><title>${escapeXML(region.label)}</title><desc>${escapeXML(region.description)}</desc>${geometry}<circle cx="${escapeXML(badgeX)}" cy="${escapeXML(badgeY)}" r="${escapeXML(badgeRadius)}" fill="#0b211a" fill-opacity=".9" stroke="${escapeXML(region.color)}" stroke-width="1.5"/><text x="${escapeXML(badgeX)}" y="${escapeXML(badgeY)}" dy=".35em" text-anchor="middle" fill="${escapeXML(region.color)}" font-family="system-ui, sans-serif" font-weight="700" font-size="${escapeXML(Math.min(11, badgeRadius))}">${index + 1}</text></g>`;
}

/** Build a scene whose geometry is independent of the image's aspect ratio. */
export function createCustomScene(rawProject) {
  const project = validateProject(rawProject);
  const anchors = project.regions.map((_, index) => visibleAnchor(project.regions, index));
  const allRegions = project.regions.map((region, index) => ({
    id: region.id, label: region.label, description: region.description,
    color: region.color, pattern: [...region.pattern], frequency: region.frequency,
    waveform: region.waveform,
    point: anchors[index] || { x: region.x + region.width / 2, y: region.y + region.height / 2 },
  }));
  const regions = allRegions.filter((_, index) => anchors[index] !== null);

  return {
    id: 'custom', category: t('custom.category'), shortTitle: t('custom.shortTitle'), title: project.title,
    subtitle: t('custom.subtitle'),
    description: project.description || t('custom.description'),
    task: t('custom.task'), guide: t('custom.guide'),
    svg: `<title>${escapeXML(project.title)}</title><desc>${escapeXML(project.description)}</desc><rect width="1000" height="640" fill="#071c17"/><image x="0" y="0" width="1000" height="640" preserveAspectRatio="xMidYMid meet" href="${escapeXML(project.image.dataUrl)}" aria-label="${escapeXML(project.title)}"/>${project.regions.filter((_, index) => anchors[index] !== null).map(regionSVG).join('')}`,
    regions,
    sample(x, y) {
      if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
      const index = topIndex(project.regions, x, y);
      if (index === -1) return null;
      return { ...allRegions[index], pattern: [...allRegions[index].pattern], pan: 2 * x - 1, gain: 0.5 };
    },
    // Only reachable regions become viewer controls/progress targets. The full
    // project remains intact for editing, and sample retains its layer indices.
    tour: regions.map(region => ({ ...region.point, duration: 1600 })),
  };
}
