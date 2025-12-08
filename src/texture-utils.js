/**
 * Texture Utilities - Analysis and resizing for GLB textures
 */

/**
 * Extract texture information from parsed GLB
 * @param {Object} parsedGLB - Output from parseGLB
 * @returns {Promise<Object[]>} Array of texture info objects
 */
export async function analyzeTextures(parsedGLB) {
    const { json, binChunk } = parsedGLB;
    const textures = [];

    if (!json.images) return textures;

    for (let i = 0; i < json.images.length; i++) {
        const image = json.images[i];
        let imageData = null;
        let mimeType = image.mimeType || 'image/png';

        if (image.bufferView !== undefined) {
            // Embedded image
            const bufferView = json.bufferViews[image.bufferView];
            const byteOffset = bufferView.byteOffset || 0;
            const byteLength = bufferView.byteLength;
            imageData = new Uint8Array(binChunk, byteOffset, byteLength);
        } else if (image.uri?.startsWith('data:')) {
            // Base64 embedded
            const match = image.uri.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
                mimeType = match[1];
                const base64 = match[2];
                const binary = atob(base64);
                imageData = new Uint8Array(binary.length);
                for (let j = 0; j < binary.length; j++) {
                    imageData[j] = binary.charCodeAt(j);
                }
            }
        }

        if (imageData) {
            // Decode image to get dimensions
            const dimensions = await getImageDimensions(imageData, mimeType);

            // Find which textures/materials use this image
            const usage = findImageUsage(json, i);

            textures.push({
                index: i,
                name: image.name || `Image ${i}`,
                mimeType,
                byteLength: imageData.byteLength,
                width: dimensions.width,
                height: dimensions.height,
                pixels: dimensions.width * dimensions.height,
                usage,
                recommendations: generateRecommendations(dimensions, imageData.byteLength, usage),
            });
        }
    }

    return textures;
}

/**
 * Get image dimensions by decoding the image
 */
async function getImageDimensions(imageData, mimeType) {
    return new Promise((resolve) => {
        const blob = new Blob([imageData], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(url);
            resolve({ width: img.width, height: img.height });
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            resolve({ width: 0, height: 0 });
        };

        img.src = url;
    });
}

/**
 * Find how an image is used (base color, normal map, etc.)
 */
function findImageUsage(json, imageIndex) {
    const usage = [];

    if (!json.textures || !json.materials) return usage;

    // Find which textures reference this image
    const textureIndices = [];
    for (let t = 0; t < json.textures.length; t++) {
        if (json.textures[t].source === imageIndex) {
            textureIndices.push(t);
        }
    }

    // Find which materials use these textures
    for (const material of json.materials) {
        const matName = material.name || 'Unnamed Material';

        if (material.pbrMetallicRoughness) {
            const pbr = material.pbrMetallicRoughness;
            if (pbr.baseColorTexture && textureIndices.includes(pbr.baseColorTexture.index)) {
                usage.push({ type: 'baseColor', material: matName });
            }
            if (pbr.metallicRoughnessTexture && textureIndices.includes(pbr.metallicRoughnessTexture.index)) {
                usage.push({ type: 'metallicRoughness', material: matName });
            }
        }

        if (material.normalTexture && textureIndices.includes(material.normalTexture.index)) {
            usage.push({ type: 'normal', material: matName });
        }

        if (material.occlusionTexture && textureIndices.includes(material.occlusionTexture.index)) {
            usage.push({ type: 'occlusion', material: matName });
        }

        if (material.emissiveTexture && textureIndices.includes(material.emissiveTexture.index)) {
            usage.push({ type: 'emissive', material: matName });
        }
    }

    return usage;
}

/**
 * Generate recommendations for a texture
 */
