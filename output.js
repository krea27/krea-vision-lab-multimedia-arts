/**
 * KREA VISION LAB · Salida Touch Limpia (Clean Feed & Multi-Touch Node)
 * Diseñado para Pantallas Táctiles Públicas, Tótems Interactivos y Conexión NDI/Spout a Resolume.
 * Sin elementos de interfaz visual: 100% interactivo mediante toque o mouse.
 */

// Parámetros de URL o almacenamiento local de sesión para identificar el canal/pantalla (0 = Auto/Master, 1..4 = Fijo)
const urlParams = new URLSearchParams(window.location.search);
let parsedScreen = parseInt(urlParams.get('screen'));
let screenId = (!isNaN(parsedScreen) && parsedScreen >= 1 && parsedScreen <= 4)
  ? parsedScreen
  : (sessionStorage.getItem('krea_screen_id') !== null ? parseInt(sessionStorage.getItem('krea_screen_id')) : 0);

// Resolución de simulación optimizada para 60 FPS fijos
let resolution = 2;
let cols, rows;

// Grillas de simulación numérica (Float32Array)
let gridR, nextR;
let gridG, nextG;
let gridB, nextB;

// Buffer de renderizado p5.Image
let caImage;

// Galería de imágenes base
const LOCAL_IMAGE_PATHS = [
  'img/1.png',
  'img/6.png',
  'img/3.png'
];
let rawImages = [];
let imagesList = [];
let currentIndex = 0;
let nextIndex = 1;

// Modos de Entrada: 'IMAGENES' | 'CAMARA' | 'VIDEO'
let currentSource = 'IMAGENES';
let videoCapture = null;
let cameraReady = false;
let isCameraStarting = false;
let videoPlayer = null;
let videoReady = false;
let videoName = 'Ninguno';

let cameraFeedGfx = null;
let cameraFeedData = null;
let videoFeedGfx = null;
let videoFeedData = null;

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

let hasCustomImagesUploaded = false;

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
        callback(req.result);
      }
    };
    tx.oncomplete = () => {
      if (!delivered && req.result && Array.isArray(req.result) && req.result.length > 0) {
        delivered = true;
        callback(req.result);
      }
    };
  } catch (err) {
    console.warn("Error leyendo imágenes de DB:", err);
  }
}

function applyUploadedImages(items) {
  if (!items || items.length === 0) return;
  hasCustomImagesUploaded = true;
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
        seedCurrentToNext(0, imagesList.length > 1 ? 1 : 0);
        console.log(`Pantalla ${screenId}: ${loadedCount} fotos sincronizadas con la consola.`);
      }
    }, (err) => {
      console.warn("Error cargando foto en salida limpia:", err);
      loadedCount++;
      if (loadedCount === items.length && newImages.length > 0) {
        imagesList = newImages;
        seedCurrentToNext(0, imagesList.length > 1 ? 1 : 0);
      }
    });
  }
}

function loadLocalFilesIntoOutput(files) {
  let validFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (validFiles.length === 0) return;
  let items = [];
  for (let file of validFiles) {
    let reader = new FileReader();
    reader.onload = (event) => {
      items.push({
        name: file.name.replace(/\.[^/.]+$/, ""),
        dataUrl: event.target.result
      });
      if (items.length === validFiles.length) {
        applyUploadedImages(items);
      }
    };
    reader.readAsDataURL(file);
  }
}

// Efectos en Vivo sincronizados por el VJ
let isStrobeActive = false;
let isGlitchActive = false;
let glitchAmount = 0.0;
let isVintageActive = false;
let vintageDirt = 0.0;
let vintageTone = 0.0;
let isRedLightActive = false;
let isFreezeActive = false;
let pitchBendWarpOffset = 0.0;

// Máquina de escribir / Mensajes en vivo
let typewriterText = '';
let typewriterDisplay = '';
let typewriterIndex = 0;
let typewriterActive = false;
let typewriterStyle = 'box-black';

// Deformación en ondas, Tinte cromático y Zoom
let waveDeformIntensity = 0.0;
let waveDeformPhase = 0.0;
let tintAngle = 0;
let zoomFactor = 1.0;
let currentZoomDisplay = 1.0;

// Dinámica del autómata celular
let decay = 1.1;
let cycleDuration = 6.0;
let cycleTimer = 0;
let isPaused = false;
let brushRadius = 50;
let fluidWarpFactor = 1.0;
let fusionAmount = 0.0;
let shutterTrail = 0.0;
let aspectFit = 0.0;
let historyR = null, historyG = null, historyB = null;

// Seguimiento de toque para modulación remota de sonido
let prevTouchX = 0, prevTouchY = 0;
let wasTouchingPrev = false;

// Modos de Color
const COLOR_MODES = [
  'RGB Original',
  'Mapa de Calor',
  'Neón Ciber',
  'B&N Fotocopia',
  'B&N Orgánico',
  'Invertido / Rayos X'
];
let currentModeIndex = 0;

// Tabla precalculada (LUT) de curvas cúbicas suaves (Hermite)
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

// Configuración predeterminada según el número de pantalla
function applyScreenDefaults() {
  aspectFit = 0.0;
  glitchAmount = 0.0;
  isGlitchActive = false;
  isVintageActive = false;
  vintageDirt = 0.0;
  vintageTone = 0.0;
  typewriterActive = false;
  typewriterText = '';
  typewriterDisplay = '';
  typewriterIndex = 0;
  typewriterStyle = 'box-black';
  if (screenId === 0 || screenId === 1) {
    // Pantalla 1 o Modo Auto (Sigue a la Consola Master): Galería Botánica / Fotos naturales
    currentSource = 'IMAGENES';
    currentModeIndex = 0; // RGB
    tintAngle = 0;
    fusionAmount = 0.0;
    waveDeformIntensity = 0.0;
    decay = 1.1;
    isRedLightActive = false;
  } else if (screenId === 2) {
    // Pantalla 2: Cámara Web en vivo (el público se ve deformado con Mapa de Calor)
    currentSource = 'CAMARA';
    currentModeIndex = 1; // Mapa de Calor Térmico (FLIR)
    tintAngle = 180;      // Cian
    waveDeformIntensity = 0.25;
    decay = 1.1;
    isRedLightActive = false;
  } else if (screenId === 3) {
    // Pantalla 3: Video Loop / Fanzine Fotocopia
    currentSource = 'VIDEO';
    currentModeIndex = 3; // B&N Fotocopia
    tintAngle = 310;      // Risografía Magenta
    waveDeformIntensity = 0.0;
    decay = 0.5;
    isRedLightActive = false;
  } else if (screenId === 4) {
    // Pantalla 4: Fusión Híbrida (Fotos + Dinámica Orgánica)
    currentSource = 'IMAGENES';
    fusionAmount = 0.65;
    currentModeIndex = 5; // Rayos X
    tintAngle = 65;       // Dorado
    waveDeformIntensity = 0.0;
    decay = 1.1;
    isRedLightActive = false;
  }
  setSourceMode(currentSource);
}

