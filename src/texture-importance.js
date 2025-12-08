/**
 * Texture Importance Analysis - Calculates per-vertex importance based on texture detail
 *
 * Uses Sobel edge detection to find high-detail areas in textures,
 * then maps importance back to mesh vertices via UV coordinates.
 */

/**
 * Texture type weights - normal maps weighted 2x per user decision
 */
const TEXTURE_WEIGHTS = {
    baseColor: 1.0,
    normal: 2.0,
    metallicRoughness: 0.5,
    occlusion: 0.3,
    emissive: 0.5
};

/**
 * Load image data into ImageData for pixel access
 * @param {Uint8Array} imageBytes - Raw image bytes
 * @param {string} mimeType - Image MIME type
 * @returns {Promise<{imageData: ImageData, width: number, height: number}>}
 */
async function loadImageData(imageBytes, mimeType) {
    return new Promise((resolve, reject) => {
        const blob = new Blob([imageBytes], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(url);

            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);

            const imageData = ctx.getImageData(0, 0, img.width, img.height);
            resolve({ imageData, width: img.width, height: img.height });
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };

        img.src = url;
    });
}

/**
 * Compute Sobel edge magnitude at a specific pixel
 */
function sobelMagnitude(data, width, height, x, y) {
    const Gx = [
        [-1, 0, 1],
        [-2, 0, 2],
        [-1, 0, 1]
    ];
    const Gy = [
        [-1, -2, -1],
        [ 0,  0,  0],
        [ 1,  2,  1]
    ];

    let sumGx = 0;
    let sumGy = 0;

    const getGray = (px, py) => {
        px = Math.max(0, Math.min(width - 1, px));
        py = Math.max(0, Math.min(height - 1, py));
        const idx = (py * width + px) * 4;
        return (data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114) / 255;
    };

    for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
            const gray = getGray(x + kx, y + ky);
            sumGx += gray * Gx[ky + 1][kx + 1];
            sumGy += gray * Gy[ky + 1][kx + 1];
        }
    }

    const magnitude = Math.sqrt(sumGx * sumGx + sumGy * sumGy);
    return Math.min(1.0, magnitude);
}

/**
 * Compute color variance in a neighborhood
 */
function colorVariance(data, width, height, x, y, radius = 2) {
    const samples = [];

    for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
            const px = Math.max(0, Math.min(width - 1, x + dx));
            const py = Math.max(0, Math.min(height - 1, y + dy));
            const idx = (py * width + px) * 4;

            const r = data[idx] / 255;
            const g = data[idx + 1] / 255;
            const b = data[idx + 2] / 255;
            samples.push({ r, g, b });
        }
    }

    const n = samples.length;
    const meanR = samples.reduce((s, p) => s + p.r, 0) / n;
    const meanG = samples.reduce((s, p) => s + p.g, 0) / n;
    const meanB = samples.reduce((s, p) => s + p.b, 0) / n;

    const varR = samples.reduce((s, p) => s + (p.r - meanR) ** 2, 0) / n;
    const varG = samples.reduce((s, p) => s + (p.g - meanG) ** 2, 0) / n;
    const varB = samples.reduce((s, p) => s + (p.b - meanB) ** 2, 0) / n;

    const totalVar = (varR + varG + varB) / 3;
    return Math.min(1.0, totalVar * 4);
}

/**
 * Build an importance map for a texture
 */
function buildImportanceMap(imageData, width, height) {
    const importance = new Float32Array(width * height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const idx = y * width + x;
            const edge = sobelMagnitude(data, width, height, x, y);
            const variance = colorVariance(data, width, height, x, y);
            importance[idx] = edge * 0.6 + variance * 0.4;
        }
    }

    return importance;
}

/**
 * Sample importance at a UV coordinate using bilinear interpolation
 */