function generateRecommendations(dimensions, byteLength, usage) {
    const recommendations = [];
    const { width, height } = dimensions;

    // Check for non-power-of-two
    const isPOT = (n) => n > 0 && (n & (n - 1)) === 0;
    if (!isPOT(width) || !isPOT(height)) {
        recommendations.push({
            type: 'warning',
            message: `Non-power-of-two (${width}x${height}). May cause issues on some platforms.`,
        });
    }

    // Check for oversized textures
    if (width > 2048 || height > 2048) {
        recommendations.push({
            type: 'suggestion',
            message: `Large texture (${width}x${height}). Consider reducing for better performance.`,
        });
    }

    // Check for potentially oversized based on usage
    const isNormalOrORM = usage.some(
        (u) => u.type === 'normal' || u.type === 'metallicRoughness' || u.type === 'occlusion',
    );
    if (isNormalOrORM && (width > 1024 || height > 1024)) {
        recommendations.push({
            type: 'suggestion',
            message: `Detail map at ${width}x${height}. Often 512-1024 is sufficient.`,
        });
    }

    // Check file size vs dimensions (detect poor compression)
    const expectedSize = width * height * 3; // Rough uncompressed RGB
    const compressionRatio = expectedSize / byteLength;
    if (compressionRatio < 3 && byteLength > 100000) {
        recommendations.push({
            type: 'info',
            message: `Low compression ratio. May benefit from optimization.`,
        });
    }

    return recommendations;
}

/**
 * Resize an image to a target scale
 * @param {Uint8Array} imageData - Original image bytes
 * @param {string} mimeType - Image MIME type
 * @param {number} scale - Scale factor (0.5 = half size)
 * @returns {Promise<{data: Uint8Array, width: number, height: number}>}
 */
export async function resizeImage(imageData, mimeType, scale) {
    if (scale >= 1) {
        const dims = await getImageDimensions(imageData, mimeType);
        return { data: imageData, width: dims.width, height: dims.height };
    }

    return new Promise((resolve, reject) => {
        const blob = new Blob([imageData], { type: mimeType });
        const url = URL.createObjectURL(blob);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(url);

            const newWidth = Math.max(1, Math.floor(img.width * scale));
            const newHeight = Math.max(1, Math.floor(img.height * scale));

            // Create canvas and draw scaled image
            const canvas = document.createElement('canvas');
            canvas.width = newWidth;
            canvas.height = newHeight;

            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, newWidth, newHeight);

            // Export as same format (or JPEG for better compression)
            const outputType = mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
            const quality = mimeType === 'image/jpeg' ? 0.9 : undefined;

            canvas.toBlob(
                (blob) => {
                    if (!blob) {
                        reject(new Error('Failed to encode resized image'));
                        return;
                    }

                    const reader = new FileReader();
                    reader.onload = () => {
                        resolve({
                            data: new Uint8Array(reader.result),
                            width: newWidth,
                            height: newHeight,
                        });
                    };
                    reader.onerror = reject;
                    reader.readAsArrayBuffer(blob);
                },
                outputType,
                quality,
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error('Failed to load image for resizing'));
        };

        img.src = url;
    });
}

/**
 * Process all images in a GLB with optional resizing
 * @param {Object} parsedGLB - Output from parseGLB
 * @param {number} scale - Scale factor (1.0 = original, 0.5 = half)
 * @returns {Promise<Map<number, Uint8Array>>} Map of image index to new image data
 */
export async function processTextures(parsedGLB, scale = 1.0) {
    const { json, binChunk } = parsedGLB;
    const processedImages = new Map();

    if (!json.images || scale >= 1.0) return processedImages;

    for (let i = 0; i < json.images.length; i++) {
        const image = json.images[i];
        let imageData = null;
        const mimeType = image.mimeType || 'image/png';

        if (image.bufferView !== undefined) {
            const bufferView = json.bufferViews[image.bufferView];
            const byteOffset = bufferView.byteOffset || 0;
            const byteLength = bufferView.byteLength;
            imageData = new Uint8Array(binChunk, byteOffset, byteLength);
        }

        if (imageData) {
            try {
                const resized = await resizeImage(imageData, mimeType, scale);
                processedImages.set(i, resized.data);
            } catch (err) {
                console.warn(`Failed to resize image ${i}:`, err);
            }
        }
    }

    return processedImages;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
