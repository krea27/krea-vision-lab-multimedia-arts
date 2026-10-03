/**
 * KREA VISION LAB · STUDIO MULTIVIEW PRO
 * Consola VJ Profesional con Monitoreo en Vivo Cuádruple (4 Pantallas en Miniatura)
 * y Deck de Procesamiento Completo de Ancho Total en la Mitad Inferior.
 */

// Opciones de resolución de simulación para cada monitor
const SIM_COLS = 160;
const SIM_ROWS = 90;

// Gráficos y Buffers de Simulación independientes para Cámara y Video
let cameraFeedGfx = null;
let cameraFeedData = null;
let videoFeedGfx = null;
let videoFeedData = null;

// Modo de visualización: false = 4 Pantallas Cuádruple (Multiview), true = Pantalla Individual Expandida (Solo View)
let isSoloViewMode = false;

// =========================================================================
// SINCRONIZACIÓN PERSISTENTE DE VIDEO VÍA INDEXEDDB
// =========================================================================
const DB_NAME = 'krea_vision_db';
const STORE_NAME = 'media_store';

function openMediaDB() {
  return new Promise((resolve, reject) => {
    let req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      let db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveVideoToDB(blob, name) {
  try {
    let db = await openMediaDB();
    let tx = db.transaction(STORE_NAME, 'readwrite');
    let store = tx.objectStore(STORE_NAME);
    store.put(blob, 'custom_video_blob');
    store.put(name, 'custom_video_name');
    tx.oncomplete = () => {
      if (vjChannel) {
        vjChannel.postMessage({
          type: 'VIDEO_FILE_UPDATED',
          videoName: name,
          timestamp: Date.now()
        });
      }
    };
  } catch (err) {
    console.warn("Error guardando video en DB:", err);
  }
}

async function loadVideoFromDB(callback) {
  try {
    let db = await openMediaDB();
    let tx = db.transaction(STORE_NAME, 'readonly');
    let store = tx.objectStore(STORE_NAME);
    let reqBlob = store.get('custom_video_blob');
    let reqName = store.get('custom_video_name');
    tx.oncomplete = () => {
      if (reqBlob.result) {
        callback(reqBlob.result, reqName.result || 'Video');
      }
    };
  } catch (err) {
    console.warn("Error leyendo video de DB:", err);
  }
}

let lastUploadedImagesData = null;

async function saveImagesToDB(items) {
  try {
    let db = await openMediaDB();
    let tx = db.transaction(STORE_NAME, 'readwrite');
    let store = tx.objectStore(STORE_NAME);
    store.put(items, 'custom_images_list');
    tx.oncomplete = () => {
      lastUploadedImagesData = items;
      if (vjChannel) {
        try {
          vjChannel.postMessage({
            type: 'IMAGES_UPDATED',
            images: items,
            count: items.length,
            timestamp: Date.now()
          });
        } catch (postErr) {
          console.warn("Payload grande para BroadcastChannel, enviando señal simple:", postErr);
          vjChannel.postMessage({
            type: 'IMAGES_UPDATED',
            count: items.length,
            timestamp: Date.now()
          });
        }
      }
      console.log(`Galería de ${items.length} fotos guardada en DB y transmitida.`);
    };
    tx.onerror = (e) => console.warn("Error en tx IndexedDB:", e);
  } catch (err) {
    console.warn("Error guardando imágenes en DB:", err);
  }
}

async function loadImagesFromDB(callback) {
  try {
    let db = await openMediaDB();
    let tx = db.transaction(STORE_NAME, 'readonly');
    let store = tx.objectStore(STORE_NAME);
    let req = store.get('custom_images_list');
    let delivered = false;
    req.onsuccess = () => {
      if (!delivered && req.result && Array.isArray(req.result) && req.result.length > 0) {
        delivered = true;
        lastUploadedImagesData = req.result;
        callback(req.result);
      }
    };
    tx.oncomplete = () => {
      if (!delivered && req.result && Array.isArray(req.result) && req.result.length > 0) {
        delivered = true;
        lastUploadedImagesData = req.result;
        callback(req.result);
      }
    };
  } catch (err) {
    console.warn("Error leyendo imágenes de DB:", err);
  }
}

async function clearImagesFromDB() {
  try {
    let db = await openMediaDB();
    let tx = db.transaction(STORE_NAME, 'readwrite');
    let store = tx.objectStore(STORE_NAME);
    store.delete('custom_images_list');
    lastUploadedImagesData = null;
    console.log("Galería personalizada eliminada de IndexedDB. Fotos botánicas base activas.");
  } catch (err) {
    console.warn("Error borrando imágenes de DB:", err);
  }
}

async function resetToBotanicalGallery() {
  await clearImagesFromDB();
  imagesList = [];
  for (let i = 0; i < rawImages.length; i++) {
    let img = rawImages[i];
    if (img && img.width > 1) {
      addLoadedImage(img, `Foto ${i + 1}`);
    }
  }
  if (imagesList.length === 0) {
    generateProceduralDefaults();
  }
  for (let ch = 1; ch <= 4; ch++) {
    seedChannel(ch, 0, imagesList.length > 1 ? 1 : 0);
  }
  updateBadge();
  if (vjChannel) {
    vjChannel.postMessage({
      type: 'RESET_GALLERY',
      timestamp: Date.now()
    });
  }
  showMidiHUD("Fotos Botánicas Restauradas");
}

function applyLoadedGalleryData(items) {
  if (!items || items.length === 0) return;
  let newImages = [];
  let loadedCount = 0;
  for (let item of items) {
    loadImage(item.dataUrl, (p5Img) => {
      newImages.push({
        name: item.name,
        sourceImg: p5Img,
        data: resampleP5Image(p5Img)
      });
      loadedCount++;
      if (loadedCount === items.length) {
        imagesList = newImages;
        for (let ch = 1; ch <= 4; ch++) {
          seedChannel(ch, 0, imagesList.length > 1 ? 1 : 0);
        }
        updateBadge();
        console.log(`Galería de fotos restaurada desde DB: ${loadedCount} fotos`);
      }
    });
  }
}

// Selección de las 3 imágenes botánicas base
const LOCAL_IMAGE_PATHS = [
  'img/1.png',
  'img/6.png',
  'img/3.png'
];

let rawImages = [];
let imagesList = [];

// Fuentes multimedia
let videoCapture = null;
let cameraReady = false;
let isCameraStarting = false;
let videoPlayer = null;
let videoReady = false;
let videoName = 'Ninguno';

// Efectos de Rendimiento en Vivo Globales / Momentáneos (Punch-in MIDI)
let isGlitchActive = false;
let isFreezeActive = false;
let pitchBendWarpOffset = 0.0;

// Presets de Tinte Cromático para cambio rápido vía MIDI (Teclas 10, 11, 12)
const TINT_PRESETS = [
  { label: 'Neutro (0°)', angle: 0 },
  { label: 'Ámbar Cálido (30°)', angle: 30 },
  { label: 'Dorado Lima (65°)', angle: 65 },
  { label: 'Esmeralda (120°)', angle: 120 },
  { label: 'Cian Eléctrico (180°)', angle: 180 },
  { label: 'Azul Cobalto (225°)', angle: 225 },
  { label: 'Púrpura Violeta (270°)', angle: 270 },
  { label: 'Magenta Fucsia (310°)', angle: 310 },
  { label: 'Rubí Carmín (345°)', angle: 345 }
];
let currentTintPresetIndex = 0;

// Modos de Color y Shaders
const COLOR_MODES = [
  'RGB Original',
  'Mapa de Calor',
  'Neón Ciber',
  'B&N Fotocopia',
  'B&N Orgánico',
  'Invertido / Rayos X'
];

// Presets de simulación
const FUSION_PRESETS = [
  { label: '0%', val: 0.0 },
  { label: '40%', val: 0.40 },
  { label: '70%', val: 0.70 },
  { label: '100%', val: 1.0 }
];
let currentFusionIndex = 0;

const TRAIL_PRESETS = [
  { label: 'Normal (1.1)', decay: 1.1 },
  { label: 'Larga (0.50)', decay: 0.50 },
  { label: 'Ultra (0.18)', decay: 0.18 },
  { label: 'Eco (0.04)', decay: 0.04 }
];
let currentTrailIndex = 0;

const ZOOM_PRESETS = [
  { label: '1.0x', factor: 1.0 },
  { label: '1.4x', factor: 1.4 },
  { label: '2.0x', factor: 2.0 },
  { label: '3.0x', factor: 3.0 }
];
let currentZoomIndex = 0;

const BRUSH_PRESETS = [
  { label: '20px', radius: 20 },
  { label: '50px', radius: 50 },
  { label: '100px', radius: 100 },
  { label: '180px', radius: 180 }
];
let currentBrushIndex = 1;

const WAVE_PRESETS = [
  { label: '0%', val: 0.0 },
  { label: '35%', val: 0.35 },
  { label: '70%', val: 0.70 },
  { label: '100%', val: 1.0 }
];
let currentWaveIndex = 0;

const RESOLUTION_MODES = [
  { val: 2, label: '2px' },
  { val: 3, label: '3px' },
  { val: 1, label: '1px' }
];
let currentResIndex = 0;

// =========================================================================
// BANCO DE MEMORIA INDEPENDIENTE POR CANAL (P1, P2, P3, P4)
// =========================================================================
const channelStates = {
  1: {
    name: 'P1 (Fotos)',
    source: 'IMAGENES',
    mode: 0,           // RGB Original
    tint: 0,           // Neutro
    lastActiveTint: 180,
    wave: 0.0,
    zoom: 1.0,
    fusion: 0.0,
    trail: 1.1,
    shutter: 0.0,
    aspect: 0.0,
    glitch: 0.0,
    vintageDirt: 0.0,
    vintageTone: 0.0,
    vintage: false,
    red: false,
    warp: 1.0,
    brush: 50,
    paused: false,
    typewriterText: '',
    typewriterDisplay: '',
    typewriterIndex: 0,
    typewriterActive: false,
    typewriterStyle: 'box-black',
    cycleTimer: 0,
    cycleDuration: 6.0,
    currentIndex: 0,
    nextIndex: 1,
    wavePhase: 0.0,
    currentZoomDisplay: 1.0,
    gridR: new Float32Array(SIM_COLS * SIM_ROWS),
    nextR: new Float32Array(SIM_COLS * SIM_ROWS),
    gridG: new Float32Array(SIM_COLS * SIM_ROWS),
    nextG: new Float32Array(SIM_COLS * SIM_ROWS),
    gridB: new Float32Array(SIM_COLS * SIM_ROWS),
    nextB: new Float32Array(SIM_COLS * SIM_ROWS),
    historyR: new Float32Array(SIM_COLS * SIM_ROWS),
    historyG: new Float32Array(SIM_COLS * SIM_ROWS),
    historyB: new Float32Array(SIM_COLS * SIM_ROWS),
    caImage: null
  },
  2: {
    name: 'P2 (Cámara)',
    source: 'CAMARA',
    mode: 1,           // Mapa de Calor Térmico (FLIR)
    tint: 180,         // Cian Eléctrico
    lastActiveTint: 180,
    wave: 0.25,
    zoom: 1.0,
    fusion: 0.0,
    trail: 1.1,
    shutter: 0.0,
    aspect: 0.0,
    glitch: 0.0,
    vintageDirt: 0.0,
    vintageTone: 0.0,
    vintage: false,
    red: false,
    warp: 1.0,
    brush: 50,
    paused: false,
    typewriterText: '',
    typewriterDisplay: '',
    typewriterIndex: 0,
    typewriterActive: false,
    typewriterStyle: 'box-black',
    cycleTimer: 0,
    cycleDuration: 6.0,
    currentIndex: 0,
    nextIndex: 1,
    wavePhase: 0.0,
    currentZoomDisplay: 1.0,
    gridR: new Float32Array(SIM_COLS * SIM_ROWS),
    nextR: new Float32Array(SIM_COLS * SIM_ROWS),
    gridG: new Float32Array(SIM_COLS * SIM_ROWS),
    nextG: new Float32Array(SIM_COLS * SIM_ROWS),
    gridB: new Float32Array(SIM_COLS * SIM_ROWS),
    nextB: new Float32Array(SIM_COLS * SIM_ROWS),
    historyR: new Float32Array(SIM_COLS * SIM_ROWS),
    historyG: new Float32Array(SIM_COLS * SIM_ROWS),
    historyB: new Float32Array(SIM_COLS * SIM_ROWS),
    caImage: null
  },
  3: {
    name: 'P3 (Video)',
    source: 'VIDEO',
    mode: 3,           // B&N Fotocopia Xerox
    tint: 310,         // Risografía Magenta
    lastActiveTint: 310,
    wave: 0.0,
    zoom: 1.0,
    fusion: 0.0,
    trail: 0.5,
    shutter: 0.0,
    aspect: 0.0,
    glitch: 0.0,
    vintageDirt: 0.0,
    vintageTone: 0.0,
    vintage: false,
    red: false,
    warp: 1.0,
    brush: 50,
    paused: false,
    typewriterText: '',
    typewriterDisplay: '',
    typewriterIndex: 0,
    typewriterActive: false,
    typewriterStyle: 'box-black',
    cycleTimer: 0,
    cycleDuration: 6.0,
    currentIndex: 0,
    nextIndex: 1,
    wavePhase: 0.0,
    currentZoomDisplay: 1.0,
    gridR: new Float32Array(SIM_COLS * SIM_ROWS),
    nextR: new Float32Array(SIM_COLS * SIM_ROWS),
    gridG: new Float32Array(SIM_COLS * SIM_ROWS),
    nextG: new Float32Array(SIM_COLS * SIM_ROWS),
    gridB: new Float32Array(SIM_COLS * SIM_ROWS),
    nextB: new Float32Array(SIM_COLS * SIM_ROWS),
    historyR: new Float32Array(SIM_COLS * SIM_ROWS),
    historyG: new Float32Array(SIM_COLS * SIM_ROWS),
    historyB: new Float32Array(SIM_COLS * SIM_ROWS),
    caImage: null
  },
  4: {
    name: 'P4 (Fusión)',
    source: 'IMAGENES',
    mode: 5,           // Rayos X
    tint: 65,          // Dorado Lima
    lastActiveTint: 65,
    wave: 0.0,
    zoom: 1.0,
    fusion: 0.65,
    trail: 1.1,
    shutter: 0.0,
    aspect: 0.0,
    glitch: 0.0,
    vintageDirt: 0.0,
    vintageTone: 0.0,
    vintage: false,
    red: false,
    warp: 1.0,
    brush: 50,
    paused: false,
    typewriterText: '',
    typewriterDisplay: '',
    typewriterIndex: 0,
    typewriterActive: false,
    typewriterStyle: 'box-black',
    cycleTimer: 0,
    cycleDuration: 6.0,
    currentIndex: 0,
    nextIndex: 1,
    wavePhase: 0.0,
    currentZoomDisplay: 1.0,
    gridR: new Float32Array(SIM_COLS * SIM_ROWS),
    nextR: new Float32Array(SIM_COLS * SIM_ROWS),
    gridG: new Float32Array(SIM_COLS * SIM_ROWS),
    nextG: new Float32Array(SIM_COLS * SIM_ROWS),
    gridB: new Float32Array(SIM_COLS * SIM_ROWS),
    nextB: new Float32Array(SIM_COLS * SIM_ROWS),
    historyR: new Float32Array(SIM_COLS * SIM_ROWS),
    historyG: new Float32Array(SIM_COLS * SIM_ROWS),
    historyB: new Float32Array(SIM_COLS * SIM_ROWS),
    caImage: null
  }
};

let activeChannel = 1; // Default P1 (Fotos) para control directo e individual sin sobreescrituras globales
let vjChannel = null;

// =========================================================================
// AUDIO INTERACTIVO FX (Lista de canciones)
// =========================================================================
const LOCAL_AUDIO_PATHS = [
  { name: 'Dark Drone', path: 'sonido/dark.wav' }
];
let audioList = [];
let currentAudioIndex = 0;
let soundEnabled = true;
let masterVolume = 0.8;
let audioPitchSemitones = 0;   // Transposición de -12 a +12 semitonos
let audioPlaybackRate = 1.0;    // Velocidad de reproducción de 0.25x a 2.0x

// =========================================================================
// TABLA PRECALCULADA (LUT) PARA ONDAS SUAVES
// =========================================================================
const LUT_SIZE = 1024;
const LUT_SMOOTH_FOLD = new Float32Array(LUT_SIZE);
(function buildLUT() {
  for (let i = 0; i < LUT_SIZE; i++) {
    let m = i % 512;
    let tri = m < 256 ? m : 512 - m;
    let n = tri * 0.0039215686;
    LUT_SMOOTH_FOLD[i] = (n * n * (3.0 - 2.0 * n)) * 255.0;
  }
})();

// TABLA PRECALCULADA (LUT) PARA MAPA DE CALOR TÉRMICO (FLIR)
const HEATMAP_LUT_R = new Uint8Array(256);
const HEATMAP_LUT_G = new Uint8Array(256);
const HEATMAP_LUT_B = new Uint8Array(256);
(function buildHeatmapLUT() {
  for (let i = 0; i < 256; i++) {
    let t = i / 255.0;
    let r, g, b;
    if (t < 0.20) {
      let f = t / 0.20;
      r = Math.floor(4 * (1 - f) + 0 * f);
      g = Math.floor(10 * (1 - f) + 120 * f);
      b = Math.floor(55 * (1 - f) + 255 * f);
    } else if (t < 0.45) {
      let f = (t - 0.20) / 0.25;
      r = Math.floor(0 * (1 - f) + 20 * f);
      g = Math.floor(120 * (1 - f) + 240 * f);
      b = Math.floor(255 * (1 - f) + 40 * f);
    } else if (t < 0.70) {
      let f = (t - 0.45) / 0.25;
      r = Math.floor(20 * (1 - f) + 255 * f);
      g = Math.floor(240 * (1 - f) + 210 * f);
      b = Math.floor(40 * (1 - f) + 0 * f);
    } else if (t < 0.88) {
      let f = (t - 0.70) / 0.18;
      r = 255;
      g = Math.floor(210 * (1 - f) + 20 * f);
      b = 0;
    } else {
      let f = (t - 0.88) / 0.12;
      r = 255;
      g = Math.floor(20 * (1 - f) + 255 * f);
      b = Math.floor(0 * (1 - f) + 255 * f);
    }
    HEATMAP_LUT_R[i] = r;
    HEATMAP_LUT_G[i] = g;
    HEATMAP_LUT_B[i] = b;
  }
})();

// =========================================================================
// BROADCASTCHANNEL: COMUNICACIÓN CON SALIDAS LIMPIAS (RESOLUME / TOUCH)
// =========================================================================
let isRemoteAudioModulating = false;
let remoteAudioTimeout = null;

if (typeof BroadcastChannel !== 'undefined') {
  vjChannel = new BroadcastChannel('vj_multiscreen');
  vjChannel.onmessage = (e) => {
    if (e.data && e.data.type === 'AUDIO_MODULATE') {
      if (e.data.active) {
        isRemoteAudioModulating = true;
        if (remoteAudioTimeout) clearTimeout(remoteAudioTimeout);
        remoteAudioTimeout = setTimeout(() => {
          isRemoteAudioModulating = false;
          handleAudioRelease();
        }, 600);
        modulateAudioFromCoords(e.data.normX, e.data.speed);
      } else {
        isRemoteAudioModulating = false;
        if (remoteAudioTimeout) clearTimeout(remoteAudioTimeout);
        handleAudioRelease();
      }
      return;
    }

    if (e.data && e.data.type === 'SCREEN_ONLINE') {
      let rawId = parseInt(e.data.screenId);
      let sId = isNaN(rawId) ? 0 : rawId;
      showMidiHUD(`Pantalla ${sId === 0 ? 'Auto' : sId} Conectada`);
      syncCurrentStateToChannel(sId);
      if (lastUploadedImagesData && lastUploadedImagesData.length > 0) {
        try {
          vjChannel.postMessage({
            type: 'IMAGES_UPDATED',
            images: lastUploadedImagesData,
            count: lastUploadedImagesData.length,
            timestamp: Date.now()
          });
        } catch (postErr) {
          vjChannel.postMessage({
            type: 'IMAGES_UPDATED',
            count: lastUploadedImagesData.length,
            timestamp: Date.now()
          });
        }
      }
    }
  };
}

function broadcastCommand(action, value) {
  if (!vjChannel) return;
  vjChannel.postMessage({
    targetChannel: activeChannel,
    action: action,
    value: value,
    timestamp: Date.now()
  });
}

function updateChannelParam(paramName, value) {
  if (activeChannel === 0) {
    for (let i = 1; i <= 4; i++) {
      if (channelStates[i]) {
        channelStates[i][paramName] = value;
      }
    }
  } else if (channelStates[activeChannel]) {
    channelStates[activeChannel][paramName] = value;
  }
}

function syncCurrentStateToChannel(targetId) {
  if (!vjChannel) return;
  let rawId = parseInt(targetId);
  let sId = isNaN(rawId) ? 0 : rawId;
  let chForState = (sId === 0) ? (activeChannel || 1) : sId;
  let state = channelStates[chForState];
  if (!state) state = channelStates[1];
  if (!state) return;

  vjChannel.postMessage({ targetChannel: sId, action: 'SOURCE', value: state.source });
  vjChannel.postMessage({ targetChannel: sId, action: 'COLOR_MODE', value: state.mode });
  vjChannel.postMessage({ targetChannel: sId, action: 'TINT_ANGLE', value: state.tint });
  vjChannel.postMessage({ targetChannel: sId, action: 'WAVE_DEFORM', value: state.wave });
  vjChannel.postMessage({ targetChannel: sId, action: 'ZOOM', value: state.zoom });
  vjChannel.postMessage({ targetChannel: sId, action: 'FUSION', value: state.fusion });
  vjChannel.postMessage({ targetChannel: sId, action: 'TRAIL', value: state.trail });
  vjChannel.postMessage({ targetChannel: sId, action: 'SHUTTER', value: state.shutter || 0.0 });
  vjChannel.postMessage({ targetChannel: sId, action: 'ASPECT', value: state.aspect || 0.0 });
  vjChannel.postMessage({ targetChannel: sId, action: 'GLITCH', value: state.glitch || 0.0 });
  vjChannel.postMessage({ targetChannel: sId, action: 'VINTAGE', value: !!state.vintage });
  vjChannel.postMessage({ targetChannel: sId, action: 'VINTAGE_DIRT', value: state.vintageDirt || 0.0 });
  vjChannel.postMessage({ targetChannel: sId, action: 'VINTAGE_TONE', value: state.vintageTone || 0.0 });
  vjChannel.postMessage({ targetChannel: sId, action: 'RED_LIGHT', value: state.red });
  vjChannel.postMessage({ targetChannel: sId, action: 'WARP', value: state.warp });
  vjChannel.postMessage({ targetChannel: sId, action: 'BRUSH', value: state.brush });
  vjChannel.postMessage({
    targetChannel: sId,
    action: 'TYPEWRITER',
    value: {
      text: state.typewriterText || '',
      active: !!state.typewriterActive,
      style: state.typewriterStyle || currentTypewriterStyle || 'box-black'
    }
  });

  if (imagesList && imagesList.length > 0) {
    vjChannel.postMessage({
      targetChannel: sId,
      action: 'PHOTO_INDEX',
      value: { curr: state.currentIndex, next: state.nextIndex }
    });
  }
}

// =========================================================================
// PRELOAD
// =========================================================================
function preload() {
  for (let i = 0; i < LOCAL_AUDIO_PATHS.length; i++) {
    let item = LOCAL_AUDIO_PATHS[i];
    let snd = loadSound(
      item.path,
      () => { updateAudioLabel(); },
      (err) => console.warn(`No se pudo precargar audio ${item.path}`, err)
    );
    audioList.push({ name: item.name, sound: snd });
  }

  for (let i = 0; i < LOCAL_IMAGE_PATHS.length; i++) {
    rawImages[i] = loadImage(
      LOCAL_IMAGE_PATHS[i],
      () => {},
      (err) => console.warn(`No se pudo precargar ${LOCAL_IMAGE_PATHS[i]}`)
    );
  }
}

// =========================================================================
// SETUP
// =========================================================================
function setup() {
  let container = document.getElementById('monitors-canvas-container');
  let w = container ? container.clientWidth : windowWidth;
  let h = container ? container.clientHeight : floor(windowHeight * 0.44);

  let cnv = createCanvas(w, h);
  if (container) cnv.parent('monitors-canvas-container');
  pixelDensity(1);

  // Inicializar imágenes p5.Image para cada uno de los 4 canales
  for (let ch = 1; ch <= 4; ch++) {
    channelStates[ch].caImage = createImage(SIM_COLS, SIM_ROWS);
  }

  initDimensions();

  // Procesar imágenes cargadas
  let loadedCount = 0;
  for (let i = 0; i < rawImages.length; i++) {
    let img = rawImages[i];
    if (img && img.width > 1) {
      let flowerNum = LOCAL_IMAGE_PATHS[i].replace('img/', '').replace('.png', '');
      addLoadedImage(img, `Flor ${flowerNum}`);
      loadedCount++;
    }
  }

  if (loadedCount === 0) {
    generateProceduralDefaults();
  }

  // Sembrar energía inicial en los 4 canales
  for (let ch = 1; ch <= 4; ch++) {
    seedChannel(ch, 0, imagesList.length > 1 ? 1 : 0);
  }

  setupUIEvents();
  setupDragAndDrop();
  initWebMIDI();

  // Restaurar video previamente cargado en la base de datos si existe
  loadVideoFromDB((blob, name) => {
    let blobUrl = URL.createObjectURL(blob);
    videoPlayer = createVideo(blobUrl, () => {
      videoReady = true;
      videoName = name || 'Video';
      videoPlayer.volume(0);
      videoPlayer.loop();
      videoPlayer.hide();
      console.log(`Video restaurado desde DB: ${name}`);
    });
  });

  // Limpiar fotos pesadas anteriores de IndexedDB para arrancar con fotos botánicas base
  clearImagesFromDB();

  // Configurar estado inicial en P1 (Fotos)
  selectChannel(1);
}

function initDimensions() {
  if (cameraFeedGfx) cameraFeedGfx.remove();
  cameraFeedGfx = createGraphics(SIM_COLS, SIM_ROWS);
  cameraFeedGfx.pixelDensity(1);

  cameraFeedData = {
    r: new Float32Array(SIM_COLS * SIM_ROWS),
    g: new Float32Array(SIM_COLS * SIM_ROWS),
    b: new Float32Array(SIM_COLS * SIM_ROWS)
  };

  if (videoFeedGfx) videoFeedGfx.remove();
  videoFeedGfx = createGraphics(SIM_COLS, SIM_ROWS);
  videoFeedGfx.pixelDensity(1);

  videoFeedData = {
    r: new Float32Array(SIM_COLS * SIM_ROWS),
    g: new Float32Array(SIM_COLS * SIM_ROWS),
    b: new Float32Array(SIM_COLS * SIM_ROWS)
  };
}

function windowResized() {
  let container = document.getElementById('monitors-canvas-container');
  if (container) {
    resizeCanvas(container.clientWidth, container.clientHeight);
  } else {
    resizeCanvas(windowWidth, floor(windowHeight * 0.44));
  }
}

// =========================================================================
// BUCLE PRINCIPAL (DRAW): SIMULACIÓN Y RENDERIZADO CUÁDRUPLE (MULTIVIEW)
// =========================================================================
function draw() {
  let dt = min(deltaTime / 1000, 0.1);

  // 1. Actualizar fuentes de entrada (Cámara y Video de forma estrictamente independiente)
  let needsCamera = false;
  let needsVideo = false;
  for (let ch = 1; ch <= 4; ch++) {
    if (channelStates[ch].source === 'CAMARA') needsCamera = true;
    if (channelStates[ch].source === 'VIDEO') needsVideo = true;
  }

  // Actualizar buffer de cámara si se requiere y está lista
  if (needsCamera && cameraReady && videoCapture) {
    updateMediaFeedData(videoCapture, cameraFeedGfx, cameraFeedData);
  }

  // Actualizar buffer de video de forma totalmente independiente
  if (needsVideo) {
    if (videoReady && videoPlayer) {
      updateMediaFeedData(videoPlayer, videoFeedGfx, videoFeedData);
    }
  }

  // 2. Simular y Renderizar cada uno de los 4 canales independientes
  for (let ch = 1; ch <= 4; ch++) {
    let state = channelStates[ch];
    state.wavePhase += dt * 4.5;

    // Actualizar ciclo de fotos si la fuente es imágenes
    if (!state.paused && imagesList.length > 0 && state.source === 'IMAGENES') {
      state.cycleTimer += dt;
      if (imagesList.length > 1 && state.cycleTimer >= state.cycleDuration) {
        state.cycleTimer = 0;
        state.currentIndex = state.nextIndex;
        state.nextIndex = (state.nextIndex + 1) % imagesList.length;
      }
    }

    let progress = 0;
    if (state.source === 'IMAGENES') {
      if (imagesList.length > 1) {
        progress = state.cycleTimer / state.cycleDuration;
      } else if (imagesList.length === 1) {
        progress = (sin(state.cycleTimer * 1.5) * 0.5 + 0.5) * 0.45;
      }
    }

    // Paso de simulación numérica
    if (!isFreezeActive) {
      stepChannelAutomata(ch, progress);
    }

    // Renderizado de shaders y desplazamiento orgánico
    renderChannelOrganicDisplacement(ch, progress);
  }

  // 3. Renderizar en Canvas: Modo Solo Expandido o Multiview Cuádruple
  background(7, 9, 14);
  smooth();

  if (isSoloViewMode) {
    // Renderizado a pantalla completa del canal seleccionado
    let soloCh = (activeChannel >= 1 && activeChannel <= 4) ? activeChannel : 1;
    let state = channelStates[soloCh];
    let aFit = typeof state.aspect === 'number' ? state.aspect : 0.0;

    let imgAspect = 16.0 / 9.0;
    let boxAspect = width / height;
    let fitW, fitH;
    if (boxAspect > imgAspect) {
      fitH = height;
      fitW = height * imgAspect;
    } else {
      fitW = width;
      fitH = width / imgAspect;
    }
    let drawW = lerp(fitW, width, aFit);
    let drawH = lerp(fitH, height, aFit);
    let drawX = (width - drawW) * 0.5;
    let drawY = (height - drawH) * 0.5;

    image(state.caImage, drawX, drawY, drawW, drawH);
    updateAndDrawTypewriter(state, drawX, drawY, drawW, drawH, false);

    // Marco Neón y esquina tech indicador de pantalla individual expandida
    stroke(56, 189, 248);
    strokeWeight(2);
    noFill();
    rect(drawX, drawY, drawW, drawH);

    stroke(0, 255, 204);
    strokeWeight(4);
    let cLen = 20;
    line(drawX, drawY, drawX + cLen, drawY); line(drawX, drawY, drawX, drawY + cLen);
    line(drawX + drawW, drawY, drawX + drawW - cLen, drawY); line(drawX + drawW, drawY, drawX + drawW, drawY + cLen);
    line(drawX, drawY + drawH, drawX + cLen, drawY + drawH); line(drawX, drawY + drawH, drawX, drawY + drawH - cLen);
    line(drawX + drawW, drawY + drawH, drawX + drawW - cLen, drawY + drawH); line(drawX + drawW, drawY + drawH, drawX + drawW, drawY + drawH - cLen);
  } else {
    // Renderizado Cuádruple Lado a Lado (Multiview estándar)
    let quadW = width / 4;
    let quadH = height;

    for (let ch = 1; ch <= 4; ch++) {
      let qX = (ch - 1) * quadW;
      let state = channelStates[ch];
      let aFit = typeof state.aspect === 'number' ? state.aspect : 0.0;

      let imgAspect = 16.0 / 9.0;
      let boxAspect = quadW / quadH;
      let fitW, fitH;
      if (boxAspect > imgAspect) {
        fitH = quadH;
        fitW = quadH * imgAspect;
      } else {
        fitW = quadW;
        fitH = quadW / imgAspect;
      }
      let drawW = lerp(fitW, quadW, aFit);
      let drawH = lerp(fitH, quadH, aFit);
      let drawX = qX + (quadW - drawW) * 0.5;
      let drawY = (quadH - drawH) * 0.5;

      image(state.caImage, drawX, drawY, drawW, drawH);
      updateAndDrawTypewriter(state, drawX, drawY, drawW, drawH, true);

      // Resaltado de canal activo
      if (activeChannel === ch) {
        stroke(56, 189, 248);
        strokeWeight(3);
        noFill();
        rect(drawX + 1, drawY + 1, drawW - 2, drawH - 2);

        stroke(0, 255, 204);
        strokeWeight(4);
        let cLen = 14;
        line(drawX, drawY, drawX + cLen, drawY); line(drawX, drawY, drawX, drawY + cLen);
        line(drawX + drawW, drawY, drawX + drawW - cLen, drawY); line(drawX + drawW, drawY, drawX + drawW, drawY + cLen);
        line(drawX, drawY + drawH, drawX + cLen, drawY + drawH); line(drawX, drawY + drawH, drawX, drawY + drawH - cLen);
        line(drawX + drawW, drawY + drawH, drawX + drawW - cLen, drawY + drawH); line(drawX + drawW, drawY + drawH, drawX + drawW, drawY + drawH - cLen);
      } else if (activeChannel === 0) {
        stroke(56, 189, 248, 80);
        strokeWeight(1);
        noFill();
        rect(drawX, drawY, drawW, drawH);
      }
    }
  }

  // 4. Actualizar metadata de las tarjetas HTML en tiempo real
  updateCardBadges();

  // 5. Interacción interactiva del mouse sobre las miniaturas
  handleMouseInteraction();
}

let currentTypewriterStyle = 'box-black';

function wrapTypewriterLines(fullText, maxLineWidth) {
  let words = fullText.split(' ');
  let lines = [];
  let currentLine = '';

  for (let i = 0; i < words.length; i++) {
    let w = words[i];
    let testLine = currentLine.length === 0 ? w : currentLine + ' ' + w;
    if (textWidth(testLine) <= maxLineWidth) {
      currentLine = testLine;
    } else {
      if (currentLine.length > 0) {
        lines.push(currentLine);
        currentLine = w;
      } else {
        lines.push(w);
        currentLine = '';
      }
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);
  if (lines.length === 0) lines = [''];
  return lines;
}

// =========================================================================
// MÁQUINA DE ESCRIBIR / MENSAJES EN PANTALLA (SIN REBORDE · RELLENO CEÑIDO)
// =========================================================================
function updateAndDrawTypewriter(state, drawX, drawY, drawW, drawH, isThumbnail = false) {
  if (!state || !state.typewriterActive || !state.typewriterText) return;

  // Animar tecleo: 1 caracter cada 3 frames (~20 chars/segundo)
  if (frameCount % 3 === 0 && state.typewriterIndex < state.typewriterText.length) {
    state.typewriterIndex++;
    state.typewriterDisplay = state.typewriterText.substring(0, state.typewriterIndex);
  }

  let isTyping = state.typewriterIndex < state.typewriterText.length;
  let cursorChar = (frameCount % 28 < 14) ? '▌' : ' ';
  let fullText = state.typewriterDisplay + (isTyping || cursorChar === '▌' ? cursorChar : '');

  push();
  rectMode(CENTER);
  let cx = drawX + drawW * 0.5;
  let cy = drawY + drawH * 0.5;

  let tSize = isThumbnail ? constrain(floor(drawW * 0.05), 8, 13) : constrain(floor(drawW * 0.030), 16, 38);
  let maxW = drawW * (isThumbnail ? 0.92 : 0.86);

  textFont('Courier New, Courier, monospace');
  textSize(tSize);
  textStyle(BOLD);

  // Relleno ajustado y angosto a la altura del texto (sin reborde)
  let padX = isThumbnail ? tSize * 0.35 : tSize * 0.45;
  let padY = isThumbnail ? tSize * 0.12 : tSize * 0.18;
  let lineHeight = tSize * 1.18;
  let maxLineWidth = max(10, maxW - padX * 2);

  let lines = wrapTypewriterLines(fullText, maxLineWidth);
  let measuredW = 0;
  for (let l of lines) {
    let lw = textWidth(l);
    if (lw > measuredW) measuredW = lw;
  }

  let boxW = measuredW + padX * 2;
  let boxH = lines.length * lineHeight + padY * 2;
  let styleMode = state.typewriterStyle || currentTypewriterStyle || 'box-black';

  // 1. Recuadro ceñido según estilo (SIN REBORDE NI LÍNEAS EXTERIORES)
  noStroke();
  if (styleMode === 'box-black') {
    fill(5, 5, 8, 225);
    rect(cx, cy, boxW, boxH, isThumbnail ? 2 : 4);
    fill(255, 255, 255);
  } else if (styleMode === 'box-white') {
    fill(250, 250, 252, 235);
    rect(cx, cy, boxW, boxH, isThumbnail ? 2 : 4);
    fill(8, 8, 12);
  } else if (styleMode === 'clean-white') {
    // Sin recuadro: texto blanco limpio con sombra suave para legibilidad
    drawingContext.shadowColor = 'rgba(0, 0, 0, 0.90)';
    drawingContext.shadowBlur = isThumbnail ? 2 : 7;
    drawingContext.shadowOffsetX = 0;
    drawingContext.shadowOffsetY = 1;
    fill(255, 255, 255);
  } else if (styleMode === 'clean-black') {
    // Sin recuadro: texto negro limpio con halo suave para legibilidad
    drawingContext.shadowColor = 'rgba(255, 255, 255, 0.85)';
    drawingContext.shadowBlur = isThumbnail ? 2 : 6;
    drawingContext.shadowOffsetX = 0;
    drawingContext.shadowOffsetY = 0;
    fill(10, 10, 14);
  }

  // 2. Dibujo del texto mecanografiado centrado
  textAlign(CENTER, CENTER);
  let startY = cy - ((lines.length - 1) * lineHeight * 0.5);
  for (let i = 0; i < lines.length; i++) {
    text(lines[i], cx, startY + i * lineHeight);
  }

  drawingContext.shadowBlur = 0;
  drawingContext.shadowColor = 'transparent';

  pop();
}

function setTypewriterStyle(newStyle) {
  currentTypewriterStyle = newStyle;
  updateTypewriterStyleUI(newStyle);

  let chans = activeChannel === 0 ? [1, 2, 3, 4] : [activeChannel];
  for (let ch of chans) {
    let s = channelStates[ch];
    if (s) {
      s.typewriterStyle = newStyle;
    }
  }

  broadcastCommand('TYPEWRITER_STYLE', newStyle);

  let labels = {
    'box-black': 'Fondo Negro',
    'box-white': 'Fondo Blanco',
    'clean-white': 'Blanco Limpio (Sin Fondo)',
    'clean-black': 'Negro Limpio (Sin Fondo)'
  };
  showMidiHUD(`Estilo: ${labels[newStyle] || newStyle}`);
}

function updateTypewriterStyleUI(activeStyle) {
  document.querySelectorAll('.tw-style-btn').forEach(btn => {
    let s = btn.getAttribute('data-style');
    if (s === activeStyle) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function sendTypewriterMessage(customText = null) {
  let input = document.getElementById('typewriter-input');
  let rawText = customText !== null ? customText : (input ? input.value : '');
  let text = (rawText || '').trim().toUpperCase();
  if (!text) return;

  let currentStyle = currentTypewriterStyle || 'box-black';

  let chans = activeChannel === 0 ? [1, 2, 3, 4] : [activeChannel];
  for (let ch of chans) {
    let s = channelStates[ch];
    if (s) {
      s.typewriterText = text;
      s.typewriterDisplay = '';
      s.typewriterIndex = 0;
      s.typewriterActive = true;
      s.typewriterStyle = currentStyle;
    }
  }

  broadcastCommand('TYPEWRITER', { text: text, active: true, style: currentStyle });

  let statusTag = document.getElementById('tw-status');
  if (statusTag) statusTag.classList.add('active');

  showMidiHUD(`Mensaje: "${text.substring(0, 22)}${text.length > 22 ? '...' : ''}"`);
}

function clearTypewriterMessage() {
  let chans = activeChannel === 0 ? [1, 2, 3, 4] : [activeChannel];
  for (let ch of chans) {
    let s = channelStates[ch];
    if (s) {
      s.typewriterActive = false;
      s.typewriterText = '';
      s.typewriterDisplay = '';
      s.typewriterIndex = 0;
    }
  }

  broadcastCommand('TYPEWRITER', { text: '', active: false });

  let anyActive = channelStates[1].typewriterActive || channelStates[2].typewriterActive || channelStates[3].typewriterActive || channelStates[4].typewriterActive;
  let statusTag = document.getElementById('tw-status');
  if (statusTag && !anyActive) statusTag.classList.remove('active');

  showMidiHUD("Mensaje en Pantalla Apagado");
}

function updateCardBadges() {
  for (let ch = 1; ch <= 4; ch++) {
    let s = channelStates[ch];
    let card = document.getElementById(`card-p${ch}`);
    let meta = document.getElementById(`meta-p${ch}`);
    let title = document.getElementById(`title-p${ch}`);

    if (card) {
      if (activeChannel === ch) card.classList.add('active');
      else card.classList.remove('active');
    }

    if (title) {
      if (s.source === 'IMAGENES' && imagesList[s.currentIndex]) {
        title.textContent = s.fusion > 0.05 ? `FUSIÓN (${Math.round(s.fusion * 100)}%)` : `FOTOS: ${imagesList[s.currentIndex].name.toUpperCase()}`;
      } else if (s.source === 'CAMARA') {
        title.textContent = s.fusion > 0.05 ? `FUSIÓN CÁMARA (${Math.round(s.fusion * 100)}%)` : `CÁMARA WEB`;
      } else if (s.source === 'VIDEO') {
        title.textContent = videoReady ? `VIDEO: ${videoName.toUpperCase()}` : `VIDEO (Cargar con +)`;
      }
    }

    if (meta) {
      let tintTxt = s.tint > 0 ? `${s.tint}°` : 'Neutro';
      let modeTxt = s.mode === 0 ? 'RGB' : s.mode === 1 ? 'Calor' : s.mode === 2 ? 'Neón' : s.mode === 3 ? 'FotoXerox' : s.mode === 4 ? 'B&N' : 'RayosX';
      meta.textContent = `${modeTxt} · ${tintTxt}`;
    }
  }
}

// =========================================================================
// SIMULACIÓN NUMÉRICA PARA UN CANAL ESPECÍFICO
// =========================================================================
function stepChannelAutomata(ch, progress) {
  let state = channelStates[ch];
  let currData, nextData;
  let morphWeight = 0;
  let injectStrength = 0.04;

  if (state.source === 'CAMARA') {
    if (cameraFeedData && cameraReady) {
      currData = cameraFeedData;
      nextData = cameraFeedData;
      morphWeight = 0;
      injectStrength = 0.12;
    } else {
      currData = imagesList[state.currentIndex]?.data;
      nextData = imagesList[state.nextIndex]?.data;
    }
  } else if (state.source === 'VIDEO') {
    if (videoFeedData && videoReady) {
      currData = videoFeedData;
      nextData = videoFeedData;
      morphWeight = 0;
      injectStrength = 0.12;
    } else {
      currData = imagesList[state.currentIndex]?.data;
      nextData = imagesList[state.nextIndex]?.data;
    }
  } else {
    currData = imagesList[state.currentIndex]?.data;
    nextData = imagesList[state.nextIndex]?.data;

    if (progress > 0.65) {
      morphWeight = map(progress, 0.65, 1.0, 0.0, 1.0, true);
      injectStrength = map(progress, 0.65, 1.0, 0.05, 0.20);
    } else if (progress < 0.20) {
      injectStrength = map(progress, 0.0, 0.20, 0.18, 0.04);
    }
  }

  let effectiveDecay = state.trail;
  if (state.source === 'IMAGENES' && progress >= 0.35 && progress <= 0.70) {
    effectiveDecay = state.trail * 1.35;
  }

  // Glitch
  let gAmt = typeof state.glitch === 'number' ? state.glitch : (isGlitchActive && (activeChannel === 0 || activeChannel === ch) ? 0.75 : 0.0);
  if (gAmt > 0.01) {
    let numBursts = floor(map(gAmt, 0, 1, 10, 80));
    for (let k = 0; k < numBursts; k++) {
      let rIdx = floor(random(SIM_COLS * SIM_ROWS));
      let pwr = random(120, 480) * gAmt;
      state.gridR[rIdx] += pwr;
      state.gridG[rIdx] += pwr;
      state.gridB[rIdx] += pwr;
    }
  }

  let gridR = state.gridR, nextR = state.nextR;
  let gridG = state.gridG, nextG = state.nextG;
  let gridB = state.gridB, nextB = state.nextB;

  for (let y = 0; y < SIM_ROWS; y++) {
    let up = ((y - 1 + SIM_ROWS) % SIM_ROWS) * SIM_COLS;
    let down = ((y + 1) % SIM_ROWS) * SIM_COLS;
    let cur = y * SIM_COLS;

    for (let x = 0; x < SIM_COLS; x++) {
      let idx = cur + x;
      let left = (x - 1 + SIM_COLS) % SIM_COLS;
      let right = (x + 1) % SIM_COLS;

      let n0 = up + left,   n1 = up + x,   n2 = up + right;
      let n3 = cur + left,                 n4 = cur + right;
      let n5 = down + left, n6 = down + x, n7 = down + right;

      let valR = (gridR[n0] + gridR[n1] + gridR[n2] + gridR[n3] + gridR[n4] + gridR[n5] + gridR[n6] + gridR[n7]) * 0.125 - effectiveDecay;
      let valG = (gridG[n0] + gridG[n1] + gridG[n2] + gridG[n3] + gridG[n4] + gridG[n5] + gridG[n6] + gridG[n7]) * 0.125 - effectiveDecay;
      let valB = (gridB[n0] + gridB[n1] + gridB[n2] + gridB[n3] + gridB[n4] + gridB[n5] + gridB[n6] + gridB[n7]) * 0.125 - effectiveDecay;

      if (currData && nextData) {
        let srcR = lerp(currData.r[idx], nextData.r[idx], morphWeight);
        let srcG = lerp(currData.g[idx], nextData.g[idx], morphWeight);
        let srcB = lerp(currData.b[idx], nextData.b[idx], morphWeight);

        if (state.fusion > 0.01 && imagesList.length > 0 && imagesList[state.currentIndex]?.data) {
          let fData = imagesList[state.currentIndex].data;
          srcR = lerp(srcR, fData.r[idx], state.fusion);
          srcG = lerp(srcG, fData.g[idx], state.fusion);
          srcB = lerp(srcB, fData.b[idx], state.fusion);
        }

        let targetR = srcR * 2.8;
        let targetG = srcG * 2.8;
        let targetB = srcB * 2.8;

        valR = valR * (1 - injectStrength) + targetR * injectStrength;
        valG = valG * (1 - injectStrength) + targetG * injectStrength;
        valB = valB * (1 - injectStrength) + targetB * injectStrength;
      }

      nextR[idx] = max(valR, 0);
      nextG[idx] = max(valG, 0);
      nextB[idx] = max(valB, 0);
    }
  }

  // Intercambiar buffers numéricos
  let tempR = state.gridR; state.gridR = state.nextR; state.nextR = tempR;
  let tempG = state.gridG; state.gridG = state.nextG; state.nextG = tempG;
  let tempB = state.gridB; state.gridB = state.nextB; state.nextB = tempB;
}

// =========================================================================
// RENDERIZADO DE SHADERS Y DESPLAZAMIENTO ORGÁNICO POR CANAL
// =========================================================================
function renderChannelOrganicDisplacement(ch, progress) {
  let state = channelStates[ch];
  let caImage = state.caImage;
  caImage.loadPixels();
  let pix = caImage.pixels;

  let currData, nextData;
  let warpFactor = 0;
  let morphBlend = 0;

  if (state.source === 'CAMARA') {
    currData = (cameraFeedData && cameraReady) ? cameraFeedData : imagesList[state.currentIndex]?.data;
    nextData = currData;
    warpFactor = 0.65;
    morphBlend = 0;
  } else if (state.source === 'VIDEO') {
    currData = (videoFeedData && videoReady) ? videoFeedData : imagesList[state.currentIndex]?.data;
    nextData = currData;
    warpFactor = 0.65;
    morphBlend = 0;
  } else {
    currData = imagesList[state.currentIndex]?.data;
    nextData = imagesList[state.nextIndex]?.data;

    if (progress < 0.30) {
      warpFactor = map(progress, 0.0, 0.30, 0.0, 0.25);
      morphBlend = 0;
    } else if (progress < 0.70) {
      warpFactor = map(progress, 0.30, 0.55, 0.25, 1.0, true);
      if (progress > 0.55) {
        warpFactor = map(progress, 0.55, 0.70, 1.0, 0.85);
      }
      morphBlend = map(progress, 0.45, 0.70, 0.0, 0.5, true);
    } else {
      warpFactor = map(progress, 0.70, 0.95, 0.85, 0.0, true);
      morphBlend = map(progress, 0.70, 1.0, 0.5, 1.0, true);
    }
  }

  let totalWarp = (warpFactor * state.warp) + pitchBendWarpOffset;
  let displacementScale = totalWarp * 0.045;
  let waveInfluence = state.warp < 0.02 ? 0.0 : constrain(map(totalWarp, 0, 1, 0.08, 0.58), 0.0, 0.90);
  let invWave = 1.0 - waveInfluence;

  let mask1023 = LUT_SIZE - 1;

  state.currentZoomDisplay = lerp(state.currentZoomDisplay, state.zoom, 0.14);
  let centerX = SIM_COLS * 0.5;
  let centerY = SIM_ROWS * 0.5;
  let invZoom = 1.0 / state.currentZoomDisplay;

  let tintRad = state.tint * 0.0174532925;
  let tr = (cos(tintRad) * 0.5 + 0.5);
  let tg = (cos(tintRad - 2.094395) * 0.5 + 0.5);
  let tb = (cos(tintRad - 4.18879) * 0.5 + 0.5);

  let gridR = state.gridR;
  let gridG = state.gridG;
  let gridB = state.gridB;

  for (let y = 0; y < SIM_ROWS; y++) {
    let cur = y * SIM_COLS;
    let up = ((y - 1 + SIM_ROWS) % SIM_ROWS) * SIM_COLS;
    let down = ((y + 1) % SIM_ROWS) * SIM_COLS;

    for (let x = 0; x < SIM_COLS; x++) {
      let idx = cur + x;
      let pIdx = idx << 2;

      let left = (x - 1 + SIM_COLS) % SIM_COLS;
      let right = (x + 1) % SIM_COLS;

      let gradX = (gridR[cur + right] - gridR[cur + left]) * 0.5 +
                  (gridG[cur + right] - gridG[cur + left]) * 0.3;
      let gradY = (gridR[down + x] - gridR[up + x]) * 0.5 +
                  (gridG[down + x] - gridG[up + x]) * 0.3;

      let sx = x;
      let sy = y;
      if (displacementScale > 0.001) {
        sx = x + (gradX * displacementScale | 0);
        sy = y + (gradY * displacementScale | 0);
      }

      // Desgarro Glitch Clásico (Horizontal slicing & RGB chromatic split)
      let glitchAberration = 0;
      let gAmt = typeof state.glitch === 'number' ? state.glitch : (isGlitchActive && (activeChannel === 0 || activeChannel === ch) ? 0.75 : 0.0);
      if (gAmt > 0.01) {
        let sliceFreq = floor(map(gAmt, 0, 1, 35, 12));
        let sliceId = (y + (frameCount * 7)) % sliceFreq;
        if (sliceId < floor(3 * gAmt + 1)) {
          sx += ((sin(y * 0.45 + frameCount * 1.5) * (18 * gAmt + 4)) | 0);
          glitchAberration = ((cos(y * 0.25) * (6 * gAmt + 1)) | 0);
        } else if (sliceId > floor(sliceFreq - 2 * gAmt - 1)) {
          sx -= ((cos(y * 0.3 + frameCount * 2) * (14 * gAmt + 2)) | 0);
        }
      }

      if (state.wave > 0.01) {
        let waveDist = sin(state.wavePhase + y * 0.08 + x * 0.04) * 12.0 * state.wave;
        let waveCross = cos(state.wavePhase * 0.7 + x * 0.07) * 8.0 * state.wave;
        sx += (waveCross | 0);
        sy += (waveDist | 0);
      }

      if (state.currentZoomDisplay > 1.01) {
        sx = centerX + (sx - centerX) * invZoom;
        sy = centerY + (sy - centerY) * invZoom;
      }

      sx = ((sx % SIM_COLS) + SIM_COLS) % SIM_COLS;
      sy = ((sy % SIM_ROWS) + SIM_ROWS) % SIM_ROWS;
      let sampleIdx = (sy | 0) * SIM_COLS + (sx | 0);

      let texR = 0, texG = 0, texB = 0;
      if (currData && nextData) {
        if (morphBlend < 0.01) {
          texR = currData.r[sampleIdx];
          texG = currData.g[sampleIdx];
          texB = currData.b[sampleIdx];
        } else if (morphBlend > 0.99) {
          texR = nextData.r[sampleIdx];
          texG = nextData.g[sampleIdx];
          texB = nextData.b[sampleIdx];
        } else {
          texR = lerp(currData.r[sampleIdx], nextData.r[sampleIdx], morphBlend);
          texG = lerp(currData.g[sampleIdx], nextData.g[sampleIdx], morphBlend);
          texB = lerp(currData.b[sampleIdx], nextData.b[sampleIdx], morphBlend);
        }

        if (glitchAberration !== 0) {
          let sxR = ((sx + glitchAberration) % SIM_COLS + SIM_COLS) % SIM_COLS;
          let sxB = ((sx - glitchAberration) % SIM_COLS + SIM_COLS) % SIM_COLS;
          let sIdxR = (sy | 0) * SIM_COLS + (sxR | 0);
          let sIdxB = (sy | 0) * SIM_COLS + (sxB | 0);
          texR = currData.r[sIdxR];
          texB = currData.b[sIdxB];
        }
      }

      let foldR = LUT_SMOOTH_FOLD[(gridR[idx] * 0.7) & mask1023];
      let foldG = LUT_SMOOTH_FOLD[(gridG[idx] * 0.7) & mask1023];
      let foldB = LUT_SMOOTH_FOLD[(gridB[idx] * 0.7) & mask1023];

      let finalR = (foldR * waveInfluence + texR * invWave) | 0;
      let finalG = (foldG * waveInfluence + texG * invWave) | 0;
      let finalB = (foldB * waveInfluence + texB * invWave) | 0;

      // Estela de Obturación / Motion Echo
      if (state.shutter > 0.01) {
        let decayFactor = state.shutter;
        let hR = state.historyR[idx] * decayFactor;
        let hG = state.historyG[idx] * decayFactor;
        let hB = state.historyB[idx] * decayFactor;
        finalR = Math.max(finalR, hR);
        finalG = Math.max(finalG, hG);
        finalB = Math.max(finalB, hB);
      }
      state.historyR[idx] = finalR;
      state.historyG[idx] = finalG;
      state.historyB[idx] = finalB;

      // Paletas de Color y Shaders
      let dirtAmt = typeof state.vintageDirt === 'number' ? state.vintageDirt : (state.vintage ? 0.6 : 0.0);
      let toneAmt = typeof state.vintageTone === 'number' ? state.vintageTone : (state.vintage ? 0.75 : 0.0);

      let tR = finalR, tG = finalG, tB = finalB;

      if (state.red) {
        let lum = finalR * 0.299 + finalG * 0.587 + finalB * 0.114;
        tR = min(255, (lum * 1.85 + 70) | 0);
        tG = (lum * 0.18) | 0;
        tB = (lum * 0.14) | 0;
      } else if (toneAmt > 0.001) {
        let lum = finalR * 0.299 + finalG * 0.587 + finalB * 0.114;
        if (toneAmt <= 0.20) {
          let b = toneAmt / 0.20;
          tR = finalR * (1 - b) + lum * b;
          tG = finalG * (1 - b) + lum * b;
          tB = finalB * (1 - b) + lum * b;
        } else if (toneAmt <= 0.40) { // B&N Neutro -> B&N Celuloide con contraste ortocromático
          let f = (toneAmt - 0.20) / 0.20;
          let contrastLum = lum < 128 ? (lum * lum * 0.0078125) : 255 - ((255 - lum) * (255 - lum) * 0.0078125);
          let lVal = lum * (1 - f) + contrastLum * f;
          tR = lVal; tG = lVal; tB = lVal;
        } else if (toneAmt <= 0.60) { // B&N Celuloide -> Tono Platino Cálido
          let f = (toneAmt - 0.40) / 0.20;
          let contrastLum = lum < 128 ? (lum * lum * 0.0078125) : 255 - ((255 - lum) * (255 - lum) * 0.0078125);
          let rPlat = contrastLum * 1.04 + 6;
          let gPlat = contrastLum * 1.01 + 3;
          let bPlat = contrastLum * 0.94;
          tR = contrastLum * (1 - f) + rPlat * f;
          tG = contrastLum * (1 - f) + gPlat * f;
          tB = contrastLum * (1 - f) + bPlat * f;
        } else if (toneAmt <= 0.80) { // Tono Platino -> Sepia Clásico 1920
          let f = (toneAmt - 0.60) / 0.20;
          let rPlat = lum * 1.04 + 6, gPlat = lum * 1.01 + 3, bPlat = lum * 0.94;
          let rSep = lum * 1.12 + 22, gSep = lum * 0.94 + 10, bSep = lum * 0.65;
          tR = rPlat * (1 - f) + rSep * f;
          tG = gPlat * (1 - f) + gSep * f;
          tB = bPlat * (1 - f) + bSep * f;
        } else { // Sepia Clásico -> Sepia Ámbar Profundo
          let f = (toneAmt - 0.80) / 0.20;
          let rSep = lum * 1.12 + 22, gSep = lum * 0.94 + 10, bSep = lum * 0.65;
          let rAmb = lum * 1.20 + 36, gAmb = lum * 0.90 + 12, bAmb = lum * 0.42;
          tR = rSep * (1 - f) + rAmb * f;
          tG = gSep * (1 - f) + gAmb * f;
          tB = bSep * (1 - f) + bAmb * f;
        }
      } else if (state.mode === 0) { // RGB Original
        tR = finalR;
        tG = finalG;
        tB = finalB;
      } else if (state.mode === 1) { // Mapa de Calor Térmico (FLIR)
        let lum = (finalR * 0.299 + finalG * 0.587 + finalB * 0.114) | 0;
        let lByte = lum < 0 ? 0 : (lum > 255 ? 255 : lum);
        tR = HEATMAP_LUT_R[lByte];
        tG = HEATMAP_LUT_G[lByte];
        tB = HEATMAP_LUT_B[lByte];
      } else if (state.mode === 2) { // Neón Ciber
        let lum = finalR * 0.299 + finalG * 0.587 + finalB * 0.114;
        let t = lum * 0.0039215686;
        tR = sin(t * PI) * 255;
        tG = cos(t * HALF_PI) * 220 + 30;
        tB = sin(t * TWO_PI + HALF_PI) * 200 + 55;
      } else if (state.mode === 3) { // B&N Fotocopia Xerox
        let lum = finalR * 0.299 + finalG * 0.587 + finalB * 0.114;
        let toner = lum + (((x * 29 + y * 53 + (frameCount & 3) * 11) & 31) - 15.5) * 1.85;
        let photoVal = toner > 142 ? 255 : (toner < 96 ? 0 : (toner - 96) * 5.54);
        tR = photoVal;
        tG = photoVal;
        tB = photoVal;
      } else if (state.mode === 4) { // B&N Orgánico
        let lum = finalR * 0.299 + finalG * 0.587 + finalB * 0.114;
        tR = lum;
        tG = lum;
        tB = lum;
      } else { // Rayos X / Negativo
        tR = 255 - finalR;
        tG = 255 - finalG;
        tB = 255 - finalB;
      }

      // Tinte Cromático
      if (state.tint > 0 && !state.red && toneAmt < 0.01) {
        let lum = tR * 0.299 + tG * 0.587 + tB * 0.114;
        tR = min(255, (tR * 0.25 + lum * tr * 1.65) | 0);
        tG = min(255, (tG * 0.25 + lum * tg * 1.65) | 0);
        tB = min(255, (tB * 0.25 + lum * tb * 1.65) | 0);
      }

      // Pelos, Polvo y Suciedad Procedural (1920s Film Wear)
      if (dirtAmt > 0.001) {
        // 1. Grano fino de película
        let grain = (((x * 67 + y * 97 + (frameCount & 15) * 23) & 31) - 15.5) * (1.6 * dirtAmt);
        tR += grain; tG += grain; tB += grain;

        // 2. Parpadeo suave de obturador mecánico (16 FPS feeling)
        let flicker = (((frameCount & 3) === 0) ? -10 : (sin(frameCount * 1.8) * 6)) * dirtAmt;
        tR += flicker; tG += flicker; tB += flicker;

        // 3. Rayón vertical claro (luz/polvo que corre por el celuloide)
        let s1 = (frameCount * 31 + 17) % SIM_COLS;
        if (x === s1 && ((y + frameCount * 3) % 23 > 4)) {
          let boost = 95 * dirtAmt;
          tR += boost; tG += boost; tB += boost * 0.8;
        }

        // 4. Pelo errático curvado que cruza la ventana del proyector
        let hairWobble = (sin(y * 0.08 + frameCount * 0.3) * 4) | 0;
        let hairX = ((frameCount * 17 + 53 + hairWobble) % SIM_COLS + SIM_COLS) % SIM_COLS;
        if ((x === hairX || x === hairX + 1) && ((y * 2 + frameCount * 2) % 31 > 6)) {
          let hairDark = 1.0 - (0.75 * dirtAmt);
          tR *= hairDark; tG *= hairDark; tB *= hairDark;
        }

        // 5. Rayón vertical oscuro fino
        if (dirtAmt > 0.35) {
          let s2 = (frameCount * 13 + 107) % SIM_COLS;
          if (x === s2 && ((y + frameCount * 5) % 19 > 5)) {
            let sDark = 1.0 - (0.55 * dirtAmt);
            tR *= sDark; tG *= sDark; tB *= sDark;
          }
        }

        // 6. Viñeteado óptico
        let dxN = (x - centerX) / centerX;
        let dyN = (y - centerY) / centerY;
        let vig = constrain(1.0 - (dxN * dxN + dyN * dyN) * (0.55 * dirtAmt), 0.25, 1.0);
        tR *= vig; tG *= vig; tB *= vig;
      }

      pix[pIdx + 0] = constrain(tR | 0, 0, 255);
      pix[pIdx + 1] = constrain(tG | 0, 0, 255);
      pix[pIdx + 2] = constrain(tB | 0, 0, 255);
      pix[pIdx + 3] = 255;
    }
  }

  caImage.updatePixels();
}

// =========================================================================
// MUESTREO DE IMÁGENES Y ENERGÍA
// =========================================================================
function seedChannel(ch, curr, next) {
  let state = channelStates[ch];
  state.currentIndex = curr;
  state.nextIndex = next;
  state.cycleTimer = 0;

  if (imagesList[curr]?.data) {
    let d = imagesList[curr].data;
    for (let i = 0; i < SIM_COLS * SIM_ROWS; i++) {
      state.gridR[i] = d.r[i] * 2.6;
      state.gridG[i] = d.g[i] * 2.6;
      state.gridB[i] = d.b[i] * 2.6;
    }
  }
}

function resampleP5Image(img) {
  let gfx = createGraphics(SIM_COLS, SIM_ROWS);
  gfx.pixelDensity(1);
  gfx.background(0);

  let imgAspect = img.width / img.height;
  let canvasAspect = SIM_COLS / SIM_ROWS;
  let drawW, drawH, drawX, drawY;

  let margin = 0.95;
  if (imgAspect > canvasAspect) {
    drawW = SIM_COLS * margin;
    drawH = (SIM_COLS / imgAspect) * margin;
  } else {
    drawH = SIM_ROWS * margin;
    drawW = (SIM_ROWS * imgAspect) * margin;
  }
  drawX = (SIM_COLS - drawW) / 2;
  drawY = (SIM_ROWS - drawH) / 2;

  gfx.image(img, drawX, drawY, drawW, drawH);
  gfx.loadPixels();

  let count = SIM_COLS * SIM_ROWS;
  let rArr = new Float32Array(count);
  let gArr = new Float32Array(count);
  let bArr = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    let p = i << 2;
    let alpha = gfx.pixels[p + 3] / 255.0;
    rArr[i] = gfx.pixels[p + 0] * alpha;
    gArr[i] = gfx.pixels[p + 1] * alpha;
    bArr[i] = gfx.pixels[p + 2] * alpha;
  }

  gfx.remove();
  return { r: rArr, g: gArr, b: bArr };
}

function addLoadedImage(img, name = "Imagen") {
  let processed = {
    name: name,
    sourceImg: img,
    data: resampleP5Image(img)
  };
  imagesList.push(processed);
  updateBadge();
}

function generateProceduralDefaults() {
  let g1 = createGraphics(SIM_COLS, SIM_ROWS);
  g1.pixelDensity(1);
  g1.background(10, 15, 25);
  g1.translate(SIM_COLS / 2, SIM_ROWS / 2);
  for (let i = 0; i < 16; i++) {
    g1.rotate(TWO_PI / 16);
    g1.stroke(255, 100, 180, 220);
    g1.noFill();
    g1.ellipse(0, 30, 40, 70);
  }
  addLoadedImage(g1, "Demo");
  g1.remove();
}

function updateMediaFeedData(sourceMedia, gfx, dataObj) {
  if (!gfx || !dataObj) return;
  gfx.image(sourceMedia, 0, 0, SIM_COLS, SIM_ROWS);
  gfx.loadPixels();
  let pix = gfx.pixels;
  let count = SIM_COLS * SIM_ROWS;
  let r = dataObj.r;
  let g = dataObj.g;
  let b = dataObj.b;
  for (let i = 0; i < count; i++) {
    let p = i << 2;
    r[i] = pix[p];
    g[i] = pix[p + 1];
    b[i] = pix[p + 2];
  }
}

function toggleSoloViewMode(forceCh = null) {
  if (forceCh !== null) {
    if (isSoloViewMode && activeChannel === forceCh) {
      isSoloViewMode = false;
    } else {
      selectChannel(forceCh);
      isSoloViewMode = true;
    }
  } else {
    isSoloViewMode = !isSoloViewMode;
  }

  let btn = document.getElementById('btn-solo-view');
  let overlayGrid = document.querySelector('.monitors-overlay-grid');
  if (btn) {
    btn.textContent = isSoloViewMode ? 'Multiview (V)' : 'Expandir (V)';
    btn.classList.toggle('active', isSoloViewMode);
  }
  if (overlayGrid) {
    overlayGrid.classList.toggle('solo-mode', isSoloViewMode);
  }

  let ch = (activeChannel >= 1 && activeChannel <= 4) ? activeChannel : 1;
  showMidiHUD(isSoloViewMode ? `Modo Expandido: P${ch}` : `Modo Multiview (4X)`);
}

// =========================================================================
// INTERACCIÓN Y PINTURA SOBRE LAS MINIATURAS DEL MULTIVIEW
// =========================================================================
let wasMousePressedPrev = false;
function handleMouseInteraction() {
  let container = document.getElementById('monitors-canvas-container');
  if (!container) return;

  if (mouseIsPressed && mouseX >= 0 && mouseX < width && mouseY >= 0 && mouseY < height) {
    let targetCh;
    let localX, localY;

    if (isSoloViewMode) {
      targetCh = (activeChannel >= 1 && activeChannel <= 4) ? activeChannel : 1;
      let state = channelStates[targetCh];
      let aFit = typeof state.aspect === 'number' ? state.aspect : 0.0;
      let imgAspect = 16.0 / 9.0;
      let boxAspect = width / height;
      let fitW, fitH;
      if (boxAspect > imgAspect) {
        fitH = height;
        fitW = height * imgAspect;
      } else {
        fitW = width;
        fitH = width / imgAspect;
      }
      let drawW = lerp(fitW, width, aFit);
      let drawH = lerp(fitH, height, aFit);
      let drawX = (width - drawW) * 0.5;
      let drawY = (height - drawH) * 0.5;

      localX = ((mouseX - drawX) / drawW) * SIM_COLS;
      localY = ((mouseY - drawY) / drawH) * SIM_ROWS;
    } else {
      let quadW = width / 4;
      let quadH = height;
      targetCh = floor(mouseX / quadW) + 1;
      targetCh = constrain(targetCh, 1, 4);

      // Si recién hace clic, seleccionar ese canal
      if (!wasMousePressedPrev && activeChannel !== targetCh && activeChannel !== 0) {
        selectChannel(targetCh);
      }

      let state = channelStates[targetCh];
      let aFit = typeof state.aspect === 'number' ? state.aspect : 0.0;
      let qX = (targetCh - 1) * quadW;
      let imgAspect = 16.0 / 9.0;
      let boxAspect = quadW / quadH;
      let fitW, fitH;
      if (boxAspect > imgAspect) {
        fitH = quadH;
        fitW = quadH * imgAspect;
      } else {
        fitW = quadW;
        fitH = quadW / imgAspect;
      }
      let drawW = lerp(fitW, quadW, aFit);
      let drawH = lerp(fitH, quadH, aFit);
      let drawX = qX + (quadW - drawW) * 0.5;
      let drawY = (quadH - drawH) * 0.5;

      localX = ((mouseX - drawX) / drawW) * SIM_COLS;
      localY = ((mouseY - drawY) / drawH) * SIM_ROWS;
    }

    // Inyectar energía en el canal tocado si el cursor está dentro del encuadre
    if (localX >= 0 && localX < SIM_COLS && localY >= 0 && localY < SIM_ROWS) {
      injectEnergyAt(targetCh, floor(localX), floor(localY), channelStates[targetCh].brush);
    }

    // Audio modulation
    handleAudioModulation();
  } else if (wasMousePressedPrev && !isRemoteAudioModulating) {
    handleAudioRelease();
  }

  wasMousePressedPrev = mouseIsPressed;
}

function injectEnergyAt(ch, gridX, gridY, radius) {
  let state = channelStates[ch];
  let r = floor(radius / 4); // escala proporcional
  let gridR = state.gridR, gridG = state.gridG, gridB = state.gridB;

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      let x = (gridX + dx + SIM_COLS) % SIM_COLS;
      let y = (gridY + dy + SIM_ROWS) % SIM_ROWS;
      let d = sqrt(dx * dx + dy * dy);

      if (d <= r) {
        let energy = (1 - d / r) * 260;
        let idx = y * SIM_COLS + x;
        gridR[idx] += energy;
        gridG[idx] += energy * 0.85;
        gridB[idx] += energy * 1.25;
      }
    }
  }

  // Si este canal es el activo, transmitir interacción a la salida limpia
  if (activeChannel === 0 || activeChannel === ch) {
    broadcastCommand('SHOCKWAVE', { x: gridX * 2, y: gridY * 2, velocity: 100 });
  }
}

function injectShockwave(gridX, gridY, velocity = 100) {
  let targetCh = activeChannel === 0 ? 1 : activeChannel;
  let r = floor(map(velocity, 0, 127, 4, 30));
  let power = map(velocity, 0, 127, 90, 520);

  let chans = activeChannel === 0 ? [1, 2, 3, 4] : [activeChannel];
  for (let ch of chans) {
    let state = channelStates[ch];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        let x = (gridX + dx + SIM_COLS) % SIM_COLS;
        let y = (gridY + dy + SIM_ROWS) % SIM_ROWS;
        let d = sqrt(dx * dx + dy * dy);
        if (d <= r) {
          let energy = (1 - d / r) * power;
          let idx = y * SIM_COLS + x;
          state.gridR[idx] += energy;
          state.gridG[idx] += energy * 0.9;
          state.gridB[idx] += energy * 1.35;
        }
      }
    }
  }

  broadcastCommand('SHOCKWAVE', { x: gridX * 2, y: gridY * 2, velocity: velocity });
}

function triggerIntenseWave(velocity = 127) {
  let centerX = floor(SIM_COLS * 0.5);
  let centerY = floor(SIM_ROWS * 0.5);
  let maxR = floor(max(SIM_COLS, SIM_ROWS) * 0.75);
  let power = map(velocity, 0, 127, 450, 1400);

  let chans = activeChannel === 0 ? [1, 2, 3, 4] : [activeChannel];
  for (let ch of chans) {
    let state = channelStates[ch];
    for (let y = 0; y < SIM_ROWS; y++) {
      let dy = y - centerY;
      let cur = y * SIM_COLS;
      for (let x = 0; x < SIM_COLS; x++) {
        let dx = x - centerX;
        let d = sqrt(dx * dx + dy * dy);
        if (d < maxR) {
          let wave = sin(d * 0.28) * (1.0 - d / maxR) * power;
          let idx = cur + x;
          state.gridR[idx] += wave;
          state.gridG[idx] += wave * 0.85;
          state.gridB[idx] += wave * 1.45;
        }
      }
    }
  }

  pitchBendWarpOffset = 2.4;
  setTimeout(() => { pitchBendWarpOffset = 0.0; }, 450);
  showMidiHUD(`WAVE INTENSO (${velocity})`);
}

// =========================================================================
// EVENTOS Y CONTROLES UI DECK
// =========================================================================
function setupUIEvents() {
  // Selector de canal por botones del deck
  document.querySelectorAll('.channel-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      let chan = parseInt(btn.getAttribute('data-channel'));
      selectChannel(chan);
    });
  });

  // Selector de canal al hacer clic en las tarjetas de monitores
  document.querySelectorAll('.monitor-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-screen-launch')) return;
      let ch = parseInt(card.getAttribute('data-channel'));
      selectChannel(ch);
    });

    // Doble clic para expandir / alternar Modo Solo
    card.addEventListener('dblclick', (e) => {
      if (e.target.classList.contains('btn-screen-launch')) return;
      let ch = parseInt(card.getAttribute('data-channel'));
      toggleSoloViewMode(ch);
    });
  });

  // Botón para alternar Modo Solo / Multiview
  let btnSoloView = document.getElementById('btn-solo-view');
  if (btnSoloView) {
    btnSoloView.addEventListener('click', () => toggleSoloViewMode());
  }

  // Botones para abrir cada salida limpia individualmente
  document.querySelectorAll('.btn-screen-launch').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      let s = parseInt(btn.getAttribute('data-screen')) || 1;
      window.open(`output.html?screen=${s}`, `screen_${s}`, 'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no');
    });
  });

  // Botón para abrir las 4 salidas a la vez
  let btnOpenAllScreens = document.getElementById('btn-open-all-screens');
  if (btnOpenAllScreens) {
    btnOpenAllScreens.addEventListener('click', () => {
      for (let s = 1; s <= 4; s++) {
        window.open(`output.html?screen=${s}`, `screen_${s}`, 'width=960,height=540,menubar=no,toolbar=no,location=no,status=no');
      }
    });
  }

  // Máquina de escribir / Mensajes en vivo
  let btnTwSend = document.getElementById('btn-typewriter-send');
  let btnTwClear = document.getElementById('btn-typewriter-clear');
  let twInput = document.getElementById('typewriter-input');

  if (btnTwSend) btnTwSend.addEventListener('click', () => sendTypewriterMessage());
  if (btnTwClear) btnTwClear.addEventListener('click', () => clearTypewriterMessage());
  if (twInput) {
    twInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        sendTypewriterMessage();
      }
    });
  }

  document.querySelectorAll('.tw-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      let msg = chip.getAttribute('data-msg');
      if (twInput) twInput.value = msg;
      sendTypewriterMessage(msg);
    });
  });

  document.querySelectorAll('.tw-style-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      let st = btn.getAttribute('data-style');
      if (st) setTypewriterStyle(st);
    });
  });

  // Fuentes VJ
  let btnSrcImg = document.getElementById('src-images');
  let btnSrcCam = document.getElementById('src-camera');
  let btnSrcVid = document.getElementById('src-video');
  if (btnSrcImg) btnSrcImg.addEventListener('click', () => setSourceMode('IMAGENES'));
  if (btnSrcCam) btnSrcCam.addEventListener('click', () => setSourceMode('CAMARA'));
  if (btnSrcVid) btnSrcVid.addEventListener('click', () => setSourceMode('VIDEO'));

  // Carga de videos
  let btnVideoUpload = document.getElementById('btn-video-upload');
  let videoFileInput = document.getElementById('video-file-input');
  if (btnVideoUpload && videoFileInput) {
    btnVideoUpload.addEventListener('click', () => videoFileInput.click());
    videoFileInput.addEventListener('change', (e) => {
      let files = e.target.files;
      if (files && files.length > 0) loadCustomVideoFile(files[0]);
      videoFileInput.value = '';
    });
  }

  // Carga de fotos
  let btnUpload = document.getElementById('btn-upload');
  let fileInput = document.getElementById('file-input');
  if (btnUpload && fileInput) {
    btnUpload.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
      let files = e.target.files;
      if (files && files.length > 0) loadFilesIntoGallery(files);
      fileInput.value = '';
    });
  }

  // Restablecer a fotos botánicas originales
  let btnResetGallery = document.getElementById('btn-reset-gallery');
  if (btnResetGallery) {
    btnResetGallery.addEventListener('click', () => {
      resetToBotanicalGallery();
    });
  }

  // Botón siguiente foto
  let btnNext = document.getElementById('btn-next');
  if (btnNext) btnNext.addEventListener('click', triggerNextTransition);

  // FX en Vivo
  let btnVintage = document.getElementById('btn-vintage-film');
  if (btnVintage) btnVintage.addEventListener('click', toggleVintageFilm);

  let btnGlitch = document.getElementById('btn-glitch');
  if (btnGlitch) btnGlitch.addEventListener('click', toggleGlitch);

  let btnPause = document.getElementById('btn-pause');
  if (btnPause) btnPause.addEventListener('click', togglePause);

  let glitchSlider = document.getElementById('glitch-slider');
  let glitchVal = document.getElementById('glitch-val');
  if (glitchSlider) {
    glitchSlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value) / 100.0;
      if (glitchVal) glitchVal.textContent = e.target.value + '%';
      updateChannelParam('glitch', val);
      isGlitchActive = val > 0.01;
      broadcastCommand('GLITCH', val);
      syncUIControls();
    });
  }

  let filmDirtSlider = document.getElementById('film-dirt-slider');
  let filmDirtVal = document.getElementById('film-dirt-val');
  if (filmDirtSlider) {
    filmDirtSlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value) / 100.0;
      if (filmDirtVal) filmDirtVal.textContent = e.target.value + '%';
      updateChannelParam('vintageDirt', val);
      let ref = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
      updateChannelParam('vintage', val > 0.01 || (ref && ref.vintageTone > 0.01));
      broadcastCommand('VINTAGE_DIRT', val);
      syncUIControls();
    });
  }

  let filmToneSlider = document.getElementById('film-tone-slider');
  let filmToneVal = document.getElementById('film-tone-val');
  if (filmToneSlider) {
    filmToneSlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value) / 100.0;
      if (filmToneVal) filmToneVal.textContent = getFilmToneName(parseInt(e.target.value));
      updateChannelParam('vintageTone', val);
      let ref = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
      updateChannelParam('vintage', val > 0.01 || (ref && ref.vintageDirt > 0.01));
      broadcastCommand('VINTAGE_TONE', val);
      syncUIControls();
    });
  }

  // Sliders visuales
  let waveSlider = document.getElementById('wave-slider');
  let waveVal = document.getElementById('wave-val');
  if (waveSlider) {
    waveSlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value) / 100.0;
      if (waveVal) waveVal.textContent = e.target.value + '%';
      updateChannelParam('wave', val);
      broadcastCommand('WAVE_DEFORM', val);
      syncUIControls();
    });
  }

  let zoomSlider = document.getElementById('zoom-slider');
  let zoomVal = document.getElementById('zoom-val');
  if (zoomSlider) {
    zoomSlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value);
      if (zoomVal) zoomVal.textContent = val.toFixed(1) + 'x';
      updateChannelParam('zoom', val);
      broadcastCommand('ZOOM', val);
      syncUIControls();
    });
  }

  let fusionSlider = document.getElementById('fusion-slider');
  let fusionVal = document.getElementById('fusion-val');
  if (fusionSlider) {
    fusionSlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value) / 100.0;
      if (fusionVal) fusionVal.textContent = e.target.value + '%';
      updateChannelParam('fusion', val);
      broadcastCommand('FUSION', val);
      syncUIControls();
    });
  }

  let shutterSlider = document.getElementById('shutter-slider');
  let shutterVal = document.getElementById('shutter-val');
  if (shutterSlider) {
    shutterSlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value) / 100.0;
      if (shutterVal) shutterVal.textContent = e.target.value + '%';
      updateChannelParam('shutter', val);
      broadcastCommand('SHUTTER', val);
      syncUIControls();
    });
  }

  let decaySlider = document.getElementById('decay-slider');
  let decayVal = document.getElementById('decay-val');
  if (decaySlider) {
    decaySlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value);
      if (decayVal) decayVal.textContent = val.toFixed(2);
      updateChannelParam('trail', val);
      broadcastCommand('TRAIL', val);
      syncUIControls();
    });
  }

  let tintSlider = document.getElementById('tint-slider');
  let tintVal = document.getElementById('tint-val');
  if (tintSlider) {
    tintSlider.addEventListener('input', (e) => {
      let val = parseInt(e.target.value);
      setTintAngle(val, false);
      if (tintVal) tintVal.textContent = getTintName(val);
    });
    tintSlider.addEventListener('change', (e) => {
      showMidiHUD(`Tinte: ${getTintName(parseInt(e.target.value))}`);
    });
  }

  let warpSlider = document.getElementById('warp-slider');
  let warpVal = document.getElementById('warp-val');
  if (warpSlider) {
    warpSlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value) / 100.0;
      if (warpVal) warpVal.textContent = e.target.value + '%';
      updateChannelParam('warp', val);
      broadcastCommand('WARP', val);
      syncUIControls();
    });
  }

  let aspectSlider = document.getElementById('aspect-slider');
  let aspectVal = document.getElementById('aspect-val');
  if (aspectSlider) {
    aspectSlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value) / 100.0;
      let label = e.target.value === '0' ? 'Original' : (e.target.value === '100' ? 'Llenar' : e.target.value + '%');
      if (aspectVal) aspectVal.textContent = label;
      updateChannelParam('aspect', val);
      broadcastCommand('ASPECT', val);
      syncUIControls();
    });
  }

  let brushSlider = document.getElementById('brush-slider');
  let brushVal = document.getElementById('brush-val');
  if (brushSlider) {
    brushSlider.addEventListener('input', (e) => {
      let val = parseInt(e.target.value);
      if (brushVal) brushVal.textContent = val + 'px';
      updateChannelParam('brush', val);
      broadcastCommand('BRUSH', val);
      syncUIControls();
    });
  }

  // Paleta de Color Interactiva (Chips)
  document.querySelectorAll('.palette-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      let mode = parseInt(chip.getAttribute('data-mode'));
      if (!isNaN(mode)) setColorMode(mode);
    });
  });

  // Audio FX
  let btnSound = document.getElementById('btn-sound');
  if (btnSound) btnSound.addEventListener('click', toggleSound);

  let btnAudioNext = document.getElementById('btn-audio-next');
  if (btnAudioNext) btnAudioNext.addEventListener('click', switchNextAudioTrack);

  let btnAudioUpload = document.getElementById('btn-audio-upload');
  let audioFileInput = document.getElementById('audio-file-input');
  if (btnAudioUpload && audioFileInput) {
    btnAudioUpload.addEventListener('click', () => audioFileInput.click());
    audioFileInput.addEventListener('change', (e) => {
      let files = e.target.files;
      if (files && files.length > 0) loadCustomAudioFile(files[0]);
      audioFileInput.value = '';
    });
  }

  // Faders de Audio: Pitch y Rate
  let pitchSlider = document.getElementById('pitch-slider');
  let pitchVal = document.getElementById('pitch-val');
  if (pitchSlider) {
    pitchSlider.addEventListener('input', (e) => {
      let val = parseInt(e.target.value);
      audioPitchSemitones = val;
      if (pitchVal) pitchVal.textContent = (val > 0 ? `+${val}` : `${val}`) + ' st';
      updateAudioRateAndPitch();
    });
    pitchSlider.addEventListener('change', (e) => {
      let val = parseInt(e.target.value);
      showMidiHUD(`Pitch: ${val > 0 ? '+' : ''}${val} st`);
    });
  }

  let rateSlider = document.getElementById('rate-slider');
  let rateVal = document.getElementById('rate-val');
  if (rateSlider) {
    rateSlider.addEventListener('input', (e) => {
      let val = parseFloat(e.target.value);
      audioPlaybackRate = val;
      if (rateVal) rateVal.textContent = val.toFixed(2) + 'x';
      updateAudioRateAndPitch();
    });
    rateSlider.addEventListener('change', (e) => {
      let val = parseFloat(e.target.value);
      showMidiHUD(`Rate: ${val.toFixed(2)}x`);
    });
  }

  // Nitidez / Resolución
  let btnRes = document.getElementById('btn-res');
  if (btnRes) btnRes.addEventListener('click', cycleResolution);

  // Pantalla Completa
  let btnFullscreen = document.getElementById('btn-fullscreen');
  let btnFullscreenTop = document.getElementById('btn-fullscreen-top');
  if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);
  if (btnFullscreenTop) btnFullscreenTop.addEventListener('click', toggleFullscreen);

  // Toggle Ocultar / Minimizar Deck Inferior (Tecla H)
  let btnToggleUi = document.getElementById('btn-toggle-ui');
  let btnCloseUi = document.getElementById('btn-close-ui');
  if (btnToggleUi) btnToggleUi.addEventListener('click', toggleControlDeck);
  if (btnCloseUi) btnCloseUi.addEventListener('click', toggleControlDeck);

  syncUIControls();
}