function sampleImportance(importanceMap, width, height, u, v) {
    u = u - Math.floor(u);
    v = v - Math.floor(v);
    v = 1.0 - v;

    const px = u * (width - 1);
    const py = v * (height - 1);

    const x0 = Math.floor(px);
    const y0 = Math.floor(py);
    const x1 = Math.min(x0 + 1, width - 1);
    const y1 = Math.min(y0 + 1, height - 1);

    const fx = px - x0;
    const fy = py - y0;

    const v00 = importanceMap[y0 * width + x0];
    const v10 = importanceMap[y0 * width + x1];
    const v01 = importanceMap[y1 * width + x0];
    const v11 = importanceMap[y1 * width + x1];

    const top = v00 * (1 - fx) + v10 * fx;
    const bottom = v01 * (1 - fx) + v11 * fx;

    return top * (1 - fy) + bottom * fy;
}

/**
 * Analyze texture importance and return per-vertex importance values
 */
export async function analyzeTextureImportance(primitive, parsedGLB, textureCache = {}) {
    const { json, binChunk } = parsedGLB;

    const posAttr = primitive.attributes.POSITION;
    if (!posAttr) {
        return null;
    }

    const vertexCount = posAttr.data.length / 3;
    const importance = new Float32Array(vertexCount);

    const uvAttr = primitive.attributes.TEXCOORD_0;
    if (!uvAttr) {
        console.log('No UVs found, cannot compute texture importance');
        return null;
    }

    const uvs = new Float32Array(uvAttr.data);

    if (primitive.material === undefined || !json.materials) {
        return null;
    }

    const material = json.materials[primitive.material];
    if (!material) {
        return null;
    }

    const textureInfos = [];

    if (material.pbrMetallicRoughness) {
        const pbr = material.pbrMetallicRoughness;
        if (pbr.baseColorTexture) {
            textureInfos.push({
                textureIndex: pbr.baseColorTexture.index,
                type: 'baseColor',
                weight: TEXTURE_WEIGHTS.baseColor
            });
        }
        if (pbr.metallicRoughnessTexture) {
            textureInfos.push({
                textureIndex: pbr.metallicRoughnessTexture.index,
                type: 'metallicRoughness',
                weight: TEXTURE_WEIGHTS.metallicRoughness
            });
        }
    }

    if (material.normalTexture) {
        textureInfos.push({
            textureIndex: material.normalTexture.index,
            type: 'normal',
            weight: TEXTURE_WEIGHTS.normal
        });
    }

    if (material.occlusionTexture) {
        textureInfos.push({
            textureIndex: material.occlusionTexture.index,
            type: 'occlusion',
            weight: TEXTURE_WEIGHTS.occlusion
        });
    }

    if (material.emissiveTexture) {
        textureInfos.push({
            textureIndex: material.emissiveTexture.index,
            type: 'emissive',
            weight: TEXTURE_WEIGHTS.emissive
        });
    }

    if (textureInfos.length === 0) {
        console.log('No textures on material');
        return null;
    }

    let totalWeight = 0;

    for (const texInfo of textureInfos) {
        const texture = json.textures[texInfo.textureIndex];
        if (!texture || texture.source === undefined) continue;

        const imageIndex = texture.source;
        const image = json.images[imageIndex];
        if (!image) continue;

        let loaded = textureCache[imageIndex];

        if (!loaded) {
            let imageBytes = null;
            let mimeType = image.mimeType || 'image/png';

            if (image.bufferView !== undefined) {
                const bufferView = json.bufferViews[image.bufferView];
                const byteOffset = bufferView.byteOffset || 0;
                const byteLength = bufferView.byteLength;
                imageBytes = new Uint8Array(binChunk, byteOffset, byteLength);
            }

            if (!imageBytes) continue;

            try {
                loaded = await loadImageData(imageBytes, mimeType);
                loaded.importanceMap = buildImportanceMap(
                    loaded.imageData,
                    loaded.width,
                    loaded.height
                );
                textureCache[imageIndex] = loaded;
            } catch (err) {
                console.warn(`Failed to load image ${imageIndex}:`, err);
                continue;
            }
        }

        for (let v = 0; v < vertexCount; v++) {
            const u = uvs[v * 2];
            const vCoord = uvs[v * 2 + 1];

            const texImportance = sampleImportance(
                loaded.importanceMap,
                loaded.width,
                loaded.height,
                u,
                vCoord
            );

            importance[v] += texImportance * texInfo.weight;
        }

        totalWeight += texInfo.weight;
    }

    if (totalWeight > 0) {
        for (let v = 0; v < vertexCount; v++) {
            importance[v] /= totalWeight;
        }
    }

    let maxImportance = 0;
    let minImportance = Infinity;
    let sumImportance = 0;
    for (let v = 0; v < vertexCount; v++) {
        maxImportance = Math.max(maxImportance, importance[v]);
        minImportance = Math.min(minImportance, importance[v]);
        sumImportance += importance[v];
    }
    const avgImportance = sumImportance / vertexCount;

    if (maxImportance > 0) {
        for (let v = 0; v < vertexCount; v++) {
            importance[v] /= maxImportance;
        }
    }

    let above30 = 0, above50 = 0, above70 = 0;
    for (let v = 0; v < vertexCount; v++) {
        if (importance[v] > 0.3) above30++;
        if (importance[v] > 0.5) above50++;
        if (importance[v] > 0.7) above70++;
    }

    console.log(`Texture importance stats: min=${minImportance.toFixed(4)}, max=${maxImportance.toFixed(4)}, avg=${avgImportance.toFixed(4)}`);
    console.log(`Vertices above threshold: >0.3: ${above30}/${vertexCount}, >0.5: ${above50}/${vertexCount}, >0.7: ${above70}/${vertexCount}`);

    return importance;
}

