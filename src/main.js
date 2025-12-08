import './style.css';
import { parseGLB } from './glb-parser.js';
import { downloadGLB, writeGLB } from './glb-writer.js';
import { DEFAULT_OPTIONS, generateLODChain, initOptimizer } from './optimizer.js';
import { analyzeTextures, formatBytes, processTextures } from './texture-utils.js';
import { DiffViewer, GLBViewer } from './viewer.js';

// Application state
let currentFile = null;
let currentArrayBuffer = null;
let parsedGLB = null;
let optimizedData = null;
let optimizedGLBData = null;
let lodChain = null;
let currentLODIndex = 0;

// Viewers
let originalViewer = null;
let optimizedViewer = null;
let diffViewer = null;

// DOM Elements
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileInfo = document.getElementById('file-info');
const fileName = document.getElementById('file-name');
const fileStats = document.getElementById('file-stats');
const compressBtn = document.getElementById('compress-btn');
const downloadBtn = document.getElementById('download-btn');
const progressContainer = document.getElementById('progress-container');
const progressFill = document.getElementById('progress-fill');
const progressText = document.getElementById('progress-text');
const resultsPanel = document.getElementById('results-panel');
const originalSize = document.getElementById('original-size');
const optimizedSize = document.getElementById('optimized-size');
const reductionBadge = document.getElementById('reduction-badge');
const resultsDetails = document.getElementById('results-details');
const viewerPanel = document.getElementById('viewer-panel');
const diffPanel = document.getElementById('diff-panel');
const diffMode = document.getElementById('diff-mode');
const texturePanel = document.getElementById('texture-panel');
const textureAnalysis = document.getElementById('texture-analysis');
const lodSelectorContainer = document.getElementById('lod-selector-container');
const lodSelector = document.getElementById('lod-selector');

// Initialize
async function init() {
    try {
        await initOptimizer();
        console.log('Meshoptimizer WASM initialized');
    } catch (err) {
        console.error('Failed to initialize optimizer:', err);
        alert('Failed to initialize WebAssembly. Please use a modern browser.');
    }

    setupEventListeners();
}

