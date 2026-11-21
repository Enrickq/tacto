/*
 * TACTO — self-contained learning scenes, in Spanish and English.
 * Coordinates in the SVG and all hit tests share the same 1000 × 640 space.
 * sample(x, y) accepts normalized coordinates and has no side effects.
 * Geometry, colours and signals are shared by both languages; only text differs.
 */
import { getLanguage, normalizeLanguage, DEFAULT_LANGUAGE } from './i18n.js';

const WIDTH = 1000;
const HEIGHT = 640;
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const xy = ([x, y]) => ({ x: x / WIDTH, y: y / HEIGHT });
const points = vertices => vertices.map(p => p.join(',')).join(' ');
const xml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);

function inEllipse(x, y, cx, cy, rx, ry, angle = 0) {
  const radians = -angle * Math.PI / 180;
  const dx = x - cx;
  const dy = y - cy;
  const px = dx * Math.cos(radians) - dy * Math.sin(radians);
  const py = dx * Math.sin(radians) + dy * Math.cos(radians);
  return (px / rx) ** 2 + (py / ry) ** 2 <= 1;
}

function segmentDistance(x, y, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? clamp(((x - a[0]) * dx + (y - a[1]) * dy) / lengthSquared, 0, 1) : 0;
  return Math.hypot(x - (a[0] + t * dx), y - (a[1] + t * dy));
}

function polylineDistance(x, y, vertices, closed = false) {
  let distance = Infinity;
  for (let i = 1; i < vertices.length; i += 1) {
    distance = Math.min(distance, segmentDistance(x, y, vertices[i - 1], vertices[i]));
  }
  if (closed && vertices.length > 2) {
    distance = Math.min(distance, segmentDistance(x, y, vertices[vertices.length - 1], vertices[0]));
  }
  return distance;
}

function inPolygon(x, y, vertices) {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i, i += 1) {
    const a = vertices[i];
    const b = vertices[j];
    if (((a[1] > y) !== (b[1] > y)) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) {
      inside = !inside;
    }
  }
  return inside || polylineDistance(x, y, vertices, true) < 0.01;
}

function signal(region, x, gain = 0.3, frequency = region.frequency) {
  return { ...region, frequency, pan: clamp(2 * x - 1, -1, 1), gain: clamp(gain, 0, 1) };
}

function coordinates(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null;
  return [x * WIDTH, y * HEIGHT];
}

/** Attach the localized name and explanation to each region's signals. */
function localize(signals, regionText) {
  return signals.map(({ id, color, pattern, frequency, waveform, point }) => {
    const [label, description] = regionText[id];
    return { id, label, description, color, pattern: [...pattern], frequency, waveform, point };
  });
}

const byId = regions => Object.fromEntries(regions.map(region => [region.id, region]));

/**
 * Missions (see missions.js): a question, the regions that answer it, and the
 * points that the guiding sound and the spoken help steer the finger towards.
 * A region may have several parts, so a mission may have several points.
 */
function missionList(prompts, definitions) {
  return definitions.map(({ id, targets, points: guide }) => ({
    id, prompt: prompts[id], targets: [...targets], points: guide.map(xy),
  }));
}

const diagramType = `font-family="Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"`;
const monoType = `font-family="'SFMono-Regular', Consolas, 'Liberation Mono', monospace"`;
const labelStyle = `font-size="13" font-weight="650" letter-spacing="1.15"`;
const fineStyle = `font-size="11" letter-spacing="0.2"`;

// ————————————————————————————————— TEXT —————————————————————————————————