function toggleControlDeck() {
  let deck = document.getElementById('control-deck');
  if (deck) {
    deck.classList.toggle('collapsed');
    setTimeout(windowResized, 360);
  }
}

// =========================================================================
// GESTIÓN Y SELECCIÓN DE CANALES
// =========================================================================
function selectChannel(targetChannel) {
  activeChannel = parseInt(targetChannel);
  if (isNaN(activeChannel)) activeChannel = 0;

  // Actualizar botones de canal
  document.querySelectorAll('.channel-btn').forEach(btn => {
    let c = parseInt(btn.getAttribute('data-channel'));
    if (c === activeChannel) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  // Actualizar barra de estado con color
  let statusBar = document.getElementById('channel-status-bar');
  if (statusBar) {
    statusBar.className = 'channel-status-bar';
    if (activeChannel === 0) {
      statusBar.textContent = "Destino: Todas las Pantallas (Global)";
      statusBar.classList.add('global');
    } else {
      let desc = activeChannel === 1 ? 'Fotos' : activeChannel === 2 ? 'Cámara' : activeChannel === 3 ? 'Video' : 'Fusión';
      statusBar.textContent = `Destino: Pantalla ${activeChannel} (${desc})`;
      statusBar.classList.add(`p${activeChannel}`);
    }
  }

  // Si seleccionamos una pantalla específica (1 a 4), activar periféricos si se requiere
  if (activeChannel >= 1 && activeChannel <= 4 && channelStates[activeChannel]) {
    let s = channelStates[activeChannel];
    if (s.source === 'CAMARA' && !videoCapture) initWebcam();
    if (s.source === 'VIDEO' && videoPlayer && videoReady) videoPlayer.play();
  }

  syncUIControls();
  if (vjChannel) {
    vjChannel.postMessage({
      targetChannel: 0,
      action: 'ACTIVE_CHANNEL',
      value: activeChannel,
      timestamp: Date.now()
    });
  }
  if (activeChannel >= 1 && activeChannel <= 4) {
    syncCurrentStateToChannel(activeChannel);
    syncCurrentStateToChannel(0);
  }
  showMidiHUD(activeChannel === 0 ? "Todas las Pantallas" : `Canal: Pantalla ${activeChannel}`);
}

function syncUIControls() {
  let refState = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
  if (!refState) return;

  // 1. Selector de Fuentes
  document.getElementById('src-images')?.classList.toggle('active', refState.source === 'IMAGENES');
  document.getElementById('src-camera')?.classList.toggle('active', refState.source === 'CAMARA');
  document.getElementById('src-video')?.classList.toggle('active', refState.source === 'VIDEO');

  let btnUploadImg = document.getElementById('btn-upload');
  let btnUploadVid = document.getElementById('btn-video-upload');
  if (btnUploadImg) btnUploadImg.style.display = refState.source === 'IMAGENES' ? 'flex' : 'none';
  if (btnUploadVid) btnUploadVid.style.display = refState.source === 'VIDEO' ? 'flex' : 'none';

  // 2. Paletas de Color
  document.querySelectorAll('.palette-chip').forEach(chip => {
    let mode = parseInt(chip.getAttribute('data-mode'));
    chip.classList.toggle('active', mode === refState.mode);
  });

  // 3. Tinte Cromático
  let tintSlider = document.getElementById('tint-slider');
  let tintVal = document.getElementById('tint-val');
  if (tintSlider && document.activeElement !== tintSlider) tintSlider.value = refState.tint;
  if (tintVal) tintVal.textContent = getTintName(refState.tint);

  // 4. Efectos en Vivo
  let dirtPct = Math.round((typeof refState.vintageDirt === 'number' ? refState.vintageDirt : (refState.vintage ? 0.6 : 0)) * 100);
  let tonePct = Math.round((typeof refState.vintageTone === 'number' ? refState.vintageTone : (refState.vintage ? 0.75 : 0)) * 100);

  document.getElementById('btn-vintage-film')?.classList.toggle('active-amber', dirtPct > 0 || tonePct > 0);
  document.getElementById('btn-pause')?.classList.toggle('active-blue', refState.paused);
  let pauseLabel = document.getElementById('pause-label');
  if (pauseLabel) pauseLabel.textContent = refState.paused ? 'Reanudar' : 'Pausa';

  let glitchSlider = document.getElementById('glitch-slider');
  let glitchVal = document.getElementById('glitch-val');
  let glitchPct = Math.round((typeof refState.glitch === 'number' ? refState.glitch : 0) * 100);
  if (glitchSlider && document.activeElement !== glitchSlider) glitchSlider.value = glitchPct;
  if (glitchVal) glitchVal.textContent = glitchPct + '%';

  let filmDirtSlider = document.getElementById('film-dirt-slider');
  let filmDirtVal = document.getElementById('film-dirt-val');
  if (filmDirtSlider && document.activeElement !== filmDirtSlider) filmDirtSlider.value = dirtPct;
  if (filmDirtVal) filmDirtVal.textContent = dirtPct + '%';

  let filmToneSlider = document.getElementById('film-tone-slider');
  let filmToneVal = document.getElementById('film-tone-val');
  if (filmToneSlider && document.activeElement !== filmToneSlider) filmToneSlider.value = tonePct;
  if (filmToneVal) filmToneVal.textContent = getFilmToneName(tonePct);

  // 5. Sliders
  let waveSlider = document.getElementById('wave-slider');
  let waveVal = document.getElementById('wave-val');
  let wavePct = Math.round(refState.wave * 100);
  if (waveSlider && document.activeElement !== waveSlider) waveSlider.value = wavePct;
  if (waveVal) waveVal.textContent = wavePct + '%';

  let zoomSlider = document.getElementById('zoom-slider');
  let zoomVal = document.getElementById('zoom-val');
  if (zoomSlider && document.activeElement !== zoomSlider) zoomSlider.value = refState.zoom.toFixed(1);
  if (zoomVal) zoomVal.textContent = refState.zoom.toFixed(1) + 'x';

  let fusionSlider = document.getElementById('fusion-slider');
  let fusionVal = document.getElementById('fusion-val');
  let fusionPct = Math.round(refState.fusion * 100);
  if (fusionSlider && document.activeElement !== fusionSlider) fusionSlider.value = fusionPct;
  if (fusionVal) fusionVal.textContent = fusionPct + '%';

  let shutterSlider = document.getElementById('shutter-slider');
  let shutterVal = document.getElementById('shutter-val');
  let shutterPct = Math.round((refState.shutter || 0) * 100);
  if (shutterSlider && document.activeElement !== shutterSlider) shutterSlider.value = shutterPct;
  if (shutterVal) shutterVal.textContent = shutterPct + '%';

  let decaySlider = document.getElementById('decay-slider');
  let decayVal = document.getElementById('decay-val');
  if (decaySlider && document.activeElement !== decaySlider) decaySlider.value = refState.trail.toFixed(2);
  if (decayVal) decayVal.textContent = refState.trail.toFixed(2);

  let warpSlider = document.getElementById('warp-slider');
  let warpVal = document.getElementById('warp-val');
  let warpPct = Math.round(refState.warp * 100);
  if (warpSlider && document.activeElement !== warpSlider) warpSlider.value = warpPct;
  if (warpVal) warpVal.textContent = warpPct + '%';

  let aspectSlider = document.getElementById('aspect-slider');
  let aspectVal = document.getElementById('aspect-val');
  let aspectPct = Math.round((typeof refState.aspect === 'number' ? refState.aspect : 0) * 100);
  if (aspectSlider && document.activeElement !== aspectSlider) aspectSlider.value = aspectPct;
  if (aspectVal) {
    aspectVal.textContent = aspectPct === 0 ? 'Original' : (aspectPct === 100 ? 'Llenar' : aspectPct + '%');
  }

  let brushSlider = document.getElementById('brush-slider');
  let brushVal = document.getElementById('brush-val');
  if (brushSlider && document.activeElement !== brushSlider) brushSlider.value = refState.brush;
  if (brushVal) brushVal.textContent = refState.brush + 'px';

  // 6. Audio
  let soundLabel = document.getElementById('sound-label');
  if (soundLabel) soundLabel.textContent = soundEnabled ? 'ON' : 'OFF';

  let pitchSlider = document.getElementById('pitch-slider');
  let pitchVal = document.getElementById('pitch-val');
  if (pitchSlider && document.activeElement !== pitchSlider) pitchSlider.value = audioPitchSemitones;
  if (pitchVal) pitchVal.textContent = (audioPitchSemitones > 0 ? `+${audioPitchSemitones}` : `${audioPitchSemitones}`) + ' st';

  let rateSlider = document.getElementById('rate-slider');
  let rateVal = document.getElementById('rate-val');
  if (rateSlider && document.activeElement !== rateSlider) rateSlider.value = audioPlaybackRate;
  if (rateVal) rateVal.textContent = audioPlaybackRate.toFixed(2) + 'x';

  let resLabel = document.getElementById('res-label');
  if (resLabel && RESOLUTION_MODES[currentResIndex]) {
    resLabel.textContent = RESOLUTION_MODES[currentResIndex].label;
  }

  // 7. Estado Máquina de Escribir
  let twStatus = document.getElementById('tw-status');
  if (twStatus) {
    let anyActive = channelStates[1].typewriterActive || channelStates[2].typewriterActive || channelStates[3].typewriterActive || channelStates[4].typewriterActive;
    twStatus.classList.toggle('active', anyActive);
  }
  let activeStyle = refState.typewriterStyle || currentTypewriterStyle || 'box-black';
  updateTypewriterStyleUI(activeStyle);
}

// =========================================================================
// ACCIONES VJ
// =========================================================================
function setSourceMode(newMode) {
  updateChannelParam('source', newMode);
  syncUIControls();
  broadcastCommand('SOURCE', newMode);

  if (newMode === 'CAMARA' && !videoCapture) initWebcam();
  if (newMode === 'VIDEO' && videoPlayer && videoReady) {
    videoPlayer.loop();
    videoPlayer.play();
  }

  showMidiHUD(newMode === 'IMAGENES' ? 'Fotos' : newMode === 'CAMARA' ? 'Cámara Web' : 'Video Loop');
}

function stopWebcam() {
  if (videoCapture) {
    try {
      if (videoCapture.elt && videoCapture.elt.srcObject) {
        let stream = videoCapture.elt.srcObject;
        let tracks = stream.getTracks();
        tracks.forEach(track => track.stop());
        videoCapture.elt.srcObject = null;
      }
      videoCapture.remove();
    } catch (err) {
      console.warn("Aviso al detener stream de cámara:", err);
    }
    videoCapture = null;
    cameraReady = false;
    isCameraStarting = false;
  }
}

function initWebcam() {
  if (cameraReady || isCameraStarting) return;
  isCameraStarting = true;

  // Limpiar cualquier flujo previo antes de solicitar el dispositivo
  if (videoCapture) stopWebcam();

  try {
    let constraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 }
      },
      audio: false
    };

    videoCapture = createCapture(constraints, (stream) => {
      cameraReady = true;
      isCameraStarting = false;
      console.log("Cámara web inicializada con éxito.");
      showMidiHUD("Cámara Conectada");
    });

    if (videoCapture && videoCapture.elt) {
      videoCapture.elt.muted = true;
      videoCapture.elt.setAttribute('playsinline', '');
      videoCapture.elt.setAttribute('autoplay', '');
    }

    videoCapture.size(320, 240);
    videoCapture.hide();
  } catch (err) {
    console.warn("No se pudo iniciar la cámara web:", err);
    isCameraStarting = false;
    cameraReady = false;
    showMidiHUD("Cámara ocupada o bloqueada");
  }
}