// =========================================================================
// PRELOAD
// =========================================================================
function preload() {
  for (let i = 0; i < LOCAL_IMAGE_PATHS.length; i++) {
    const idx = i;
    rawImages[i] = loadImage(
      LOCAL_IMAGE_PATHS[i],
      (loadedImg) => {
        if (!hasCustomImagesUploaded && loadedImg && loadedImg.width > 1) {
          let name = `Foto ${idx + 1}`;
          let exists = imagesList.some(item => item.name === name);
          if (!exists && typeof cols !== 'undefined' && cols > 0) {
            addLoadedImage(loadedImg, name);
            if (imagesList.length === 1 && currentSource === 'IMAGENES') {
              seedCurrentToNext(0, 0);
            }
          }
        }
      },
      (err) => console.warn(`Error precargando ${LOCAL_IMAGE_PATHS[i]}`, err)
    );
  }
}

// =========================================================================
// SETUP
// =========================================================================
function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  initDimensions();
  applyScreenDefaults();

  for (let i = 0; i < rawImages.length; i++) {
    let img = rawImages[i];
    if (img && img.width > 1) {
      addLoadedImage(img, `Foto ${i + 1}`);
    }
  }

  if (imagesList.length > 0) {
    seedCurrentToNext(0, imagesList.length > 1 ? 1 : 0);
  }

  if (currentSource === 'CAMARA') {
    initWebcam();
  }

  // Cargar video compartido desde IndexedDB si existe
  loadVideoFromDB((blob, name) => {
    loadCustomVideoBlob(blob, name);
  });

  // Cargar fotos compartidas desde IndexedDB si existen
  loadImagesFromDB((savedImages) => {
    applyUploadedImages(savedImages);
  });

  // Inicializar comunicación BroadcastChannel con la Consola Maestra
  initBroadcastListener();

  // Configurar barra interactiva de pantalla y estado
  setupScreenBarUI();

  // Soporte de Drag & Drop directo sobre la pantalla de salida
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      let file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/') || /\.(mp4|webm|ogv|m4v)$/i.test(file.name)) {
        let cleanName = file.name.replace(/\.[^/.]+$/, "");
        loadCustomVideoBlob(file, cleanName);
        saveVideoToDB(file, cleanName);
        setSourceMode('VIDEO');
      } else if (file.type.startsWith('image/')) {
        let files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        loadLocalFilesIntoOutput(files);
      }
    }
  });

  // Botón Fullscreen
  let btnFs = document.getElementById('btn-fs');
  if (btnFs) {
    btnFs.addEventListener('click', () => {
      let fs = fullscreen();
      fullscreen(!fs);
    });
  }
}

function initDimensions() {
  cols = floor(width / resolution);
  rows = floor(height / resolution);

  gridR = new Float32Array(cols * rows);
  nextR = new Float32Array(cols * rows);
  gridG = new Float32Array(cols * rows);
  nextG = new Float32Array(cols * rows);
  gridB = new Float32Array(cols * rows);
  nextB = new Float32Array(cols * rows);

  historyR = new Float32Array(cols * rows);
  historyG = new Float32Array(cols * rows);
  historyB = new Float32Array(cols * rows);

  caImage = createImage(cols, rows);

  if (cameraFeedGfx) cameraFeedGfx.remove();
  cameraFeedGfx = createGraphics(cols, rows);
  cameraFeedGfx.pixelDensity(1);
  cameraFeedData = {
    r: new Uint8Array(cols * rows),
    g: new Uint8Array(cols * rows),
    b: new Uint8Array(cols * rows)
  };

  if (videoFeedGfx) videoFeedGfx.remove();
  videoFeedGfx = createGraphics(cols, rows);
  videoFeedGfx.pixelDensity(1);
  videoFeedData = {
    r: new Uint8Array(cols * rows),
    g: new Uint8Array(cols * rows),
    b: new Uint8Array(cols * rows)
  };
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  let oldR = gridR, oldG = gridG, oldB = gridB;
  let oldCols = cols, oldRows = rows;

  initDimensions();

  if (imagesList.length > 0) {
    for (let item of imagesList) {
      item.data = resampleP5Image(item.sourceImg);
    }
  }

  let minC = min(oldCols, cols);
  let minR = min(oldRows, rows);
  for (let y = 0; y < minR; y++) {
    for (let x = 0; x < minC; x++) {
      let oldIdx = y * oldCols + x;
      let newIdx = y * cols + x;
      gridR[newIdx] = oldR[oldIdx];
      gridG[newIdx] = oldG[oldIdx];
      gridB[newIdx] = oldB[oldIdx];
    }
  }
}

let screenBarTimeout = null;
function setupScreenBarUI() {
  updatePillUI();

  // Escuchar clics en los botones de pantalla P1, P2, P3, P4
  document.querySelectorAll('.pill-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      let targetScreen = parseInt(btn.getAttribute('data-screen'));
      changeScreenChannel(targetScreen);
    });
  });

  // Mostrar la barra si se mueve el cursor cerca del borde superior
  window.addEventListener('mousemove', (e) => {
    if (e.clientY < 75) {
      showScreenBar();
    }
  });

  // Mostrar temporalmente al cargar
  showScreenBar();
}