const TEXT = {
  es: {
    cell: {
      category: 'Biología', shortTitle: 'La célula', title: 'Un universo en una célula', subtitle: 'Biología que puedes recorrer',
      description: 'Explora una célula animal simplificada. Cada orgánulo tiene una voz, un timbre y un patrón distintos. El latido del núcleo es un código didáctico, no un pulso biológico.',
      task: 'Encuentra el núcleo y después la mitocondria. ¿Cuál contiene la mayor parte del ADN y cuál produce gran parte del ATP?',
      guide: 'Cada orgánulo tiene un tono y timbre propios. El volumen no indica distancia al núcleo.',
      missions: {
        nucleus: 'Encuentra el núcleo.',
        mitochondria: 'Encuentra un orgánulo que produce gran parte del ATP de la célula.',
        nucleolus: 'Encuentra la pequeña región que hay dentro del núcleo.',
      },
      regions: {
        membrane: ['Membrana celular', 'Delimita la célula y regula el intercambio de sustancias con el exterior.'],
        cytoplasm: ['Citoplasma', 'Medio interior donde se encuentran los orgánulos y ocurren muchas reacciones celulares.'],
        nucleus: ['Núcleo', 'Contiene la mayor parte del ADN y participa en la regulación de la actividad celular.'],
        nucleolus: ['Nucléolo', 'Región del núcleo donde se produce ARN ribosómico y se ensamblan subunidades de los ribosomas.'],
        mitochondria: ['Mitocondrias', 'Transforman la energía de los nutrientes y producen gran parte del ATP de la célula.'],
        reticulum: ['Retículo endoplasmático', 'Red de membranas que participa en la fabricación y el transporte de proteínas y lípidos.'],
        golgi: ['Aparato de Golgi', 'Modifica, clasifica y empaqueta proteínas y lípidos para transportarlos.'],
        ribosomes: ['Ribosomas', 'Pequeñas estructuras que sintetizan proteínas. También existen ribosomas asociados al retículo.'],
      },
      svg: {
        membrane: 'MEMBRANA', mitochondria: 'MITOCONDRIAS', reticulum: 'RETÍCULO', golgi: 'GOLGI', nucleus: 'NÚCLEO', nucleolus: 'NUCLÉOLO', ribosomes: 'RIBOSOMAS',
        membraneNote: 'La frontera que intercambia', mitochondriaNote: 'Energía para la célula', reticulumNote: 'Fabricar · transportar', golgiNote: 'Clasificar · empaquetar',
        cytoplasm: 'CITOPLASMA', corner: '01 / BIOLOGÍA', scale: 'MODELO SIMPLIFICADO · NO A ESCALA',
      },
    },
    islands: {
      category: 'Geografía', shortTitle: 'Canarias', title: 'Ocho islas. Ocho firmas.', subtitle: 'Un archipiélago que suena',
      description: 'Explora las ocho islas de Canarias en un esquema didáctico. Cada isla tiene su propio tono. Busca en Tenerife el Teide, señalado con un triángulo y un sonido más agudo. No es un mapa de navegación.',
      task: 'Encuentra La Graciosa al norte de Lanzarote. Después busca Tenerife y localiza el Teide dentro de la isla.',
      guide: 'La posición estéreo sigue izquierda y derecha. El Teide usa un tono más agudo como hito.',
      missions: {
        tenerife: 'Encuentra Tenerife.',
        teide: 'Ahora encuentra el Teide, dentro de Tenerife.',
        hierro: 'Encuentra la isla situada más al suroeste.',
      },
      regions: {
        palma: ['La Palma', 'Isla del sector occidental del archipiélago. En este esquema está al norte de El Hierro.'],
        hierro: ['El Hierro', 'La isla situada más al suroeste en este esquema de Canarias.'],
        gomera: ['La Gomera', 'Isla de forma aproximadamente circular, al oeste de Tenerife.'],
        tenerife: ['Tenerife', 'Isla central-occidental donde se encuentra el Teide. Busca el pequeño triángulo luminoso en su interior.'],
        grancanaria: ['Gran Canaria', 'Isla de contorno aproximadamente circular, al este de Tenerife y al oeste de Fuerteventura.'],
        fuerteventura: ['Fuerteventura', 'Isla alargada del sector oriental, al sur de Lanzarote.'],
        lanzarote: ['Lanzarote', 'Isla del sector nororiental de Canarias, al norte de Fuerteventura y al sur de La Graciosa.'],
        graciosa: ['La Graciosa', 'La más pequeña de las ocho islas representadas. Está al norte de Lanzarote.'],
        teide: ['Teide', 'Volcán de Tenerife y punto más alto de España. Aquí tiene el tono más agudo para distinguir el hito de la isla.'],
      },
      svg: {
        palma: 'LA PALMA', hierro: 'EL HIERRO', gomera: 'LA GOMERA', tenerife: 'TENERIFE', grancanaria: 'GRAN CANARIA',
        fuerteventura: 'FUERTEVENTURA', lanzarote: 'LANZAROTE', graciosa: 'LA GRACIOSA', teide: 'TEIDE',
        west: 'Occidente', centre: 'Centro del archipiélago', east: 'Oriente', north: 'N',
        // No-break spaces between the words: SVG collapses runs of ordinary spaces.
        ocean: 'O C É A N O   A T L Á N T I C O', schematic: '8 ISLAS · ESQUEMA NO GEOGRÁFICO', scale: 'TAMAÑOS Y DISTANCIAS NO A ESCALA',
      },
    },
    economy: {
      category: 'Economía', shortTitle: 'El equilibrio', title: 'El punto donde todo encaja', subtitle: 'Escucha el equilibrio',
      description: 'Recorre dos curvas de oferta y demanda. La altura eleva el tono; el timbre distingue cada curva. En el cruce coinciden la cantidad ofrecida y la demandada, a un mismo precio. Es un modelo lineal simplificado.',
      task: 'Sigue una curva hasta encontrar la señal de equilibrio. ¿Qué ocurre con la cantidad demandada cuando sube el precio?',
      guide: 'La altura marca el tono. El timbre distingue oferta y demanda; el cruce tiene su propia señal.',
      missions: {
        demand: 'Encuentra la curva de demanda.',
        supply: 'Encuentra la curva en la que el precio sube cuando aumenta la cantidad.',
        equilibrium: 'Encuentra el punto donde se cruzan la oferta y la demanda.',
      },
      regions: {
        supply: ['Oferta', 'La curva ascendente relaciona un precio mayor con una cantidad ofrecida mayor. Suena con un timbre triangular.'],
        demand: ['Demanda', 'La curva descendente relaciona un precio mayor con una cantidad demandada menor. Suena con un timbre suave.'],
        equilibrium: ['Punto de equilibrio', 'Las curvas se cruzan: a este precio la cantidad ofrecida coincide con la cantidad demandada. Las guías indican P estrella y Q estrella.'],
        price: ['Eje del precio', 'Eje vertical. El precio aumenta al subir. P estrella marca el precio de equilibrio.'],
        quantity: ['Eje de la cantidad', 'Eje horizontal. La cantidad aumenta hacia la derecha. Q estrella marca la cantidad de equilibrio.'],
      },
      svg: {
        demand: 'DEMANDA', supply: 'OFERTA', equilibrium: 'EQUILIBRIO',
        demandNote: 'Precio ↑ · cantidad demandada ↓', supplyNote: 'Precio ↑ · cantidad ofrecida ↑', equilibriumNote: 'Lo que se ofrece = lo que se demanda',
        price: 'Precio', quantity: 'Cantidad', hint: 'Sube por la oferta · baja por la demanda · encuentra el cruce', scale: 'MODELO LINEAL · SIN UNIDADES REALES',
      },
    },
  },
  en: {
    cell: {
      category: 'Biology', shortTitle: 'The cell', title: 'A universe in a cell', subtitle: 'Biology you can explore',
      description: 'Explore a simplified animal cell. Each organelle has its own tone, timbre and pattern. The beat of the nucleus is a teaching code, not a biological pulse.',
      task: 'Find the nucleus, then a mitochondrion. Which one holds most of the DNA, and which one produces much of the ATP?',
      guide: 'Each organelle has its own pitch and timbre. Loudness does not show the distance to the nucleus.',
      missions: {
        nucleus: 'Find the nucleus.',
        mitochondria: "Find an organelle that produces much of the cell's ATP.",
        nucleolus: 'Find the small region inside the nucleus.',
      },
      regions: {
        membrane: ['Cell membrane', 'It surrounds the cell and controls the exchange of substances with the outside.'],
        cytoplasm: ['Cytoplasm', 'The inner medium that holds the organelles, where many of the reactions of the cell take place.'],
        nucleus: ['Nucleus', 'It holds most of the DNA and helps to regulate the activity of the cell.'],
        nucleolus: ['Nucleolus', 'A region of the nucleus where ribosomal RNA is made and ribosome subunits are assembled.'],
        mitochondria: ['Mitochondria', 'They convert the energy in nutrients and produce much of the ATP in the cell.'],
        reticulum: ['Endoplasmic reticulum', 'A network of membranes that helps to make and transport proteins and lipids.'],
        golgi: ['Golgi apparatus', 'It modifies, sorts and packages proteins and lipids for transport.'],
        ribosomes: ['Ribosomes', 'Small structures that make proteins. Some ribosomes are also attached to the reticulum.'],
      },
      svg: {
        membrane: 'MEMBRANE', mitochondria: 'MITOCHONDRIA', reticulum: 'RETICULUM', golgi: 'GOLGI', nucleus: 'NUCLEUS', nucleolus: 'NUCLEOLUS', ribosomes: 'RIBOSOMES',
        membraneNote: 'The boundary that exchanges', mitochondriaNote: 'Energy for the cell', reticulumNote: 'Make · transport', golgiNote: 'Sort · package',
        cytoplasm: 'CYTOPLASM', corner: '01 / BIOLOGY', scale: 'SIMPLIFIED MODEL · NOT TO SCALE',
      },
    },
    islands: {
      category: 'Geography', shortTitle: 'Canary Islands', title: 'Eight islands. Eight signatures.', subtitle: 'An archipelago you can hear',
      description: 'Explore the eight Canary Islands in a teaching diagram. Each island has its own tone. In Tenerife, look for Mount Teide, marked with a triangle and a higher sound. This is not a map for navigation.',
      task: 'Find La Graciosa, north of Lanzarote. Then find Tenerife and locate Mount Teide inside the island.',
      guide: 'Stereo position follows left and right. Mount Teide uses a higher pitch as a landmark.',
      missions: {
        tenerife: 'Find Tenerife.',
        teide: 'Now find Mount Teide, inside Tenerife.',
        hierro: 'Find the island furthest to the south-west.',
      },
      regions: {
        palma: ['La Palma', 'An island in the west of the archipelago. In this diagram it lies north of El Hierro.'],
        hierro: ['El Hierro', 'The island furthest to the south-west in this diagram of the Canary Islands.'],
        gomera: ['La Gomera', 'A roughly circular island, west of Tenerife.'],
        tenerife: ['Tenerife', 'A central-western island, home to Mount Teide. Look for the small glowing triangle inside it.'],
        grancanaria: ['Gran Canaria', 'A roughly circular island, east of Tenerife and west of Fuerteventura.'],
        fuerteventura: ['Fuerteventura', 'A long island in the east of the archipelago, south of Lanzarote.'],
        lanzarote: ['Lanzarote', 'An island in the north-east of the Canaries, north of Fuerteventura and south of La Graciosa.'],
        graciosa: ['La Graciosa', 'The smallest of the eight islands shown. It lies north of Lanzarote.'],
        teide: ['Mount Teide', 'The volcano of Tenerife and the highest point in Spain. It has the highest pitch here, to mark the landmark of the island.'],
      },
      svg: {
        palma: 'LA PALMA', hierro: 'EL HIERRO', gomera: 'LA GOMERA', tenerife: 'TENERIFE', grancanaria: 'GRAN CANARIA',
        fuerteventura: 'FUERTEVENTURA', lanzarote: 'LANZAROTE', graciosa: 'LA GRACIOSA', teide: 'TEIDE',
        west: 'West', centre: 'Centre of the archipelago', east: 'East', north: 'N',
        ocean: 'A T L A N T I C   O C E A N', schematic: '8 ISLANDS · SCHEMATIC, NOT A MAP', scale: 'SIZES AND DISTANCES NOT TO SCALE',
      },
    },
    economy: {
      category: 'Economics', shortTitle: 'Equilibrium', title: 'Where it all comes together', subtitle: 'Hear the equilibrium',
      description: 'Follow the supply and demand curves. Height raises the pitch; timbre tells the curves apart. Where they cross, the quantity supplied equals the quantity demanded, at the same price. This is a simplified linear model.',
      task: 'Follow a curve until you find the equilibrium signal. What happens to the quantity demanded when the price rises?',
      guide: 'Height sets the pitch. Timbre tells supply from demand; the crossing has its own signal.',
      missions: {
        demand: 'Find the demand curve.',
        supply: 'Find the curve where the price rises as the quantity increases.',
        equilibrium: 'Find the point where supply and demand meet.',
      },
      regions: {
        supply: ['Supply', 'The rising curve links a higher price with a larger quantity supplied. It has a bright, triangle-wave timbre.'],
        demand: ['Demand', 'The falling curve links a higher price with a smaller quantity demanded. It has a soft timbre.'],
        equilibrium: ['Equilibrium point', 'The curves cross: at this price, the quantity supplied equals the quantity demanded. The guides mark P star and Q star.'],
        price: ['Price axis', 'The vertical axis. Price rises as you move up. P star marks the equilibrium price.'],
        quantity: ['Quantity axis', 'The horizontal axis. Quantity increases to the right. Q star marks the equilibrium quantity.'],
      },
      svg: {
        demand: 'DEMAND', supply: 'SUPPLY', equilibrium: 'EQUILIBRIUM',
        demandNote: 'Price ↑ · quantity demanded ↓', supplyNote: 'Price ↑ · quantity supplied ↑', equilibriumNote: 'Quantity supplied = quantity demanded',
        price: 'Price', quantity: 'Quantity', hint: 'Climb the supply · descend the demand · find the crossing', scale: 'LINEAR MODEL · NO REAL UNITS',
      },
    },
  },
};