window.addEventListener('beforeunload', () => {
  stopWebcam();
});

function loadCustomVideoFile(file) {
  let cleanName = file.name.replace(/\.[^/.]+$/, "");
  let blobUrl = URL.createObjectURL(file);

  if (videoPlayer) {
    videoPlayer.stop();
    videoPlayer.remove();
  }

  videoPlayer = createVideo(blobUrl, () => {
    videoReady = true;
    videoName = cleanName;
    videoPlayer.volume(0);
    videoPlayer.loop();
    videoPlayer.hide();
    setSourceMode('VIDEO');
    showMidiHUD(`Video: ${cleanName}`);
    saveVideoToDB(file, cleanName);
  });
}

function setColorMode(idx) {
  let mode = idx % COLOR_MODES.length;
  updateChannelParam('mode', mode);
  syncUIControls();
  broadcastCommand('COLOR_MODE', mode);
  showMidiHUD(`Paleta: ${COLOR_MODES[mode]}`);
}

function setTintAngle(val, showHUD = true) {
  let angle = constrain(Math.round(val), 0, 360);
  if (angle > 0) updateChannelParam('lastActiveTint', angle);
  updateChannelParam('tint', angle);
  syncUIControls();
  broadcastCommand('TINT_ANGLE', angle);
  if (showHUD) showMidiHUD(`Tinte: ${getTintName(angle)}`);
}