function updatePillUI() {
  document.querySelectorAll('.pill-btn').forEach(btn => {
    let s = parseInt(btn.getAttribute('data-screen'));
    if (s === screenId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  let toast = document.getElementById('screen-status-toast');
  if (toast) {
    let sourceLabel = currentSource === 'IMAGENES' ? 'FOTOS' : currentSource;
    if (screenId === 0) {
      toast.textContent = `MODO AUTO (SIGUE A CONSOLA MASTER: ${sourceLabel}) · CONECTADA`;
    } else {
      toast.textContent = `PANTALLA TOUCH ${screenId} (${sourceLabel}) · CONECTADA`;
    }
    toast.classList.remove('fade-out');
    setTimeout(() => {
      toast.classList.add('fade-out');
    }, 3500);
  }
}

function showScreenBar() {
  let bar = document.getElementById('screen-bar');
  if (bar) {
    bar.classList.remove('fade-out');
    if (screenBarTimeout) clearTimeout(screenBarTimeout);
    screenBarTimeout = setTimeout(() => {
      bar.classList.add('fade-out');
    }, 4000);
  }
}

function changeScreenChannel(newId) {
  if (screenId === newId) return;
  screenId = newId;
  sessionStorage.setItem('krea_screen_id', screenId);
  try {
    let newUrl = window.location.pathname + '?screen=' + screenId;
    window.history.replaceState({ screen: screenId }, '', newUrl);
  } catch (e) {}

  applyScreenDefaults();
  updatePillUI();
  showScreenBar();

  if (vjChannel) {
    vjChannel.postMessage({
      type: 'SCREEN_ONLINE',
      screenId: screenId,
      timestamp: Date.now()
    });
  }
}

// =========================================================================
// SINCRONIZACIÓN EN TIEMPO REAL CON LA CONSOLA MAESTRA (BROADCASTCHANNEL)
// =========================================================================
let vjChannel = null;
function initBroadcastListener() {
  if (typeof BroadcastChannel === 'undefined') {
    console.warn("BroadcastChannel no soportado en este navegador.");
    return;
  }

  vjChannel = new BroadcastChannel('vj_multiscreen');

  vjChannel.onmessage = (event) => {
    let msg = event.data;
    if (!msg) return;

    if (msg.type === 'VIDEO_FILE_UPDATED') {
      loadVideoFromDB((blob, name) => {
        loadCustomVideoBlob(blob, name);
      });
      return;
    }

    if (msg.type === 'IMAGES_UPDATED') {
      if (msg.images && msg.images.length > 0) {
        applyUploadedImages(msg.images);
      } else {
        loadImagesFromDB((saved) => applyUploadedImages(saved));
      }
      return;
    }

    if (msg.type === 'RESET_GALLERY') {
      resetToBotanicalPhotos();
      return;
    }

    let target = parseInt(msg.targetChannel);
    if (isNaN(target)) target = 0;

    // Si screenId === 0 (Modo Auto / Seguir Master), aceptar todos los comandos
    // Si screenId es fijo (1..4), aceptar globales (target === 0) o específicos para este screenId
    if (screenId === 0 || target === 0 || target === screenId) {
      applyIncomingCommand(msg.action, msg.value);
    }
  };

  // Avisar a la consola que esta pantalla se conectó
  vjChannel.postMessage({
    type: 'SCREEN_ONLINE',
    screenId: screenId,
    timestamp: Date.now()
  });
}

function applyIncomingCommand(action, value) {
  switch (action) {
    case 'ACTIVE_CHANNEL':
      if (screenId === 0) {
        let ch = parseInt(value);
        if (!isNaN(ch) && ch >= 1 && ch <= 4) {
          let chName = ch === 1 ? 'FOTOS' : ch === 2 ? 'CÁMARA' : ch === 3 ? 'VIDEO' : 'FUSIÓN';
          let toast = document.getElementById('screen-status-toast');
          if (toast) {
            toast.textContent = `MODO AUTO · SIGUIENDO P${ch} (${chName})`;
            toast.classList.remove('fade-out');
            setTimeout(() => toast.classList.add('fade-out'), 2500);
          }
        }
      }
      break;
    case 'SOURCE':
      setSourceMode(value);
      break;
    case 'COLOR_MODE':
      currentModeIndex = value % COLOR_MODES.length;
      break;
    case 'TINT_ANGLE':
      tintAngle = value;
      break;
    case 'WAVE_DEFORM':
      waveDeformIntensity = value;
      break;
    case 'RED_LIGHT':
      isRedLightActive = !!value;
      break;
    case 'PAUSE':
      isPaused = !!value;
      break;
    case 'ZOOM':
      zoomFactor = value;
      break;
    case 'FUSION':
      fusionAmount = value;
      break;
    case 'TRAIL':
      decay = value;
      break;
    case 'SHUTTER':
      shutterTrail = constrain(parseFloat(value) || 0, 0, 0.98);
      break;
    case 'ASPECT':
      aspectFit = constrain(parseFloat(value) || 0, 0, 1.0);
      break;
    case 'BRUSH':
      brushRadius = value;
      break;
    case 'WARP':
      fluidWarpFactor = value;
      break;
    case 'GLITCH':
      glitchAmount = typeof value === 'boolean' ? (value ? 0.75 : 0.0) : constrain(parseFloat(value) || 0, 0, 1.0);
      isGlitchActive = glitchAmount > 0.01;
      break;
    case 'VINTAGE':
      isVintageActive = !!value;
      if (isVintageActive) {
        if (vintageDirt <= 0.01 && vintageTone <= 0.01) {
          vintageDirt = 0.60;
          vintageTone = 0.75;
        }
      } else {
        vintageDirt = 0.0;
        vintageTone = 0.0;
      }
      break;
    case 'VINTAGE_DIRT':
      vintageDirt = constrain(parseFloat(value) || 0, 0, 1.0);
      isVintageActive = vintageDirt > 0.01 || vintageTone > 0.01;
      break;
    case 'VINTAGE_TONE':
      vintageTone = constrain(parseFloat(value) || 0, 0, 1.0);
      isVintageActive = vintageDirt > 0.01 || vintageTone > 0.01;
      break;
    case 'TYPEWRITER':
      if (value && value.active && value.text) {
        typewriterText = value.text;
        typewriterDisplay = '';
        typewriterIndex = 0;
        typewriterActive = true;
        if (value.style) typewriterStyle = value.style;
      } else {
        typewriterActive = false;
        typewriterText = '';
        typewriterDisplay = '';
        typewriterIndex = 0;
      }
      break;
    case 'TYPEWRITER_STYLE':
      if (value) typewriterStyle = value;
      break;
    case 'FREEZE':
      isFreezeActive = !!value;
      break;
    case 'STROBE':
      isStrobeActive = !!value;
      break;
    case 'NEXT_PHOTO':
      triggerNextTransition();
      break;
    case 'PREV_PHOTO':
      triggerPrevTransition();
      break;
    case 'PHOTO_INDEX':
      if (value && typeof value.curr === 'number' && imagesList.length > 0) {
        currentIndex = value.curr % imagesList.length;
        nextIndex = (value.next !== undefined ? value.next : (currentIndex + 1)) % imagesList.length;
        seedCurrentToNext(currentIndex, nextIndex);
      }
      break;
    case 'SHOCKWAVE':
      if (value && typeof value.x === 'number') {
        injectShockwave(value.x, value.y, value.velocity || 100);
      }
      break;
  }
}

// =========================================================================
// BUCLE PRINCIPAL (DRAW)
// =========================================================================
function draw() {
  let dt = min(deltaTime / 1000, 0.1);
  waveDeformPhase += dt * 4.5;

  // Auto-recuperación de imágenes si setup() corrió antes de terminar la decodificación
  if (imagesList.length === 0 && !hasCustomImagesUploaded && rawImages.length > 0) {
    for (let i = 0; i < rawImages.length; i++) {
      let img = rawImages[i];
      if (img && img.width > 1) {
        let name = `Foto ${i + 1}`;
        let exists = imagesList.some(item => item.name === name);
        if (!exists) {
          addLoadedImage(img, name);
        }
      }
    }
    if (imagesList.length > 0) {
      seedCurrentToNext(0, imagesList.length > 1 ? 1 : 0);
    }
  }

  if (!isPaused && imagesList.length > 0 && currentSource === 'IMAGENES') {
    cycleTimer += dt;
    if (imagesList.length > 1) {
      if (cycleTimer >= cycleDuration) {
        cycleTimer = 0;
        currentIndex = nextIndex;
        nextIndex = (nextIndex + 1) % imagesList.length;
      }
    }
  }

  let progress = 0;
  if (currentSource === 'IMAGENES') {
    if (imagesList.length > 1) {
      progress = cycleTimer / cycleDuration;
    } else if (imagesList.length === 1) {
      progress = (sin(cycleTimer * 1.5) * 0.5 + 0.5) * 0.45;
    }
  } else if (currentSource === 'CAMARA') {
    if (cameraReady && videoCapture) {
      updateMediaFeedData(videoCapture, cameraFeedGfx, cameraFeedData);
    }
  } else if (currentSource === 'VIDEO') {
    if (videoReady && videoPlayer) {
      updateMediaFeedData(videoPlayer, videoFeedGfx, videoFeedData);
    }
  }

  // 1. Simulación numérica
  if (!isFreezeActive) {
    stepAutomata(progress);
  }

  // 2. Renderizado con shaders y deformación
  renderWithOrganicDisplacement(progress);

  // 3. Dibujo suave en pantalla con proporción de aspecto (Original 16:9 vs Llenar)
  smooth();
  background(0);

  let aFit = typeof aspectFit === 'number' ? aspectFit : 0.0;
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

  image(caImage, drawX, drawY, drawW, drawH);

  // 4. Superposición de texto tipo Máquina de Escribir (Intertítulo de Cine Mudo)
  drawTypewriterOverlay(drawX, drawY, drawW, drawH);

  // 5. Interacción Multi-Touch de la pantalla táctil
  handleMultiTouchInteraction(drawX, drawY, drawW, drawH);
}

// =========================================================================
// INTERACCIÓN MULTI-TOUCH Y MOUSE PARA PANTALLAS TÁCTILES PÚBLICAS
// =========================================================================
function handleMultiTouchInteraction(drawX = 0, drawY = 0, drawW = width, drawH = height) {
  let hasTouches = touches && touches.length > 0;
  let isTouching = false;
  let curX = mouseX, curY = mouseY;

  if (hasTouches) {
    isTouching = true;
    curX = touches[0].x;
    curY = touches[0].y;
    // El público puede interactuar con múltiples dedos a la vez
    for (let i = 0; i < touches.length; i++) {
      let t = touches[i];
      injectTouchAt(t.x, t.y, drawX, drawY, drawW, drawH);
    }
  } else if (mouseIsPressed && mouseX >= 0 && mouseX < width && mouseY >= 0 && mouseY < height) {
    isTouching = true;
    injectTouchAt(mouseX, mouseY, drawX, drawY, drawW, drawH);
  }

  if (isTouching) {
    if (!wasTouchingPrev) {
      prevTouchX = curX;
      prevTouchY = curY;
    }
    let speed = dist(curX, curY, prevTouchX, prevTouchY);
    let normX = constrain((curX - drawX) / drawW, 0, 1);
    if (vjChannel) {
      vjChannel.postMessage({
        type: 'AUDIO_MODULATE',
        active: true,
        normX: normX,
        speed: speed,
        timestamp: Date.now()
      });
    }
    prevTouchX = curX;
    prevTouchY = curY;
  } else if (wasTouchingPrev) {
    if (vjChannel) {
      vjChannel.postMessage({
        type: 'AUDIO_MODULATE',
        active: false,
        timestamp: Date.now()
      });
    }
  }

  wasTouchingPrev = isTouching;
}

function injectTouchAt(px, py, drawX = 0, drawY = 0, drawW = width, drawH = height) {
  let normX = (px - drawX) / drawW;
  let normY = (py - drawY) / drawH;
  if (normX < 0 || normX > 1 || normY < 0 || normY > 1) return;

  let gridX = floor(normX * cols);
  let gridY = floor(normY * rows);
  let r = floor(brushRadius / resolution);

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      let x = (gridX + dx + cols) % cols;
      let y = (gridY + dy + rows) % rows;
      let d = sqrt(dx * dx + dy * dy);

      if (d <= r) {
        let energy = (1 - d / r) * 260;
        let idx = y * cols + x;
        gridR[idx] += energy;
        gridG[idx] += energy * 0.85;
        gridB[idx] += energy * 1.25;
      }
    }
  }
}

function injectShockwave(gridX, gridY, velocity = 100) {
  let r = floor(map(velocity, 0, 127, 8, brushRadius * 1.6) / resolution);
  let power = map(velocity, 0, 127, 90, 520);

  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      let x = (gridX + dx + cols) % cols;
      let y = (gridY + dy + rows) % rows;
      let d = sqrt(dx * dx + dy * dy);
      if (d <= r) {
        let energy = (1 - d / r) * power;
        let idx = y * cols + x;
        gridR[idx] += energy;
        gridG[idx] += energy * 0.9;
        gridB[idx] += energy * 1.35;
      }
    }
  }
}