// ————————————————————————————————— CELL —————————————————————————————————

const mitochondria = [
  { cx: 250, cy: 234, rx: 48, ry: 25, angle: -25 },
  { cx: 684, cy: 205, rx: 54, ry: 25, angle: -18 }, // clear of the NUCLEOLUS label and the cell edge
  { cx: 348, cy: 461, rx: 56, ry: 25, angle: 24 },
];

const reticulum = [
  [[365, 240], [334, 250], [322, 278], [344, 296], [315, 320], [331, 348], [313, 375], [345, 398], [381, 396], [404, 421]],
  [[342, 258], [307, 276], [319, 306], [292, 324], [305, 355], [286, 378], [316, 413], [361, 428], [389, 449]],
  [[325, 243], [300, 242], [278, 268], [287, 295]],
];

const golgi = [
  [[631, 343], [655, 333], [686, 338], [705, 353]],
  [[625, 363], [650, 353], [681, 358], [706, 375]],
  [[624, 384], [647, 374], [675, 379], [700, 397]],
  [[631, 406], [651, 396], [674, 402], [691, 418]],
];
const vesicles = [[720, 339, 8], [730, 389, 10], [702, 435, 7]];
const ribosomes = [[425, 172], [570, 175], [635, 262], [233, 353], [250, 403], [486, 453], [537, 471], [600, 450], [755, 305], [373, 196]];