function cycleTintColor(direction = 1) {
  currentTintPresetIndex = (currentTintPresetIndex + direction + TINT_PRESETS.length) % TINT_PRESETS.length;
  let angle = TINT_PRESETS[currentTintPresetIndex].angle;
  setTintAngle(angle, true);
}

function toggleTint() {
  let refState = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
  if (refState.tint > 0) {
    setTintAngle(0, true);
  } else {
    let fallback = refState.lastActiveTint > 0 ? refState.lastActiveTint : 180;
    setTintAngle(fallback, true);
  }
}

function resetTint() {
  setTintAngle(0, true);
}

function toggleRedLight() {
  let refState = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
  let newState = !refState.red;
  updateChannelParam('red', newState);
  syncUIControls();
  broadcastCommand('RED_LIGHT', newState);
  showMidiHUD(newState ? "Ilum. Roja ON" : "Ilum. Roja OFF");
}

function togglePause() {
  let refState = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
  let newState = !refState.paused;
  updateChannelParam('paused', newState);
  syncUIControls();
  broadcastCommand('PAUSE', newState);
  showMidiHUD(newState ? "Pausado" : "Reanudado");
}

function toggleVintageFilm() {
  let refState = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
  let curDirt = typeof refState.vintageDirt === 'number' ? refState.vintageDirt : 0.0;
  let curTone = typeof refState.vintageTone === 'number' ? refState.vintageTone : 0.0;
  let isCurrentlyOn = curDirt > 0.05 || curTone > 0.05;

  let nextDirt = isCurrentlyOn ? 0.0 : 0.60;
  let nextTone = isCurrentlyOn ? 0.0 : 0.75;
  let nextVintage = !isCurrentlyOn;

  updateChannelParam('vintageDirt', nextDirt);
  updateChannelParam('vintageTone', nextTone);
  updateChannelParam('vintage', nextVintage);

  syncUIControls();
  broadcastCommand('VINTAGE_DIRT', nextDirt);
  broadcastCommand('VINTAGE_TONE', nextTone);
  broadcastCommand('VINTAGE', nextVintage);
  showMidiHUD(nextVintage ? "Cine 20s (Sepia Clásico 75%)" : "Cine 20s OFF");
}