function setupEventListeners() {
    // File drop handling
    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleFile(files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    // Buttons
    compressBtn.addEventListener('click', compress);
    downloadBtn.addEventListener('click', download);

    // Diff mode
    diffMode.addEventListener('change', () => {
        if (diffViewer) {
            diffViewer.setMode(diffMode.value);
        }
    });

    // Window resize
    window.addEventListener('resize', () => {
        if (originalViewer) originalViewer.resize();
        if (optimizedViewer) optimizedViewer.resize();
        if (diffViewer) diffViewer.resize();
    });
}

async function handleFile(file) {
    if (!file.name.toLowerCase().endsWith('.glb') && !file.name.toLowerCase().endsWith('.gltf')) {
        alert('Please select a .glb or .gltf file');
        return;
    }

    currentFile = file;
    currentArrayBuffer = await file.arrayBuffer();

    try {
        parsedGLB = parseGLB(currentArrayBuffer);
        const stats = parsedGLB.getStats();

        // Update UI
        dropZone.classList.add('has-file');
        fileName.textContent = file.name;
        fileStats.innerHTML = `
            <div class="stat">
                <div class="stat-label">File Size</div>
                <div class="stat-value">${formatBytes(file.size)}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Meshes</div>
                <div class="stat-value">${stats.meshCount}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Vertices</div>
                <div class="stat-value">${stats.totalVertices.toLocaleString()}</div>
            </div>
            <div class="stat">
                <div class="stat-label">Triangles</div>
                <div class="stat-value">${stats.totalTriangles.toLocaleString()}</div>
            </div>
        `;
        fileInfo.classList.add('visible');
        compressBtn.disabled = false;

        // Analyze textures
        await analyzeAndDisplayTextures();

        // Reset results
        resultsPanel.classList.remove('visible');
        viewerPanel.classList.remove('visible');
        diffPanel.classList.remove('visible');
        downloadBtn.disabled = true;
        optimizedData = null;
        optimizedGLBData = null;
        lodChain = null;
    } catch (err) {
        console.error('Failed to parse GLB:', err);
        alert(`Failed to parse file: ${err.message}`);
    }
}

async function analyzeAndDisplayTextures() {
    texturePanel.classList.add('visible');
    textureAnalysis.innerHTML = '<p class="placeholder-text">Analyzing textures...</p>';

    try {
        const textures = await analyzeTextures(parsedGLB);

        if (textures.length === 0) {
            textureAnalysis.innerHTML = '<p class="placeholder-text">No embedded textures found</p>';
            return;
        }

        const totalSize = textures.reduce((sum, t) => sum + t.byteLength, 0);
        const totalPixels = textures.reduce((sum, t) => sum + t.pixels, 0);

        let html = `
            <div class="texture-summary">
                <div class="texture-summary-item">
                    <div class="label">Images</div>
                    <div class="value">${textures.length}</div>
                </div>
                <div class="texture-summary-item">
                    <div class="label">Total Size</div>
                    <div class="value">${formatBytes(totalSize)}</div>
                </div>
                <div class="texture-summary-item">
                    <div class="label">Total Pixels</div>
                    <div class="value">${(totalPixels / 1000000).toFixed(1)}M</div>
                </div>
            </div>
        `;

        for (const tex of textures) {
            html += `
                <div class="texture-item">
                    <div class="texture-item-header">
                        <span class="texture-item-name">${tex.name}</span>
                        <span class="texture-item-size">${formatBytes(tex.byteLength)}</span>
                    </div>
                    <div class="texture-item-details">
                        ${tex.width} x ${tex.height} (${tex.mimeType})
                    </div>
                    ${
                        tex.usage.length > 0
                            ? `
                        <div class="texture-item-usage">
                            ${tex.usage.map((u) => `<span class="texture-usage-tag">${u.type}</span>`).join('')}
                        </div>
                    `
                            : ''
                    }
                    ${tex.recommendations
                        .map(
                            (r) => `
                        <div class="texture-recommendation ${r.type}">${r.message}</div>
                    `,
                        )
                        .join('')}
                </div>
            `;
        }

        textureAnalysis.innerHTML = html;
    } catch (err) {
        console.error('Texture analysis failed:', err);
        textureAnalysis.innerHTML = '<p class="placeholder-text">Failed to analyze textures</p>';
    }
}

async function compress() {
    if (!parsedGLB) return;

    compressBtn.disabled = true;
    progressContainer.classList.add('visible');
    updateProgress(0, 'Initializing...');

    try {
        const lodError = parseFloat(document.getElementById('lod-error').value);
        const textureAware = document.getElementById('opt-texture-aware').checked;
        const importanceThreshold = parseFloat(document.getElementById('importance-threshold').value);
        const textureScale = parseFloat(document.getElementById('texture-scale').value);

        const options = {
            ...DEFAULT_OPTIONS,
            lodErrorThreshold: lodError,
            textureAware: textureAware,
            importanceThreshold: importanceThreshold,
        };

        updateProgress(10, 'Analyzing mesh...');
        await sleep(50);

        // Generate LOD chain
        updateProgress(20, textureAware ? 'Analyzing texture importance...' : 'Generating LODs...');
        lodChain = await generateLODChain(parsedGLB, [1.0, 0.9, 0.8, 0.7, 0.5, 0.25], options, currentArrayBuffer);

        updateProgress(60, 'Processing textures...');
        let processedImages = null;
        if (textureScale < 1.0) {
            processedImages = await processTextures(parsedGLB, textureScale);
        }

        updateProgress(80, 'Writing GLB...');

        // Use the first LOD (100%) as the default optimized output
        currentLODIndex = 0;
        optimizedData = lodChain[0].optimizedData;
        optimizedGLBData = writeGLB(optimizedData, options, processedImages);

        updateProgress(100, 'Complete!');

        // Show results
        showResults(processedImages);

        // Setup viewers
        await setupViewers();

        // Setup LOD selector
        setupLODSelector(options, processedImages);
    } catch (err) {
        console.error('Compression failed:', err);
        alert(`Compression failed: ${err.message}`);
    } finally {
        compressBtn.disabled = false;
        setTimeout(() => {
            progressContainer.classList.remove('visible');
        }, 1000);
    }
}

function setupLODSelector(options, processedImages) {
    lodSelectorContainer.style.display = 'flex';
    lodSelector.innerHTML = '';

    lodChain.forEach((lod, index) => {
        const btn = document.createElement('button');
        btn.textContent = lod.levelPercent;
        btn.classList.toggle('active', index === currentLODIndex);
        btn.addEventListener('click', async () => {
            currentLODIndex = index;

            // Update active button
            lodSelector.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');

            // Generate new GLB for this LOD
            optimizedData = lod.optimizedData;
            optimizedGLBData = writeGLB(optimizedData, options, processedImages);

            // Update results
            showResults(processedImages);

            // Reload viewers
            if (optimizedViewer) {
                await optimizedViewer.loadGLB(optimizedGLBData.slice(0));
            }
            if (diffViewer) {
                await diffViewer.loadModels(currentArrayBuffer, optimizedGLBData);
            }
        });
        lodSelector.appendChild(btn);
    });
}

function showResults(processedImages) {
    const originalBytes = currentFile.size;
    const optimizedBytes = optimizedGLBData.byteLength;
    const reduction = ((1 - optimizedBytes / originalBytes) * 100).toFixed(1);

    originalSize.textContent = formatBytes(originalBytes);
    optimizedSize.textContent = formatBytes(optimizedBytes);
    reductionBadge.textContent = `-${reduction}%`;

    let details = '<p><strong>Optimizations applied:</strong></p>';
    details += '<p>- Vertex deduplication</p>';
    details += '<p>- Vertex cache optimization</p>';
    details += '<p>- Position quantization (16-bit)</p>';
    details += '<p>- Normal quantization (8-bit)</p>';
    details += '<p>- UV quantization (16-bit)</p>';
    details += '<p>- Meshopt compression</p>';

    if (processedImages && processedImages.size > 0) {
        details += `<p>- Texture resizing (${processedImages.size} images)</p>`;
    }

    if (lodChain && currentLODIndex > 0) {
        const lod = lodChain[currentLODIndex];
        details += `<p>- Mesh simplification (${lod.triangleReduction} triangles removed)</p>`;
    }

    resultsDetails.innerHTML = details;
    resultsPanel.classList.add('visible');
    downloadBtn.disabled = false;
}

async function setupViewers() {
    viewerPanel.classList.add('visible');
    diffPanel.classList.add('visible');

    // Cleanup existing viewers
    if (originalViewer) originalViewer.dispose();
    if (optimizedViewer) optimizedViewer.dispose();
    if (diffViewer) diffViewer.dispose();

    // Create new viewers
    const originalCanvas = document.getElementById('viewer-original');
    const optimizedCanvas = document.getElementById('viewer-optimized');
    const diffCanvas = document.getElementById('viewer-diff');

    originalViewer = new GLBViewer(originalCanvas);
    optimizedViewer = new GLBViewer(optimizedCanvas);
    diffViewer = new DiffViewer(diffCanvas);

    // Load models
    await Promise.all([
        originalViewer.loadGLB(currentArrayBuffer.slice(0)),
        optimizedViewer.loadGLB(optimizedGLBData.slice(0)),
    ]);

    // Sync cameras
    originalViewer.syncCamera(optimizedViewer);
    optimizedViewer.syncCamera(originalViewer);

    // Load diff viewer
    await diffViewer.loadModels(currentArrayBuffer, optimizedGLBData);
    diffViewer.setMode(diffMode.value);
}

function download() {
    if (!optimizedGLBData) return;

    const baseName = currentFile.name.replace(/\.(glb|gltf)$/i, '');
    const lodSuffix = lodChain && currentLODIndex > 0 ? `_lod${currentLODIndex}` : '';
    const filename = `${baseName}_optimized${lodSuffix}.glb`;

    downloadGLB(optimizedGLBData, filename);
}

function updateProgress(percent, text) {
    progressFill.style.width = `${percent}%`;
    progressText.textContent = text;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// Start the application
init();