const cellSignals = [
  { id: 'membrane', color: '#74f0c5', pattern: [35], frequency: 250, waveform: 'triangle', point: xy([135, 320]) },
  { id: 'cytoplasm', color: '#47c7a2', pattern: [25, 130, 25], frequency: 170, waveform: 'sine', point: xy([569, 423]) },
  { id: 'nucleus', color: '#b2a1ff', pattern: [65, 85, 100, 450], frequency: 330, waveform: 'sine', point: xy([445, 289]) },
  { id: 'nucleolus', color: '#dfc8ff', pattern: [40, 45, 40, 45, 95], frequency: 570, waveform: 'sine', point: xy([515, 285]) },
  { id: 'mitochondria', color: '#ffbc7a', pattern: [75, 70, 75], frequency: 455, waveform: 'triangle', point: xy([684, 205]) },
  { id: 'reticulum', color: '#69d7ee', pattern: [30, 45, 30, 45, 30], frequency: 385, waveform: 'triangle', point: xy([292, 324]) },
  { id: 'golgi', color: '#f09dd1', pattern: [35, 60, 65, 60, 95], frequency: 510, waveform: 'sine', point: xy([650, 353]) },
  { id: 'ribosomes', color: '#d7edb1', pattern: [18, 45, 18], frequency: 730, waveform: 'triangle', point: xy([486, 453]) },
];

const mitochondriaSVG = mitochondria.map(({ cx, cy, rx, ry, angle }) => `
  <g data-region="mitochondria" transform="translate(${cx} ${cy}) rotate(${angle})">
    <ellipse rx="${rx}" ry="${ry}" fill="#503c31" stroke="#ffbc7a" stroke-width="3"/>
    <ellipse rx="${rx - 7}" ry="${ry - 7}" fill="#a66d4533" stroke="#ffbc7a" stroke-opacity=".35"/>
    <path d="M-${rx - 12},2 C-${rx - 14},-19 -${rx - 24},-19 -${rx - 24},0 S-12,19 -12,0 S0,-19 0,0 S12,19 12,0 S25,-19 25,0 S${rx - 12},17 ${rx - 10},-2" fill="none" stroke="#ffd0a1" stroke-width="2.7" stroke-linecap="round"/>
  </g>`).join('');