function toggleGlitch() {
  let refState = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
  let cur = typeof refState.glitch === 'number' ? refState.glitch : 0.0;
  let nextVal = cur > 0.05 ? 0.0 : 0.75;
  updateChannelParam('glitch', nextVal);
  isGlitchActive = nextVal > 0.01;
  syncUIControls();
  broadcastCommand('GLITCH', nextVal);
  showMidiHUD(nextVal > 0.01 ? "Glitch FX ON (75%)" : "Glitch FX OFF");
}

function cycleWaveDeform() {
  currentWaveIndex = (currentWaveIndex + 1) % WAVE_PRESETS.length;
  let val = WAVE_PRESETS[currentWaveIndex].val;
  triggerIntenseWave(120);
  updateChannelParam('wave', val);
  syncUIControls();
  broadcastCommand('WAVE_DEFORM', val);
  showMidiHUD(`Wave: ${WAVE_PRESETS[currentWaveIndex].label}`);
}

function cycleFusion() {
  currentFusionIndex = (currentFusionIndex + 1) % FUSION_PRESETS.length;
  let val = FUSION_PRESETS[currentFusionIndex].val;
  updateChannelParam('fusion', val);
  syncUIControls();
  broadcastCommand('FUSION', val);
  showMidiHUD(`Fusión: ${FUSION_PRESETS[currentFusionIndex].label}`);
}