// =========================================================================
// MÁQUINA DE ESCRIBIR / MENSAJES EN PANTALLA (SIN REBORDE · RELLENO CEÑIDO)
// =========================================================================
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

function drawTypewriterOverlay(drawX, drawY, drawW, drawH) {
  if (!typewriterActive || !typewriterText) return;

  // Animar tecleo: 1 caracter cada 3 frames (~20 caracteres por segundo)
  if (frameCount % 3 === 0 && typewriterIndex < typewriterText.length) {
    typewriterIndex++;
    typewriterDisplay = typewriterText.substring(0, typewriterIndex);
  }

  let isTyping = typewriterIndex < typewriterText.length;
  let cursorChar = (frameCount % 28 < 14) ? '▌' : ' ';
  let fullText = typewriterDisplay + (isTyping || cursorChar === '▌' ? cursorChar : '');

  push();
  rectMode(CENTER);
  let cx = drawX + drawW * 0.5;
  let cy = drawY + drawH * 0.5;

  let tSize = constrain(floor(drawW * 0.032), 18, 44);
  let maxW = min(drawW * 0.86, 960);

  textFont('Courier New, Courier, monospace');
  textSize(tSize);
  textStyle(BOLD);

  // Relleno ajustado y angosto a la altura del texto (sin reborde)
  let padX = tSize * 0.45;
  let padY = tSize * 0.18;
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
  let styleMode = typewriterStyle || 'box-black';

  // 1. Recuadro ceñido según estilo (SIN REBORDE NI LÍNEAS EXTERIORES)
  noStroke();
  if (styleMode === 'box-black') {
    fill(5, 5, 8, 225);
    rect(cx, cy, boxW, boxH, 4);
    fill(255, 255, 255);
  } else if (styleMode === 'box-white') {
    fill(250, 250, 252, 235);
    rect(cx, cy, boxW, boxH, 4);
    fill(8, 8, 12);
  } else if (styleMode === 'clean-white') {
    // Sin recuadro: texto blanco limpio con sombra suave para legibilidad
    drawingContext.shadowColor = 'rgba(0, 0, 0, 0.90)';
    drawingContext.shadowBlur = 8;
    drawingContext.shadowOffsetX = 0;
    drawingContext.shadowOffsetY = 1;
    fill(255, 255, 255);
  } else if (styleMode === 'clean-black') {
    // Sin recuadro: texto negro limpio con halo suave para legibilidad
    drawingContext.shadowColor = 'rgba(255, 255, 255, 0.85)';
    drawingContext.shadowBlur = 7;
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

// =========================================================================
// SIMULACIÓN CELULAR NUMÉRICA
// =========================================================================
function stepAutomata(progress) {
  let currData, nextData;
  let morphWeight = 0;
  let injectStrength = 0.04;

  if (currentSource === 'CAMARA') {
    if (cameraFeedData && cameraReady) {
      currData = cameraFeedData;
      nextData = cameraFeedData;
      morphWeight = 0;
      injectStrength = 0.12;
    } else {
      currData = imagesList[currentIndex]?.data;
      nextData = imagesList[nextIndex]?.data;
    }
  } else if (currentSource === 'VIDEO') {
    if (videoFeedData && videoReady) {
      currData = videoFeedData;
      nextData = videoFeedData;
      morphWeight = 0;
      injectStrength = 0.12;
    } else {
      currData = imagesList[currentIndex]?.data;
      nextData = imagesList[nextIndex]?.data;
    }
  } else {
    currData = imagesList[currentIndex]?.data;
    nextData = imagesList[nextIndex]?.data;

    if (progress > 0.65) {
      morphWeight = map(progress, 0.65, 1.0, 0.0, 1.0, true);
      injectStrength = map(progress, 0.65, 1.0, 0.05, 0.20);
    } else if (progress < 0.20) {
      injectStrength = map(progress, 0.0, 0.20, 0.18, 0.04);
    }
  }

  let effectiveDecay = decay;
  if (currentSource === 'IMAGENES' && progress >= 0.35 && progress <= 0.70) {
    effectiveDecay = decay * 1.35;
  }

  if (glitchAmount > 0.01) {
    let numBursts = floor(map(glitchAmount, 0, 1, 10, 80));
    for (let k = 0; k < numBursts; k++) {
      let rIdx = floor(random(cols * rows));
      let pwr = random(120, 480) * glitchAmount;
      gridR[rIdx] += pwr;
      gridG[rIdx] += pwr;
      gridB[rIdx] += pwr;
    }
  }

  for (let y = 0; y < rows; y++) {
    let up = ((y - 1 + rows) % rows) * cols;
    let down = ((y + 1) % rows) * cols;
    let cur = y * cols;

    for (let x = 0; x < cols; x++) {
      let idx = cur + x;
      let left = (x - 1 + cols) % cols;
      let right = (x + 1) % cols;

      let n0 = up + left, n1 = up + x, n2 = up + right;
      let n3 = cur + left, n4 = cur + right;
      let n5 = down + left, n6 = down + x, n7 = down + right;

      let valR = ((gridR[n0] + gridR[n2] + gridR[n5] + gridR[n7]) * 0.095 +
                  (gridR[n1] + gridR[n3] + gridR[n4] + gridR[n6]) * 0.155) - effectiveDecay;

      let valG = ((gridG[n0] + gridG[n2] + gridG[n5] + gridG[n7]) * 0.095 +
                  (gridG[n1] + gridG[n3] + gridG[n4] + gridG[n6]) * 0.155) - effectiveDecay;

      let valB = ((gridB[n0] + gridB[n2] + gridB[n5] + gridB[n7]) * 0.095 +
                  (gridB[n1] + gridB[n3] + gridB[n4] + gridB[n6]) * 0.155) - effectiveDecay;

      if (currData && nextData && idx < currData.r.length && idx < nextData.r.length) {
        let srcR = lerp(currData.r[idx], nextData.r[idx], morphWeight);
        let srcG = lerp(currData.g[idx], nextData.g[idx], morphWeight);
        let srcB = lerp(currData.b[idx], nextData.b[idx], morphWeight);

        if (fusionAmount > 0.01 && imagesList.length > 0 && imagesList[currentIndex]?.data) {
          let fData = imagesList[currentIndex].data;
          if (idx < fData.r.length) {
            srcR = lerp(srcR, fData.r[idx], fusionAmount);
            srcG = lerp(srcG, fData.g[idx], fusionAmount);
            srcB = lerp(srcB, fData.b[idx], fusionAmount);
          }
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

  let tempR = gridR; gridR = nextR; nextR = tempR;
  let tempG = gridG; gridG = nextG; nextG = tempG;
  let tempB = gridB; gridB = nextB; nextB = tempB;
}

// =========================================================================
// RENDERIZADO CON DESPLAZAMIENTO ORGÁNICO
// =========================================================================
function renderWithOrganicDisplacement(progress) {
  caImage.loadPixels();
  let pix = caImage.pixels;

  let currData, nextData;
  let warpFactor = 0;
  let morphBlend = 0;

  if (currentSource === 'CAMARA') {
    currData = (cameraFeedData && cameraReady) ? cameraFeedData : imagesList[currentIndex]?.data;
    nextData = currData;
    warpFactor = 0.65;
    morphBlend = 0;
  } else if (currentSource === 'VIDEO') {
    currData = (videoFeedData && videoReady) ? videoFeedData : imagesList[currentIndex]?.data;
    nextData = currData;
    warpFactor = 0.65;
    morphBlend = 0;
  } else {
    currData = imagesList[currentIndex]?.data;
    nextData = imagesList[nextIndex]?.data;

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

  let totalWarp = (warpFactor * fluidWarpFactor) + pitchBendWarpOffset;
  let displacementScale = totalWarp * 0.045;
  let waveInfluence = fluidWarpFactor < 0.02 ? 0.0 : constrain(map(totalWarp, 0, 1, 0.08, 0.58), 0.0, 0.90);
  let invWave = 1.0 - waveInfluence;

  let mask1023 = LUT_SIZE - 1;

  currentZoomDisplay = lerp(currentZoomDisplay, zoomFactor, 0.14);
  let centerX = cols * 0.5;
  let centerY = rows * 0.5;
  let invZoom = 1.0 / currentZoomDisplay;

  let tintRad = tintAngle * 0.0174532925;
  let tr = (cos(tintRad) * 0.5 + 0.5);
  let tg = (cos(tintRad - 2.094395) * 0.5 + 0.5);
  let tb = (cos(tintRad - 4.18879) * 0.5 + 0.5);

  for (let y = 0; y < rows; y++) {
    let cur = y * cols;
    let up = ((y - 1 + rows) % rows) * cols;
    let down = ((y + 1) % rows) * cols;

    for (let x = 0; x < cols; x++) {
      let idx = cur + x;
      let pIdx = idx << 2;

      let left = (x - 1 + cols) % cols;
      let right = (x + 1) % cols;

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
      if (glitchAmount > 0.01) {
        let sliceFreq = floor(map(glitchAmount, 0, 1, 35, 12));
        let sliceId = (y + (frameCount * 7)) % sliceFreq;
        if (sliceId < floor(3 * glitchAmount + 1)) {
          sx += ((sin(y * 0.45 + frameCount * 1.5) * (18 * glitchAmount + 4)) | 0);
          glitchAberration = ((cos(y * 0.25) * (6 * glitchAmount + 1)) | 0);
        } else if (sliceId > floor(sliceFreq - 2 * glitchAmount - 1)) {
          sx -= ((cos(y * 0.3 + frameCount * 2) * (14 * glitchAmount + 2)) | 0);
        }
      }

      if (waveDeformIntensity > 0.001) {
        let waveX = sin(y * 0.075 + waveDeformPhase) * (waveDeformIntensity * 28.0) +
                    sin((x + y) * 0.045 + waveDeformPhase * 1.3) * (waveDeformIntensity * 12.0);
        let waveY = cos(x * 0.075 + waveDeformPhase * 0.85) * (waveDeformIntensity * 18.0);
        sx += waveX;
        sy += waveY;
      }

      let zx = centerX + (sx - centerX) * invZoom;
      let zy = centerY + (sy - centerY) * invZoom;
      let sampleX = zx < 0 ? 0 : (zx >= cols ? cols - 1 : (zx | 0));
      let sampleY = zy < 0 ? 0 : (zy >= rows ? rows - 1 : (zy | 0));
      let sampleIdx = sampleY * cols + sampleX;

      let photoR = 0, photoG = 0, photoB = 0;
      if (currData && nextData && sampleIdx < currData.r.length && sampleIdx < nextData.r.length) {
        let rA = currData.r[sampleIdx], gA = currData.g[sampleIdx], bA = currData.b[sampleIdx];
        let rB = nextData.r[sampleIdx], gB = nextData.g[sampleIdx], bB = nextData.b[sampleIdx];
        photoR = rA + (rB - rA) * morphBlend;
        photoG = gA + (gB - gA) * morphBlend;
        photoB = bA + (bB - bA) * morphBlend;

        if (fusionAmount > 0.01 && imagesList.length > 0 && imagesList[currentIndex]?.data) {
          let fData = imagesList[currentIndex].data;
          if (sampleIdx < fData.r.length) {
            let fR = fData.r[sampleIdx], fG = fData.g[sampleIdx], fB = fData.b[sampleIdx];
            photoR = photoR * (1.0 - fusionAmount) + fR * fusionAmount;
            photoG = photoG * (1.0 - fusionAmount) + fG * fusionAmount;
            photoB = photoB * (1.0 - fusionAmount) + fB * fusionAmount;
          }
        }

        if (glitchAberration !== 0) {
          let sXR = zx < 0 ? 0 : (zx >= cols ? cols - 1 : ((zx + glitchAberration) | 0));
          let sXB = zx < 0 ? 0 : (zx >= cols ? cols - 1 : ((zx - glitchAberration) | 0));
          let sIdxR = sampleY * cols + sXR;
          let sIdxB = sampleY * cols + sXB;
          if (sIdxR < currData.r.length) photoR = currData.r[sIdxR];
          if (sIdxB < currData.b.length) photoB = currData.b[sIdxB];
        }
      }

      let waveR = LUT_SMOOTH_FOLD[(gridR[idx] | 0) & mask1023];
      let waveG = LUT_SMOOTH_FOLD[(gridG[idx] | 0) & mask1023];
      let waveB = LUT_SMOOTH_FOLD[(gridB[idx] | 0) & mask1023];

      let finalR = photoR * invWave + waveR * waveInfluence;
      let finalG = photoG * invWave + waveG * waveInfluence;
      let finalB = photoB * invWave + waveB * waveInfluence;

      // Estela de Obturación / Motion Echo
      if (shutterTrail > 0.01 && historyR) {
        let decayFactor = shutterTrail;
        let prevR = historyR[idx] * decayFactor;
        let prevG = historyG[idx] * decayFactor;
        let prevB = historyB[idx] * decayFactor;
        finalR = Math.max(finalR, prevR);
        finalG = Math.max(finalG, prevG);
        finalB = Math.max(finalB, prevB);
      }
      if (historyR) {
        historyR[idx] = finalR;
        historyG[idx] = finalG;
        historyB[idx] = finalB;
      }

      if (isRedLightActive) {
        finalR = min(finalR * 1.55 + 50, 255);
        finalG = finalG * 0.42;
        finalB = finalB * 0.46;
      }

      if (isStrobeActive) {
        pix[pIdx + 0] = 255;
        pix[pIdx + 1] = 255;
        pix[pIdx + 2] = 255;
        pix[pIdx + 3] = 255;
      } else {
        let dirtAmt = typeof vintageDirt === 'number' ? vintageDirt : (isVintageActive ? 0.6 : 0.0);
        let toneAmt = typeof vintageTone === 'number' ? vintageTone : (isVintageActive ? 0.75 : 0.0);

        let tR = finalR, tG = finalG, tB = finalB;

        if (toneAmt > 0.001) {
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
        } else if (currentModeIndex === 0) {
          tR = finalR;
          tG = finalG;
          tB = finalB;
        } else if (currentModeIndex === 1) { // Mapa de Calor Térmico (FLIR)
          let lum = (finalR * 0.299 + finalG * 0.587 + finalB * 0.114) | 0;
          let lByte = lum < 0 ? 0 : (lum > 255 ? 255 : lum);
          tR = HEATMAP_LUT_R[lByte];
          tG = HEATMAP_LUT_G[lByte];
          tB = HEATMAP_LUT_B[lByte];
        } else if (currentModeIndex === 2) { // Neón Ciber
          let lum = finalR * 0.299 + finalG * 0.587 + finalB * 0.114;
          let t = lum * 0.0039215686;
          tR = sin(t * PI) * 255;
          tG = cos(t * HALF_PI) * 220 + 30;
          tB = sin(t * TWO_PI + HALF_PI) * 200 + 55;
        } else if (currentModeIndex === 3) { // B&N Fotocopia Xerox
          let lum = finalR * 0.299 + finalG * 0.587 + finalB * 0.114;
          let toner = lum + (((x * 29 + y * 53 + (frameCount & 3) * 11) & 31) - 15.5) * 1.85;
          let photoVal = toner > 142 ? 255 : (toner < 96 ? 0 : (toner - 96) * 5.54);
          tR = photoVal;
          tG = photoVal;
          tB = photoVal;
        } else if (currentModeIndex === 4) { // B&N Orgánico
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
        if (tintAngle > 0 && toneAmt < 0.01) {
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
          let s1 = (frameCount * 29) % cols;
          if (x === s1 && ((y + frameCount * 3) % 23 > 4)) {
            let boost = 95 * dirtAmt;
            tR += boost; tG += boost; tB += boost * 0.8;
          }

          // 4. Pelo errático curvado que cruza la ventana del proyector
          let hairWobble = (sin(y * 0.08 + frameCount * 0.3) * 4) | 0;
          let hairX = ((frameCount * 17 + 53 + hairWobble) % cols + cols) % cols;
          if ((x === hairX || x === hairX + 1) && ((y * 2 + frameCount * 2) % 31 > 6)) {
            let hairDark = 1.0 - (0.75 * dirtAmt);
            tR *= hairDark; tG *= hairDark; tB *= hairDark;
          }

          // 5. Rayón vertical oscuro fino
          if (dirtAmt > 0.35) {
            let s2 = (frameCount * 13 + 107) % cols;
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
  }

  caImage.updatePixels();
}

// =========================================================================
// FUENTES VJ (CÁMARA, VIDEO, FOTOS)
// =========================================================================
function setSourceMode(newMode) {
  currentSource = newMode;
  if (newMode === 'CAMARA' && !videoCapture) {
    initWebcam();
  } else if (newMode === 'VIDEO' && videoPlayer && videoReady) {
    videoPlayer.loop();
    videoPlayer.play();
  }
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
      console.warn(`Pantalla ${screenId}: Error deteniendo stream de cámara:`, err);
    }
    videoCapture = null;
    cameraReady = false;
    isCameraStarting = false;
  }
}

function initWebcam() {
  if (cameraReady || isCameraStarting) return;
  isCameraStarting = true;

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
      console.log(`Pantalla ${screenId}: Cámara web lista.`);
    });

    if (videoCapture && videoCapture.elt) {
      videoCapture.elt.muted = true;
      videoCapture.elt.setAttribute('playsinline', '');
      videoCapture.elt.setAttribute('autoplay', '');
    }

    videoCapture.size(320, 240);
    videoCapture.hide();
  } catch (err) {
    console.warn(`Pantalla ${screenId}: No se pudo iniciar la cámara:`, err);
    isCameraStarting = false;
    cameraReady = false;
  }
}

window.addEventListener('beforeunload', () => {
  stopWebcam();
});

function updateMediaFeedData(sourceMedia, gfx, dataObj) {
  if (!gfx || !dataObj) return;
  gfx.image(sourceMedia, 0, 0, cols, rows);
  gfx.loadPixels();
  let pix = gfx.pixels;
  let count = cols * rows;
  let r = dataObj.r, g = dataObj.g, b = dataObj.b;
  for (let i = 0; i < count; i++) {
    let p = i << 2;
    r[i] = pix[p];
    g[i] = pix[p + 1];
    b[i] = pix[p + 2];
  }
}

function loadCustomVideoBlob(blob, cleanName) {
  if (!blob) return;
  let blobUrl = URL.createObjectURL(blob);
  if (videoPlayer) {
    videoPlayer.stop();
    videoPlayer.remove();
  }

  videoPlayer = createVideo(blobUrl, () => {
    videoReady = true;
    videoName = cleanName || 'Video';
    videoPlayer.volume(0);
    videoPlayer.loop();
    videoPlayer.hide();
    console.log(`Pantalla ${screenId}: Video cargado y reproduciendo (${cleanName})`);
  });
}

function triggerNextTransition() {
  if (imagesList.length <= 1) return;
  currentIndex = nextIndex;
  nextIndex = (nextIndex + 1) % imagesList.length;
  seedCurrentToNext(currentIndex, nextIndex);
}

function triggerPrevTransition() {
  if (imagesList.length <= 1) return;
  nextIndex = currentIndex;
  currentIndex = (currentIndex - 1 + imagesList.length) % imagesList.length;
  seedCurrentToNext(currentIndex, nextIndex);
}

function seedCurrentToNext(curr, next) {
  currentIndex = curr;
  nextIndex = next;
  cycleTimer = 0;

  if (imagesList[curr]?.data) {
    let d = imagesList[curr].data;
    let maxLen = d.r ? d.r.length : 0;
    let total = cols * rows;
    for (let i = 0; i < total; i++) {
      let rVal = (i < maxLen) ? (d.r[i] || 0) : 0;
      let gVal = (i < maxLen) ? (d.g[i] || 0) : 0;
      let bVal = (i < maxLen) ? (d.b[i] || 0) : 0;
      gridR[i] = rVal * 2.6;
      gridG[i] = gVal * 2.6;
      gridB[i] = bVal * 2.6;
    }
  }
}

function addLoadedImage(p5Img, name) {
  imagesList.push({
    name: name,
    sourceImg: p5Img,
    data: resampleP5Image(p5Img)
  });
}

function resampleP5Image(p5Img) {
  let g = createGraphics(cols, rows);
  g.pixelDensity(1);
  g.background(0);

  let w = p5Img.width || (p5Img.elt ? p5Img.elt.width : 0) || 1;
  let h = p5Img.height || (p5Img.elt ? p5Img.elt.height : 0) || 1;
  let imgAspect = w / h;
  let canvasAspect = cols / rows;
  let drawW, drawH, drawX, drawY;

  let margin = 0.95;
  if (imgAspect > canvasAspect) {
    drawW = cols * margin;
    drawH = (cols / imgAspect) * margin;
  } else {
    drawH = rows * margin;
    drawW = (rows * imgAspect) * margin;
  }
  drawX = (cols - drawW) / 2;
  drawY = (rows - drawH) / 2;

  g.image(p5Img, drawX, drawY, drawW, drawH);
  g.loadPixels();

  let count = cols * rows;
  let rArr = new Uint8Array(count);
  let gArr = new Uint8Array(count);
  let bArr = new Uint8Array(count);
  let pix = g.pixels;

  for (let i = 0; i < count; i++) {
    let p = i << 2;
    rArr[i] = pix[p];
    gArr[i] = pix[p + 1];
    bArr[i] = pix[p + 2];
  }
  g.remove();
  return { r: rArr, g: gArr, b: bArr };
}

function resetToBotanicalPhotos() {
  imagesList = [];
  hasCustomImagesUploaded = false;
  for (let i = 0; i < rawImages.length; i++) {
    let img = rawImages[i];
    if (img && img.width > 1) {
      addLoadedImage(img, `Foto ${i + 1}`);
    }
  }
  if (imagesList.length === 0) {
    generateProceduralDefaults();
  }
  seedCurrentToNext(0, imagesList.length > 1 ? 1 : 0);
  let toast = document.getElementById('screen-status-toast');
  if (toast) {
    toast.textContent = "FOTOS BOTÁNICAS RESTAURADAS";
    toast.classList.remove('fade-out');
    setTimeout(() => toast.classList.add('fade-out'), 2500);
  }
}

function generateProceduralDefaults() {
  let g1 = createGraphics(cols, rows);
  g1.pixelDensity(1);
  g1.background(10, 15, 25);
  g1.translate(cols / 2, rows / 2);
  for (let i = 0; i < 16; i++) {
    g1.rotate(TWO_PI / 16);
    g1.stroke(255, 100, 180, 220);
    g1.noFill();
    g1.ellipse(0, 30, 40, 70);
  }
  addLoadedImage(g1, "Demo");
  g1.remove();
}