const cellSVG = label => `
<defs>
  <radialGradient id="cell-body" cx="48%" cy="42%" r="66%"><stop stop-color="#1e6354"/><stop offset=".7" stop-color="#15473e"/><stop offset="1" stop-color="#0b302b"/></radialGradient>
  <radialGradient id="cell-nucleus" cx="38%" cy="28%"><stop stop-color="#69608a"/><stop offset="1" stop-color="#393451"/></radialGradient>
  <linearGradient id="cell-membrane" x2="0" y2="1"><stop stop-color="#78edc4"/><stop offset="1" stop-color="#319e7e"/></linearGradient>
  <pattern id="cell-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#6eaa9820" stroke-width=".7"/></pattern>
  <clipPath id="cell-inside"><ellipse cx="480" cy="320" rx="344" ry="216"/></clipPath>
</defs>
<g ${diagramType}>
  <rect x="24" y="24" width="952" height="592" rx="26" fill="url(#cell-grid)" opacity=".6"/>
  <ellipse cx="480" cy="320" rx="387" ry="257" fill="none" stroke="#3e8b7350" stroke-dasharray="2 10"/>
  <path d="M480 48v16M480 576v16M82 320h16M862 320h16" stroke="#77c5ac" stroke-opacity=".5"/>
  <ellipse cx="480" cy="332" rx="351" ry="228" fill="#000000" opacity=".22"/>
  <ellipse data-region="membrane" cx="480" cy="320" rx="358" ry="230" fill="url(#cell-membrane)" stroke="#a5f7d9" stroke-width="1.8"/>
  <ellipse data-region="cytoplasm" cx="480" cy="320" rx="344" ry="216" fill="url(#cell-body)" stroke="#123d33" stroke-width="2"/>
  <ellipse cx="480" cy="320" rx="351" ry="223" fill="none" stroke="#d3ffe5" stroke-opacity=".32" stroke-dasharray="2.5 8" stroke-width="2"/>
  <g clip-path="url(#cell-inside)" opacity=".17" fill="#abefcf">
    <circle cx="192" cy="300" r="2"/><circle cx="358" cy="163" r="2"/><circle cx="702" cy="304" r="2"/><circle cx="460" cy="495" r="2"/><circle cx="624" cy="484" r="2"/><circle cx="568" cy="223" r="2"/><circle cx="197" cy="348" r="2"/><circle cx="547" cy="130" r="2"/><circle cx="754" cy="398" r="2"/>
    <path d="M182 287c45-60 88-94 137-107M525 483c60 18 133-4 172-28M642 161c42 9 94 58 111 109" fill="none" stroke="#a5eccf" stroke-width="1"/>
  </g>
  <g data-region="reticulum" fill="none" stroke-linejoin="round" stroke-linecap="round">
    ${reticulum.map(line => `<polyline points="${points(line)}" stroke="#173f49" stroke-width="18"/><polyline points="${points(line)}" stroke="#69d7ee" stroke-opacity=".76" stroke-width="11"/><polyline points="${points(line)}" stroke="#b8eff9" stroke-opacity=".4" stroke-width="2"/>`).join('')}
  </g>
  <ellipse data-region="nucleus" cx="485" cy="300" rx="114" ry="96" fill="url(#cell-nucleus)" stroke="#b2a1ff" stroke-width="4"/>
  <ellipse cx="485" cy="300" rx="105" ry="87" fill="none" stroke="#e4d4ff" stroke-opacity=".27" stroke-dasharray="3 8" stroke-width="2"/>
  <g fill="none" stroke="#c8b8ff" stroke-opacity=".28" stroke-width="2" stroke-linecap="round">
    <path d="M414 273c30-24 18 35 46 12s-11-44 20-45M409 314c42-15 27 40 55 13s14 38 43 21M448 355c21-4 20 20 45 12s8-37 34-31M550 242c-10 23 24 14 15 42s20 22 6 47"/>
  </g>
  <circle data-region="nucleolus" cx="515" cy="285" r="34" fill="#b89bd2" stroke="#ecd9ff" stroke-width="2.5"/>
  <circle cx="505" cy="276" r="11" fill="#ecd9ff" opacity=".24"/>
  <g fill="#ebd9ff" opacity=".5"><circle cx="518" cy="296" r="2"/><circle cx="532" cy="281" r="2"/><circle cx="509" cy="288" r="2"/></g>
  ${mitochondriaSVG}
  <g data-region="golgi" fill="none" stroke-linecap="round" stroke-linejoin="round">
    ${golgi.map(line => `<polyline points="${points(line)}" stroke="#633b59" stroke-width="17"/><polyline points="${points(line)}" stroke="#f09dd1" stroke-width="10"/><polyline points="${points(line)}" stroke="#ffe2f5" stroke-opacity=".4" stroke-width="2"/>`).join('')}
    ${vesicles.map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#7f4c70" stroke="#f09dd1" stroke-width="2"/>`).join('')}
  </g>
  <g data-region="ribosomes" fill="#d7edb1" stroke="#f2ffd8" stroke-width="1.3">
    ${ribosomes.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5"/>`).join('')}
  </g>
  <g stroke="#8dcbb0" stroke-opacity=".52" fill="none" stroke-width="1.2">
    <path d="M184 158 270 122H58"/><circle cx="184" cy="158" r="3" fill="#74f0c5"/>
    <path d="M689 182 755 118H882"/><circle cx="689" cy="182" r="3" fill="#ffbc7a"/>
    <path d="M295 374 214 540H62"/><circle cx="295" cy="374" r="3" fill="#69d7ee"/>
    <path d="M696 407 779 504H936"/><circle cx="696" cy="407" r="3" fill="#f09dd1"/>
    <path d="M445 271 416 188H345"/><circle cx="445" cy="271" r="3" fill="#b2a1ff"/>
    <path d="M537 280 591 262H640"/><circle cx="537" cy="280" r="3" fill="#dfc8ff"/>
    <path d="M486 453 487 565H579"/><circle cx="486" cy="453" r="3" fill="#d7edb1"/>
  </g>
  <g ${labelStyle}>
    <text x="58" y="106" fill="#b4f8dc">${xml(label.membrane)}</text>
    <text x="755" y="102" fill="#ffcea0">${xml(label.mitochondria)}</text>
    <text x="62" y="563" fill="#9ee8f8">${xml(label.reticulum)}</text>
    <text x="779" y="527" fill="#f9c2e5">${xml(label.golgi)}</text>
    <text x="345" y="173" fill="#d3c6ff">${xml(label.nucleus)}</text>
    <text x="593" y="249" fill="#ecd9ff" font-size="11">${xml(label.nucleolus)}</text>
    <text x="491" y="588" fill="#e3f2c8" font-size="11">${xml(label.ribosomes)}</text>
  </g>
  <g ${fineStyle} fill="#82ad9d">
    <text x="58" y="141">${xml(label.membraneNote)}</text>
    <text x="755" y="137">${xml(label.mitochondriaNote)}</text>
    <text x="62" y="582">${xml(label.reticulumNote)}</text>
    <text x="779" y="546">${xml(label.golgiNote)}</text>
    <text x="593" y="489" fill="#76bc9f" letter-spacing="1.4">${xml(label.cytoplasm)}</text>
  </g>
  <text x="43" y="42" ${monoType} font-size="10" letter-spacing="1.7" fill="#77ad96">${xml(label.corner)}</text>
  <text x="954" y="603" text-anchor="end" ${monoType} font-size="9" letter-spacing="1" fill="#679483">${xml(label.scale)}</text>
</g>`;

function buildCell(text) {
  const regions = localize(cellSignals, text.regions);
  const region = byId(regions);
  function sample(x, y) {
    const position = coordinates(x, y);
    if (!position) return null;
    const [px, py] = position;
    if (!inEllipse(px, py, 480, 320, 358, 230)) return null;
    if (!inEllipse(px, py, 480, 320, 344, 216)) return signal(region.membrane, x, 0.24);
    if (inEllipse(px, py, 515, 285, 34, 34)) return signal(region.nucleolus, x, 0.34);
    if (inEllipse(px, py, 485, 300, 114, 96)) return signal(region.nucleus, x, 0.32);
    if (mitochondria.some(m => inEllipse(px, py, m.cx, m.cy, m.rx, m.ry, m.angle))) return signal(region.mitochondria, x, 0.3);
    if (golgi.some(line => polylineDistance(px, py, line) <= 8.5) || vesicles.some(([cx, cy, r]) => Math.hypot(px - cx, py - cy) <= r + 1)) return signal(region.golgi, x, 0.28);
    if (ribosomes.some(([cx, cy]) => Math.hypot(px - cx, py - cy) <= 6)) return signal(region.ribosomes, x, 0.23);
    if (reticulum.some(line => polylineDistance(px, py, line) <= 9)) return signal(region.reticulum, x, 0.26);
    return signal(region.cytoplasm, x, 0.1);
  }
  return {
    id: 'cell', category: text.category, shortTitle: text.shortTitle, title: text.title, subtitle: text.subtitle,
    description: text.description, task: text.task, guide: text.guide,
    svg: cellSVG(text.svg), regions, sample,
    // The nucleolus lies inside the nucleus, so it also answers "find the nucleus".
    missions: missionList(text.missions, [
      { id: 'nucleus', targets: ['nucleus', 'nucleolus'], points: [[445, 289]] },
      { id: 'mitochondria', targets: ['mitochondria'], points: mitochondria.map(({ cx, cy }) => [cx, cy]) },
      { id: 'nucleolus', targets: ['nucleolus'], points: [[515, 285]] },
    ]),
    tour: [
      { ...xy([135, 320]), duration: 1200 }, { ...xy([205, 310]), duration: 1000 },
      { ...xy([445, 289]), duration: 1700 }, { ...xy([515, 285]), duration: 1400 },
      { ...xy([684, 205]), duration: 1600 }, { ...xy([650, 353]), duration: 1500 },
      { ...xy([292, 324]), duration: 1500 }, { ...xy([486, 453]), duration: 1200 },
    ],
  };
}

// ———————————————————————————————— ISLANDS ————————————————————————————————

const islandShapes = [
  { id: 'palma', color: '#8ae4b5', frequency: 294, pattern: [50, 80, 90], waveform: 'sine', center: [151, 217], vertices: [[148, 164], [164, 178], [170, 202], [166, 231], [155, 264], [140, 257], [133, 233], [135, 206], [139, 184]], ridge: 'M148 183 154 202 148 221 153 242' },
  { id: 'hierro', color: '#6ac5b8', frequency: 220, pattern: [130], waveform: 'triangle', center: [153, 456], vertices: [[138, 433], [167, 439], [181, 459], [169, 473], [146, 469], [124, 453]], ridge: 'M138 451 153 449 166 459' },
  { id: 'gomera', color: '#b3d58c', frequency: 349, pattern: [35, 70, 35], waveform: 'sine', center: [310, 372], vertices: [[300, 345], [323, 350], [336, 366], [332, 386], [315, 398], [294, 389], [285, 370]], ridge: 'M299 362 311 371 325 360M311 371 305 387M311 371 327 381' },
  { id: 'tenerife', color: '#55dbb7', frequency: 440, pattern: [45, 55, 45, 100, 90], waveform: 'triangle', center: [395, 312], vertices: [[367, 321], [375, 292], [396, 277], [421, 279], [445, 258], [462, 253], [454, 270], [442, 288], [432, 311], [402, 326], [382, 333]], ridge: 'M378 314 409 302 432 288 450 264M409 302 423 315' },
  { id: 'grancanaria', color: '#93e3dc', frequency: 523, pattern: [70, 60, 70, 60, 70], waveform: 'sine', center: [591, 417], vertices: [[578, 376], [600, 376], [621, 390], [634, 411], [630, 434], [613, 451], [588, 460], [568, 449], [551, 429], [553, 406], [563, 388]], ridge: 'M575 395 591 417 614 396M591 417 574 439M591 417 615 440M591 417 592 451' },
  { id: 'fuerteventura', color: '#e3ca8d', frequency: 622, pattern: [130, 65, 45], waveform: 'triangle', center: [792, 310], vertices: [[768, 244], [787, 257], [789, 276], [804, 296], [805, 323], [820, 343], [819, 371], [803, 379], [789, 363], [786, 343], [773, 326], [775, 304], [761, 287], [758, 263]], ridge: 'M771 263 779 285 789 308 790 335 807 359' },
  { id: 'lanzarote', color: '#dcad8a', frequency: 740, pattern: [40, 45, 40, 45, 100], waveform: 'triangle', center: [845, 182], vertices: [[829, 130], [850, 141], [861, 163], [856, 179], [873, 198], [872, 221], [861, 233], [844, 219], [836, 194], [822, 179], [821, 158]], ridge: 'M833 147 843 166 838 180 853 198 861 218' },
  { id: 'graciosa', color: '#c5e9b1', frequency: 880, pattern: [20, 45, 20, 45, 20], waveform: 'sine', center: [826, 107], vertices: [[817, 96], [832, 94], [841, 104], [834, 118], [820, 119], [812, 108]], ridge: 'M821 103 829 108 833 105' },
];
const teideShape = [[410, 291], [423, 314], [397, 314]];
const islandSignals = [
  ...islandShapes.map(({ center, vertices, ridge, ...island }) => ({ ...island, point: xy(center) })),
  { id: 'teide', color: '#ffe0a4', pattern: [25, 35, 25, 35, 150], frequency: 1046, waveform: 'sine', point: xy([410, 306]) },
];

const islandSVG = label => `
<defs>
  <radialGradient id="islands-ocean" cx="52%" cy="45%" r="72%"><stop stop-color="#123c3c" stop-opacity=".68"/><stop offset="1" stop-color="#092620" stop-opacity=".2"/></radialGradient>
  <pattern id="islands-grid" width="60" height="60" patternUnits="userSpaceOnUse"><path d="M60 0H0V60" fill="none" stroke="#64a69e" stroke-opacity=".09" stroke-width=".8"/><circle cx="0" cy="0" r="1.3" fill="#7cb9ad" fill-opacity=".18"/></pattern>
</defs>
<g ${diagramType}>
  <rect x="20" y="20" width="960" height="600" rx="26" fill="url(#islands-ocean)"/>
  <rect x="20" y="20" width="960" height="600" rx="26" fill="url(#islands-grid)"/>
  <g fill="none" stroke="#4c9c91" stroke-opacity=".12" stroke-width="1">
    <path d="M38 274c87-83 148-83 218-2s146 95 222 51 126-83 183-56 93 70 174 49 104-47 135-38"/>
    <path d="M33 299c87-83 148-83 218-2s146 95 222 51 126-83 183-56 93 70 174 49 104-47 135-38"/>
    <path d="M28 324c87-83 148-83 218-2s146 95 222 51 126-83 183-56 93 70 174 49 104-47 135-38"/>
    <path d="M23 349c87-83 148-83 218-2s146 95 222 51 126-83 183-56 93 70 174 49 104-47 135-38"/>
    <path d="M18 374c87-83 148-83 218-2s146 95 222 51 126-83 183-56 93 70 174 49 104-47 135-38"/>
  </g>
  <g opacity=".28" stroke="#81bdae" fill="none" stroke-width="1.2" stroke-dasharray="2 8">
    <path d="M170 222 294 366M171 451 293 385M333 367 377 319M436 316 561 403M624 396 776 321M793 276 838 218M836 131 831 119"/>
  </g>
  ${islandShapes.map(island => `
  <g data-region="${island.id}">
    <polygon points="${points(island.vertices)}" transform="translate(0 8)" fill="#000" opacity=".25"/>
    <polygon points="${points(island.vertices)}" fill="${island.color}" fill-opacity=".18" stroke="${island.color}" stroke-width="3" stroke-linejoin="round"/>
    <path d="${island.ridge}" fill="none" stroke="${island.color}" stroke-opacity=".48" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`).join('')}
  <g data-region="teide">
    <circle cx="410" cy="306" r="24" fill="#ffe0a4" fill-opacity=".07"/>
    <polygon points="${points(teideShape)}" fill="#e7b974" stroke="#ffe9ba" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="m410 291 6 10-6-3-6 3z" fill="#fff3d4"/>
  </g>
  <g fill="none" stroke="#94c8b5" stroke-opacity=".5" stroke-width="1.2">
    <path d="M143 165 125 138H66"/><circle cx="143" cy="165" r="3" fill="#8ae4b5"/>
    <path d="M148 471 129 515H64"/><circle cx="148" cy="471" r="3" fill="#6ac5b8"/>
    <path d="M306 394 294 429H241"/><circle cx="306" cy="394" r="3" fill="#b3d58c"/>
    <path d="M399 278 393 244H348"/><circle cx="399" cy="278" r="3" fill="#55dbb7"/>
    <path d="M416 302 460 287H491"/><circle cx="416" cy="302" r="2" fill="#ffe0a4"/>
    <path d="M592 459 592 497H542"/><circle cx="592" cy="459" r="3" fill="#93e3dc"/>
    <path d="M817 352 854 371H947"/><circle cx="817" cy="352" r="3" fill="#e3ca8d"/>
    <path d="M860 164 891 152H947"/><circle cx="860" cy="164" r="3" fill="#dcad8a"/>
    <path d="M823 95 806 72H712"/><circle cx="823" cy="95" r="3" fill="#c5e9b1"/>
  </g>
  <g ${labelStyle}>
    <text x="66" y="120" fill="#b4f1cf">${xml(label.palma)}</text>
    <text x="64" y="538" fill="#a1dcd3">${xml(label.hierro)}</text>
    <text x="241" y="452" fill="#d0e7b3">${xml(label.gomera)}</text>
    <text x="348" y="227" fill="#8af0d2">${xml(label.tenerife)}</text>
    <text x="542" y="520" fill="#b5f0e9">${xml(label.grancanaria)}</text>
    <text x="947" y="394" text-anchor="end" fill="#f2ddb1">${xml(label.fuerteventura)}</text>
    <text x="947" y="136" text-anchor="end" fill="#ecc6ae">${xml(label.lanzarote)}</text>
    <text x="712" y="56" fill="#e0f3d1">${xml(label.graciosa)}</text>
    <text x="460" y="277" fill="#ffe0a4" font-size="11">${xml(label.teide)}</text>
  </g>
  <g ${fineStyle} fill="#76a59a">
    <text x="66" y="157">${xml(label.west)}</text>
    <text x="542" y="540">${xml(label.centre)}</text>
    <text x="947" y="413" text-anchor="end">${xml(label.east)}</text>
  </g>
  <g transform="translate(83 65)" stroke="#8dbdab" fill="none" stroke-width="1.2" opacity=".7"><path d="M0 41V7m-5 6 5-8 5 8"/><path d="M-5 33H5"/><text x="0" y="-3" text-anchor="middle" stroke="none" fill="#8dbdab" ${monoType} font-size="10">${xml(label.north)}</text></g>
  <text x="46" y="588" ${monoType} fill="#7bb7a0" font-size="11" letter-spacing="2.8">${xml(label.ocean)}</text>
  <text x="954" y="588" text-anchor="end" ${monoType} fill="#71998d" font-size="9" letter-spacing=".8">${xml(label.schematic)}</text>
  <text x="954" y="604" text-anchor="end" ${monoType} fill="#71998d" font-size="9" letter-spacing=".8">${xml(label.scale)}</text>
</g>`;

function buildIslands(text) {
  const regions = localize(islandSignals, text.regions);
  const region = byId(regions);
  function sample(x, y) {
    const position = coordinates(x, y);
    if (!position) return null;
    const [px, py] = position;
    if (inPolygon(px, py, teideShape)) return signal(region.teide, x, 0.36);
    for (const shape of islandShapes) {
      if (inPolygon(px, py, shape.vertices) || polylineDistance(px, py, shape.vertices, true) <= 1.5) {
        return signal(region[shape.id], x, 0.27);
      }
    }
    return null;
  }
  return {
    id: 'islands', category: text.category, shortTitle: text.shortTitle, title: text.title, subtitle: text.subtitle,
    description: text.description, task: text.task, guide: text.guide,
    svg: islandSVG(text.svg), regions, sample,
    // Mount Teide is part of Tenerife, so it also answers "find Tenerife".
    missions: missionList(text.missions, [
      { id: 'tenerife', targets: ['tenerife', 'teide'], points: [[378, 320]] },
      { id: 'teide', targets: ['teide'], points: [[410, 306]] },
      { id: 'hierro', targets: ['hierro'], points: [[153, 456]] },
    ]),
    tour: [
      { ...xy([151, 217]), duration: 1300 }, { ...xy([153, 456]), duration: 1300 },
      { ...xy([310, 372]), duration: 1300 }, { ...xy([395, 312]), duration: 1500 },
      { ...xy([410, 306]), duration: 1700 }, { ...xy([591, 417]), duration: 1300 },
      { ...xy([792, 310]), duration: 1300 }, { ...xy([845, 182]), duration: 1300 },
      { ...xy([826, 107]), duration: 1600 },
    ],
  };
}

// ———————————————————————————————— ECONOMY ————————————————————————————————

const supplyLine = [[190, 480], [810, 140]];
const demandLine = [[190, 140], [810, 480]];
const equilibrium = [500, 310];
// Guide points along a curve, away from the crossing, where the equilibrium answers instead.
const alongCurve = ([[x1, y1], [x2, y2]]) => [0.08, 0.2, 0.32, 0.68, 0.8, 0.92]
  .map(k => [x1 + (x2 - x1) * k, y1 + (y2 - y1) * k]);
const economySignals = [
  { id: 'supply', color: '#69e3b4', pattern: [40, 45, 75], frequency: 380, waveform: 'triangle', point: xy([686, 208]) },
  { id: 'demand', color: '#c4a3ff', pattern: [90, 75, 35], frequency: 300, waveform: 'sine', point: xy([314, 208]) },
  { id: 'equilibrium', color: '#ffda94', pattern: [45, 45, 45, 80, 150], frequency: 660, waveform: 'sine', point: xy(equilibrium) },
  { id: 'price', color: '#9cbdb0', pattern: [25, 90, 25], frequency: 190, waveform: 'sine', point: xy([140, 210]) },
  { id: 'quantity', color: '#9cbdb0', pattern: [35, 65, 35], frequency: 230, waveform: 'triangle', point: xy([700, 520]) },
];

const economySVG = label => `
<defs>
  <linearGradient id="economy-plot" x2="0" y2="1"><stop stop-color="#174139" stop-opacity=".25"/><stop offset="1" stop-color="#173c33" stop-opacity=".02"/></linearGradient>
  <linearGradient id="economy-supply" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#32a486"/><stop offset="1" stop-color="#91f5c7"/></linearGradient>
  <linearGradient id="economy-demand" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#dfc3ff"/><stop offset="1" stop-color="#9079cf"/></linearGradient>
</defs>
<g ${diagramType}>
  <rect x="140" y="100" width="740" height="420" rx="12" fill="url(#economy-plot)"/>
  <g stroke="#75b29a" stroke-opacity=".11" stroke-width="1">
    <path d="M140 170H880M140 240H880M140 310H880M140 380H880M140 450H880"/>
    <path d="M230 100V520M320 100V520M410 100V520M500 100V520M590 100V520M680 100V520M770 100V520M860 100V520"/>
  </g>
  <g fill="none" stroke="#ffda94" stroke-width="1.6" stroke-dasharray="5 7" stroke-opacity=".63">
    <path d="M140 310H500V520"/>
  </g>
  <g data-region="price" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M140 520V100" stroke="#9cbdb0" stroke-opacity=".07" stroke-width="20"/>
    <path d="M140 520V100m-6 10 6-10 6 10" stroke="#9cbdb0" stroke-width="2"/>
  </g>
  <g data-region="quantity" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M140 520H890" stroke="#9cbdb0" stroke-opacity=".07" stroke-width="20"/>
    <path d="M140 520H890m-10-6 10 6-10 6" stroke="#9cbdb0" stroke-width="2"/>
  </g>
  <g stroke="#85af9e" stroke-width="1.5" stroke-opacity=".55">
    <path d="M134 170h6M134 240h6M134 380h6M134 450h6M230 520v6M320 520v6M410 520v6M590 520v6M680 520v6M770 520v6M860 520v6"/>
  </g>
  <g data-region="supply" fill="none" stroke-linecap="round">
    <polyline points="${points(supplyLine)}" stroke="#69e3b4" stroke-opacity=".08" stroke-width="28"/>
    <polyline points="${points(supplyLine)}" stroke="url(#economy-supply)" stroke-width="7"/>
    <polyline points="${points(supplyLine)}" stroke="#c8ffe0" stroke-opacity=".38" stroke-width="1.5"/>
  </g>
  <g data-region="demand" fill="none" stroke-linecap="round">
    <polyline points="${points(demandLine)}" stroke="#c4a3ff" stroke-opacity=".09" stroke-width="28"/>
    <polyline points="${points(demandLine)}" stroke="url(#economy-demand)" stroke-width="7"/>
    <polyline points="${points(demandLine)}" stroke="#f5e6ff" stroke-opacity=".36" stroke-width="1.5"/>
  </g>
  <g data-region="equilibrium">
    <circle cx="500" cy="310" r="27" fill="#173e34" stroke="#ffda94" stroke-opacity=".8" stroke-width="1.6"/>
    <circle cx="500" cy="310" r="18" fill="#ffda94" fill-opacity=".13"/>
    <circle cx="500" cy="310" r="7" fill="#ffe5af" stroke="#fff4d8" stroke-width="1.5"/>
    <path d="M500 280v-6M500 340v6M470 310h-6M530 310h6" stroke="#ffda94" stroke-opacity=".6" stroke-width="1.4"/>
  </g>
  <!-- The label sits in the open wedge right of the crossing, clear of both curves. -->
  <g fill="none" stroke="#ffda94" stroke-opacity=".6" stroke-width="1.2"><path d="M523 296H552"/><circle cx="523" cy="296" r="2" fill="#ffda94"/></g>
  <g ${labelStyle}>
    <text x="190" y="105" fill="#dac1ff">${xml(label.demand)}</text>
    <text x="810" y="105" text-anchor="end" fill="#92f1c7">${xml(label.supply)}</text>
    <text x="560" y="300" fill="#ffe2a9">${xml(label.equilibrium)}</text>
  </g>
  <g ${fineStyle}>
    <text x="190" y="124" fill="#a597bd">${xml(label.demandNote)}</text>
    <text x="810" y="124" text-anchor="end" fill="#79bba0">${xml(label.supplyNote)}</text>
    <text x="560" y="326" fill="#bba981">${xml(label.equilibriumNote)}</text>
  </g>
  <g ${monoType} font-size="14" fill="#ffe0a0">
    <text x="116" y="315" text-anchor="end">P*</text>
    <text x="500" y="549" text-anchor="middle">Q*</text>
  </g>
  <g fill="#b6d1c1" font-size="14" font-weight="550">
    <text x="78" y="316" text-anchor="middle" transform="rotate(-90 78 316)">${xml(label.price)}</text>
    <text x="879" y="564" text-anchor="end">${xml(label.quantity)}</text>
  </g>
  <text x="125" y="545" text-anchor="end" ${monoType} font-size="11" fill="#72998a">0</text>
  <rect x="189" y="573" width="358" height="32" rx="16" fill="#4c8060" fill-opacity=".08" stroke="#6baf8e" stroke-opacity=".17"/>
  <circle cx="208" cy="589" r="3" fill="#69e3b4"/>
  <text x="221" y="593" font-size="11" fill="#93b2a1">${xml(label.hint)}</text>
  <text x="883" y="601" text-anchor="end" ${monoType} font-size="9" letter-spacing=".8" fill="#71998d">${xml(label.scale)}</text>
</g>`;

function buildEconomy(text) {
  const regions = localize(economySignals, text.regions);
  const region = byId(regions);
  function sample(x, y) {
    const position = coordinates(x, y);
    if (!position) return null;
    const [px, py] = position;
    if (Math.hypot(px - equilibrium[0], py - equilibrium[1]) <= 27) return signal(region.equilibrium, x, 0.35);
    const supplyDistance = polylineDistance(px, py, supplyLine);
    const demandDistance = polylineDistance(px, py, demandLine);
    if (Math.min(supplyDistance, demandDistance) <= 14) {
      const curve = supplyDistance <= demandDistance ? region.supply : region.demand;
      const distance = Math.min(supplyDistance, demandDistance);
      // Pitch follows height (price), while timbre identifies the curve.
      const pitch = curve.frequency * 2 ** ((310 - py) / 420);
      return signal(curve, x, 0.17 + 0.13 * (1 - distance / 14), pitch);
    }
    if (segmentDistance(px, py, [140, 100], [140, 520]) <= 10) return signal(region.price, x, 0.15);
    if (segmentDistance(px, py, [140, 520], [890, 520]) <= 10) return signal(region.quantity, x, 0.15);
    return null;
  }
  return {
    id: 'economy', category: text.category, shortTitle: text.shortTitle, title: text.title, subtitle: text.subtitle,
    description: text.description, task: text.task, guide: text.guide,
    svg: economySVG(text.svg), regions, sample,
    missions: missionList(text.missions, [
      { id: 'demand', targets: ['demand'], points: alongCurve(demandLine) },
      { id: 'supply', targets: ['supply'], points: alongCurve(supplyLine) },
      { id: 'equilibrium', targets: ['equilibrium'], points: [equilibrium] },
    ]),
    tour: [
      { ...xy([140, 210]), duration: 1200 }, { ...xy([700, 520]), duration: 1200 },
      { ...xy([221, 463]), duration: 800 }, { ...xy([345, 395]), duration: 800 },
      { ...xy([500, 310]), duration: 1700 }, { ...xy([655, 225]), duration: 800 },
      { ...xy([779, 157]), duration: 800 }, { ...xy([221, 157]), duration: 1000 },
      { ...xy([345, 225]), duration: 800 }, { ...xy([500, 310]), duration: 1700 },
      { ...xy([655, 395]), duration: 800 }, { ...xy([779, 463]), duration: 800 },
    ],
  };
}

/** A fresh set of the three example scenes in the given language. */
export function createScenes(language = getLanguage()) {
  const text = TEXT[normalizeLanguage(language) ?? DEFAULT_LANGUAGE];
  return [buildCell(text.cell), buildIslands(text.islands), buildEconomy(text.economy)];
}

/** The scenes in the page language. app.js adds the Studio scene to this list. */
export const scenes = createScenes();