function cycleTrail() {
  currentTrailIndex = (currentTrailIndex + 1) % TRAIL_PRESETS.length;
  let val = TRAIL_PRESETS[currentTrailIndex].decay;
  updateChannelParam('trail', val);
  syncUIControls();
  broadcastCommand('TRAIL', val);
  showMidiHUD(`Estela: ${TRAIL_PRESETS[currentTrailIndex].label}`);
}

function cycleZoom() {
  currentZoomIndex = (currentZoomIndex + 1) % ZOOM_PRESETS.length;
  let val = ZOOM_PRESETS[currentZoomIndex].factor;
  updateChannelParam('zoom', val);
  syncUIControls();
  broadcastCommand('ZOOM', val);
  showMidiHUD(`Zoom: ${ZOOM_PRESETS[currentZoomIndex].label}`);
}

function cycleBrushSize() {
  currentBrushIndex = (currentBrushIndex + 1) % BRUSH_PRESETS.length;
  let val = BRUSH_PRESETS[currentBrushIndex].radius;
  updateChannelParam('brush', val);
  syncUIControls();
  broadcastCommand('BRUSH', val);
  showMidiHUD(`Pincel: ${BRUSH_PRESETS[currentBrushIndex].label}`);
}

function cycleAspect() {
  let refState = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
  let cur = typeof refState.aspect === 'number' ? refState.aspect : 0.0;
  let nextVal = cur < 0.5 ? 1.0 : 0.0;
  updateChannelParam('aspect', nextVal);
  syncUIControls();
  broadcastCommand('ASPECT', nextVal);
  showMidiHUD(nextVal === 0.0 ? "Aspecto: Original (16:9)" : "Aspecto: Llenar Pantalla");
}