/**
 * Find UV seams - vertices where same position has different UVs
 */
export function findUVSeams(positions, uvs, positionPrecision = 4) {
    if (!uvs) return new Set();

    const vertexCount = positions.length / 3;
    const positionToUVs = new Map();
    const factor = Math.pow(10, positionPrecision);

    for (let v = 0; v < vertexCount; v++) {
        const px = Math.round(positions[v * 3] * factor);
        const py = Math.round(positions[v * 3 + 1] * factor);
        const pz = Math.round(positions[v * 3 + 2] * factor);
        const posKey = `${px},${py},${pz}`;

        if (!positionToUVs.has(posKey)) {
            positionToUVs.set(posKey, []);
        }

        positionToUVs.get(posKey).push({
            vertexIndex: v,
            u: uvs[v * 2],
            v: uvs[v * 2 + 1]
        });
    }

    const seamVertices = new Set();
    const uvPrecision = 1000;

    for (const [posKey, vertices] of positionToUVs) {
        if (vertices.length <= 1) continue;

        const firstU = Math.round(vertices[0].u * uvPrecision);
        const firstV = Math.round(vertices[0].v * uvPrecision);

        let hasSeam = false;
        for (let i = 1; i < vertices.length; i++) {
            const u = Math.round(vertices[i].u * uvPrecision);
            const v = Math.round(vertices[i].v * uvPrecision);

            if (u !== firstU || v !== firstV) {
                hasSeam = true;
                break;
            }
        }

        if (hasSeam) {
            for (const vert of vertices) {
                seamVertices.add(vert.vertexIndex);
            }
        }
    }

    return seamVertices;
}

/**
 * Build vertex lock array for simplification
 */
export function buildVertexLock(importance, seamVertices, importanceThreshold = 0.7) {
    const vertexCount = importance ? importance.length : 0;
    const lock = new Uint8Array(vertexCount);

    const seamThreshold = importanceThreshold * 0.5;

    for (let v = 0; v < vertexCount; v++) {
        const vertexImportance = importance ? importance[v] : 0;

        if (seamVertices.has(v)) {
            if (vertexImportance > seamThreshold) {
                lock[v] = 1;
            }
        } else {
            if (vertexImportance > importanceThreshold) {
                lock[v] = 1;
            }
        }
    }

    return lock;
}