function cycleResolution() {
  currentResIndex = (currentResIndex + 1) % RESOLUTION_MODES.length;
  syncUIControls();
  showMidiHUD(`Nitidez: ${RESOLUTION_MODES[currentResIndex].label}`);
}

function toggleFullscreen() {
  let fs = fullscreen();
  fullscreen(!fs);
  showMidiHUD(!fs ? "Pantalla Completa" : "Ventana Normal");
}

function getTintName(angle) {
  if (angle <= 0) return 'Neutro';
  if (angle <= 45) return `Ámbar (${angle}°)`;
  if (angle <= 90) return `Dorado (${angle}°)`;
  if (angle <= 150) return `Esmeralda (${angle}°)`;
  if (angle <= 200) return `Cian (${angle}°)`;
  if (angle <= 250) return `Azul (${angle}°)`;
  if (angle <= 290) return `Púrpura (${angle}°)`;
  if (angle <= 335) return `Magenta (${angle}°)`;
  return `Rubí (${angle}°)`;
}

function getFilmToneName(val) {
  if (val <= 0) return 'Original';
  if (val <= 20) return `B&N Neutro (${val}%)`;
  if (val <= 40) return `B&N Celuloide (${val}%)`;
  if (val <= 60) return `Tono Platino (${val}%)`;
  if (val <= 80) return `Sepia Clásico (${val}%)`;
  return `Sepia Ámbar (${val}%)`;
}

// =========================================================================
// FOTOS: NAVEGACIÓN Y CARGA
// =========================================================================
function triggerNextTransition() {
  if (imagesList.length <= 1) return;
  let chans = activeChannel === 0 ? [1, 2, 3, 4] : [activeChannel];
  for (let ch of chans) {
    let s = channelStates[ch];
    if (s.source === 'IMAGENES') {
      s.currentIndex = s.nextIndex;
      s.nextIndex = (s.nextIndex + 1) % imagesList.length;
      seedChannel(ch, s.currentIndex, s.nextIndex);
    }
  }
  let ref = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
  broadcastCommand('NEXT_PHOTO', null);
  broadcastCommand('PHOTO_INDEX', { curr: ref.currentIndex, next: ref.nextIndex });
  updateBadge();
}

function triggerPrevTransition() {
  if (imagesList.length <= 1) return;
  let chans = activeChannel === 0 ? [1, 2, 3, 4] : [activeChannel];
  for (let ch of chans) {
    let s = channelStates[ch];
    if (s.source === 'IMAGENES') {
      s.nextIndex = s.currentIndex;
      s.currentIndex = (s.currentIndex - 1 + imagesList.length) % imagesList.length;
      seedChannel(ch, s.currentIndex, s.nextIndex);
    }
  }
  let ref = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
  broadcastCommand('PREV_PHOTO', null);
  broadcastCommand('PHOTO_INDEX', { curr: ref.currentIndex, next: ref.nextIndex });
  updateBadge();
}

function updateBadge() {
  let badge = document.getElementById('image-badge');
  if (badge && imagesList.length > 0) {
    badge.textContent = `Fotos: ${imagesList.length}`;
  }
}

function optimizeImageToDataURL(p5Img, maxDim = 1280, quality = 0.85) {
  try {
    if (!p5Img) return null;
    let w = p5Img.width || (p5Img.elt ? p5Img.elt.width : 0);
    let h = p5Img.height || (p5Img.elt ? p5Img.elt.height : 0);
    if (w <= 0 || h <= 0) return null;

    let targetW = w;
    let targetH = h;
    if (targetW > maxDim || targetH > maxDim) {
      if (targetW > targetH) {
        targetH = Math.round((targetH * maxDim) / targetW);
        targetW = maxDim;
      } else {
        targetW = Math.round((targetW * maxDim) / targetH);
        targetH = maxDim;
      }
    }

    let canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    let ctx = canvas.getContext('2d');
    let srcElt = p5Img.canvas || p5Img.elt || p5Img;
    ctx.drawImage(srcElt, 0, 0, targetW, targetH);
    return canvas.toDataURL('image/jpeg', quality);
  } catch (err) {
    console.warn("optimizeImageToDataURL fallback:", err);
    return null;
  }
}

function loadFilesIntoGallery(files) {
  let validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (validFiles.length === 0) return;

  let newImages = [];
  let dbPayload = [];
  let loadedCount = 0;

  for (let file of validFiles) {
    let reader = new FileReader();
    reader.onload = (event) => {
      let dataUrl = event.target.result;
      loadImage(dataUrl, (p5Img) => {
        let cleanName = file.name.replace(/\.[^/.]+$/, "");
        newImages.push({
          name: cleanName,
          sourceImg: p5Img,
          data: resampleP5Image(p5Img)
        });
        let optDataUrl = optimizeImageToDataURL(p5Img) || dataUrl;
        dbPayload.push({
          name: cleanName,
          dataUrl: optDataUrl
        });
        loadedCount++;
        if (loadedCount === validFiles.length) {
          imagesList = newImages;
          for (let ch = 1; ch <= 4; ch++) {
            seedChannel(ch, 0, imagesList.length > 1 ? 1 : 0);
          }
          saveImagesToDB(dbPayload);
          updateBadge();
          showMidiHUD(`${loadedCount} Fotos Cargadas`);
        }
      });
    };
    reader.readAsDataURL(file);
  }
}

// =========================================================================
// AUDIO MODULATION & SOUND ENGINE
// =========================================================================
function getCurrentSound() {
  if (audioList.length > 0 && audioList[currentAudioIndex]) {
    return audioList[currentAudioIndex].sound;
  }
  return null;
}

function updateAudioRateAndPitch() {
  let snd = getCurrentSound();
  if (!snd) return;
  // Transposición tonal musical: 2^(semitonos / 12)
  let pitchFactor = Math.pow(2.0, audioPitchSemitones / 12.0);
  let effectiveRate = constrain(audioPlaybackRate * pitchFactor, 0.15, 3.5);
  snd.rate(effectiveRate);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  let snd = getCurrentSound();
  if (!soundEnabled && snd && snd.isPlaying()) {
    snd.pause();
  } else if (soundEnabled && snd) {
    userStartAudio();
    updateAudioRateAndPitch();
    snd.setVolume(masterVolume * 0.45, 0.1);
    if (!snd.isPlaying()) snd.loop();
  }
  syncUIControls();
  showMidiHUD(soundEnabled ? "Audio Activado" : "Audio Silenciado");
}

function switchNextAudioTrack() {
  if (audioList.length <= 1) return;
  let snd = getCurrentSound();
  if (snd && snd.isPlaying()) snd.stop();
  currentAudioIndex = (currentAudioIndex + 1) % audioList.length;
  updateAudioLabel();
  let newSnd = getCurrentSound();
  if (soundEnabled && newSnd) {
    userStartAudio();
    updateAudioRateAndPitch();
    newSnd.setVolume(masterVolume * 0.45, 0.1);
    newSnd.loop();
  }
  showMidiHUD(`Pista: ${audioList[currentAudioIndex].name}`);
}

function updateAudioLabel() {
  let label = document.getElementById('audio-track-label');
  let labelTop = document.getElementById('audio-track-label-top');
  if (audioList.length > 0 && audioList[currentAudioIndex]) {
    let n = audioList[currentAudioIndex].name;
    if (label) label.textContent = n;
    if (labelTop) labelTop.textContent = n;
  }
}

function loadCustomAudioFile(file) {
  let cleanName = file.name.replace(/\.[^/.]+$/, "");
  let blobUrl = URL.createObjectURL(file);
  let snd = loadSound(blobUrl, () => {
    let oldSnd = getCurrentSound();
    if (oldSnd && oldSnd.isPlaying()) oldSnd.stop();
    audioList.push({ name: cleanName, sound: snd });
    currentAudioIndex = audioList.length - 1;
    updateAudioLabel();
    if (soundEnabled) {
      userStartAudio();
      updateAudioRateAndPitch();
      snd.setVolume(masterVolume * 0.45, 0.1);
      snd.loop();
    }
    showMidiHUD(`Audio: ${cleanName}`);
  });
}

function modulateAudioFromCoords(normX, speed) {
  if (!soundEnabled) return;
  let snd = getCurrentSound();
  if (!snd) return;

  userStartAudio();
  if (!snd.isPlaying()) {
    updateAudioRateAndPitch();
    snd.setVolume(0.001);
    snd.loop();
  }

  let pitchFactor = Math.pow(2.0, audioPitchSemitones / 12.0);
  let speedWarp = map(speed, 0, 45, 0.0, 0.35, true);
  let finalRate = constrain((audioPlaybackRate * pitchFactor) + speedWarp, 0.15, 3.5);
  let panVal = map(normX, 0, 1, -0.75, 0.75, true);
  let strokeVol = map(speed, 0, 30, 0.45, 1.0, true) * masterVolume;

  snd.rate(finalRate);
  snd.pan(panVal);
  snd.setVolume(strokeVol, 0.05);
}

function handleAudioModulation() {
  let mouseSpeed = dist(mouseX, mouseY, pmouseX, pmouseY);
  let normX = width > 0 ? mouseX / width : 0.5;
  modulateAudioFromCoords(normX, mouseSpeed);
}

function handleAudioRelease() {
  let snd = getCurrentSound();
  if (snd && snd.isPlaying()) {
    if (soundEnabled) {
      updateAudioRateAndPitch();
      snd.pan(0);
      snd.setVolume(masterVolume * 0.45, 0.3);
    } else {
      snd.setVolume(0.0, 0.28);
    }
  }
}

// =========================================================================
// ATAJOS DE TECLADO
// =========================================================================
function keyPressed() {
  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA')) {
    return;
  }
  if (key === ' ' || keyCode === 32) {
    triggerNextTransition();
  } else if (keyCode === RIGHT_ARROW) {
    triggerNextTransition();
  } else if (keyCode === LEFT_ARROW) {
    triggerPrevTransition();
  } else if (key === 'c' || key === 'C') {
    let ref = activeChannel === 0 ? channelStates[1] : channelStates[activeChannel];
    setColorMode((ref.mode + 1) % COLOR_MODES.length);
  } else if (key === 't' || key === 'T') {
    cycleTintColor(1);
  } else if (key === 'p' || key === 'P') {
    togglePause();
  } else if (key === '1') {
    setSourceMode('IMAGENES');
  } else if (key === '2') {
    setSourceMode('CAMARA');
  } else if (key === '3') {
    setSourceMode('VIDEO');
  } else if (key === 'f' || key === 'F') {
    toggleFullscreen();
  } else if (key === 'a' || key === 'A') {
    switchNextAudioTrack();
  } else if (key === 'm' || key === 'M') {
    toggleSound();
  } else if (key === 'x' || key === 'X') {
    cycleFusion();
  } else if (key === 'e' || key === 'E') {
    cycleTrail();
  } else if (key === 'z' || key === 'Z') {
    cycleZoom();
  } else if (key === 'b' || key === 'B') {
    cycleBrushSize();
  } else if (key === 'g' || key === 'G') {
    toggleGlitch();
  } else if (key === 'r' || key === 'R') {
    toggleRedLight();
  } else if (key === 'w' || key === 'W') {
    cycleWaveDeform();
  } else if (key === 'h' || key === 'H') {
    toggleControlDeck();
  } else if (key === 'v' || key === 'V') {
    toggleSoloViewMode();
  } else if (key === 'o' || key === 'O') {
    cycleAspect();
  } else if (key === 'k' || key === 'K') {
    toggleVintageFilm();
  }
}

// =========================================================================
// DRAG & DROP
// =========================================================================
function setupDragAndDrop() {
  let overlay = document.getElementById('drop-overlay');

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (overlay) overlay.classList.add('active');
  });

  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null && overlay) overlay.classList.remove('active');
  });

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (overlay) overlay.classList.remove('active');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      let files = Array.from(e.dataTransfer.files);
      let audioFiles = files.filter(f => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|m4a|aac|flac)$/i.test(f.name));
      let videoFiles = files.filter(f => f.type.startsWith('video/') || /\.(mp4|webm|ogv|m4v)$/i.test(f.name));
      let imageFiles = files.filter(f => f.type.startsWith('image/'));

      if (videoFiles.length > 0) loadCustomVideoFile(videoFiles[0]);
      if (audioFiles.length > 0) loadCustomAudioFile(audioFiles[0]);
      if (imageFiles.length > 0) loadFilesIntoGallery(imageFiles);
    }
  });
}

// =========================================================================
// MOTOR WEB MIDI (ARTURIA MICROLAB Y CONTROLADORES ESTÁNDAR)
// =========================================================================
function initWebMIDI() {
  if (navigator.requestMIDIAccess) {
    navigator.requestMIDIAccess({ sysex: false })
      .then(onMIDISuccess, onMIDIFailure);
  } else {
    console.warn("Web MIDI API no soportada en este navegador.");
    let badge = document.getElementById('midi-badge');
    if (badge) badge.textContent = "MIDI: Usá Chrome / Edge";
  }
}

function onMIDISuccess(midiAccess) {
  let badge = document.getElementById('midi-badge');
  let inputs = midiAccess.inputs.values();
  let count = 0;
  for (let input of inputs) {
    input.onmidimessage = handleMIDIMessage;
    count++;
  }

  if (count > 0) {
    if (badge) {
      badge.textContent = `MIDI: Arturia MicroLab`;
      badge.classList.add('connected');
    }
    showMidiHUD(`Arturia MicroLab Conectado`);
  }

  midiAccess.onstatechange = (e) => {
    if (e.port.type === 'input') {
      if (e.port.state === 'connected') {
        e.port.onmidimessage = handleMIDIMessage;
        if (badge) {
          badge.textContent = `MIDI: ${e.port.name || 'Conectado'}`;
          badge.classList.add('connected');
        }
        showMidiHUD("MIDI Conectado");
      } else {
        if (badge) {
          badge.textContent = "MIDI: Desconectado";
          badge.classList.remove('connected');
        }
        showMidiHUD("MIDI Desconectado");
      }
    }
  };
}

function onMIDIFailure(err) {
  console.warn("No se pudo acceder a Web MIDI:", err);
}

function handleMIDIMessage(event) {
  let status = event.data[0];
  let cmd = status >> 4;
  let d1 = event.data[1];
  let d2 = event.data.length > 2 ? event.data[2] : 0;

  // 1. TIRA DE PITCH BEND (0xE)
  if (cmd === 0xE) {
    let bendRaw = (d2 << 7) | d1;
    let bendNorm = (bendRaw - 8192) / 8192.0;
    if (bendNorm > 0.05) {
      pitchBendWarpOffset = bendNorm * 3.5;
      showMidiHUD(`Warp Glitch: +${Math.round(bendNorm * 100)}%`);
    } else {
      pitchBendWarpOffset = 0.0;
    }
    return;
  }

  // 2. CONTROL CHANGE (0xB) - Tira MOD (CC 1)
  if (cmd === 0xB) {
    let ccNum = d1;
    let ccVal = d2;
    if (ccNum === 1) {
      let warpVal = (ccVal / 127.0) * 2.0;
      updateChannelParam('warp', warpVal);
      syncUIControls();
      broadcastCommand('WARP', warpVal);
      showMidiHUD(`Fluidez: ${Math.round(warpVal * 100)}%`);
    } else if (ccNum === 74 || ccNum === 71 || ccNum === 7) {
      masterVolume = ccVal / 127.0;
      showMidiHUD(`Volumen: ${Math.round(masterVolume * 100)}%`);
    }
    return;
  }

  // 3. NOTE ON (0x9 con velocity > 0)
  if (cmd === 0x9 && d2 > 0) {
    handleNoteOn(d1, d2);
    return;
  }

  // 4. NOTE OFF (0x8)
  if (cmd === 0x8 || (cmd === 0x9 && d2 === 0)) {
    handleNoteOff(d1);
    return;
  }
}

function handleNoteOn(note, velocity) {
  let relIndex = (note - 48);
  if (relIndex < 0 || relIndex > 24) relIndex = ((note % 25) + 25) % 25;
  let gx = floor(map(relIndex, 0, 24, SIM_COLS * 0.08, SIM_COLS * 0.92));
  let gy = floor(SIM_ROWS * 0.5 + sin(note * 0.5) * (SIM_ROWS * 0.22));
  injectShockwave(gx, gy, velocity);

  let pitch = note % 12;

  // Zona 1: Graves -> Fuentes y Fusión
  if (note < 56) {
    if (pitch === 0) setSourceMode('IMAGENES');
    else if (pitch === 2) setSourceMode('CAMARA');
    else if (pitch === 4) setSourceMode('VIDEO');
    else if (pitch === 5) cycleFusion();
    else if (pitch === 7) cycleTrail();
    return;
  }

  // Zona 2A: Tinte Cromático
  if (note >= 56 && note < 60) {
    if (note === 56) resetTint();
    else if (note === 57) cycleTintColor(1);
    else if (note === 58) toggleTint();
    else if (note === 59) cycleTintColor(-1);
    return;
  }

  // Zona 2B: Paletas y Zoom
  if (note >= 60 && note < 68) {
    if (pitch === 0) setColorMode(0);
    else if (pitch === 2) setColorMode(1);
    else if (pitch === 4) cycleZoom();
    else if (pitch === 5) setColorMode(2);
    else if (pitch === 7) setColorMode(3);
    return;
  }

  // Zona 3: Agudos
  if (note >= 68) {
    if (note === 68) setColorMode(4);
    else if (pitch === 9) cycleWaveDeform();
    else if (pitch === 10 || note === 70) {
      isGlitchActive = true;
      broadcastCommand('GLITCH', true);
      showMidiHUD("Glitch Analógico");
    } else if (pitch === 11) toggleRedLight();
    else if (pitch === 0) cycleBrushSize();
    else if (pitch === 2) {
      isGlitchActive = true;
      broadcastCommand('GLITCH', true);
      showMidiHUD("Glitch Analógico");
    } else if (pitch === 4) {
      isFreezeActive = true;
      broadcastCommand('FREEZE', true);
      showMidiHUD("Freeze Frame");
    } else {
      triggerIntenseWave(velocity);
    }
  }
}

function handleNoteOff(note) {
  let pitch = note % 12;
  if (note >= 68) {
    if (pitch === 2 || pitch === 10 || note === 70) {
      isGlitchActive = false;
      broadcastCommand('GLITCH', false);
    } else if (pitch === 4) {
      isFreezeActive = false;
      broadcastCommand('FREEZE', false);
    }
  }
}

// =========================================================================
// RETROALIMENTACIÓN VISUAL HUD FLOTANTE
// =========================================================================
let hudTimeout = null;
function showMidiHUD(arg1, arg2) {
  let text = arg2 !== undefined ? arg2 : arg1;
  if (!text) return;
  text = String(text).replace(/[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F100}-\u{1F1FF}]/gu, '').trim();
  let hud = document.getElementById('midi-hud');
  if (!hud) return;
  hud.innerHTML = `<span class="hud-val">${text}</span>`;
  hud.classList.add('active');
  if (hudTimeout) clearTimeout(hudTimeout);
  hudTimeout = setTimeout(() => { hud.classList.remove('active'); }, 1200);
}
