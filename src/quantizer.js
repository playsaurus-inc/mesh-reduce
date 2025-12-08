/**
 * Quantizer - Handles quantization of vertex attributes
 *
 * Supports:
 * - Position quantization: Float32 → Int16 (2 bytes) or Int8 (1 byte)
 * - Normal quantization: Float32 VEC3 → Int8 VEC3 normalized
 * - UV quantization: Float32 → Uint16 normalized
 * - Tangent quantization: Float32 VEC4 → Int8 VEC4 normalized
 */

import { GL } from './glb-parser.js';

/**
 * Quantize positions from Float32 to Int16 or Int8
 * Uses bounding box normalization for lossless-ish compression
 *
 * @param {Float32Array} positions - Input positions (x,y,z triplets)
 * @param {number} bits - Bit depth (16 or 8)
 * @returns {Object} { quantized, min, max, scale, componentType }
 */
export function quantizePositions(positions, bits = 16) {
    const count = positions.length / 3;
    const use8Bit = bits === 8;
    const maxValue = use8Bit ? 127 : 32767;
    const ArrayType = use8Bit ? Int8Array : Int16Array;
    const componentType = use8Bit ? GL.BYTE : GL.SHORT;

    // Find bounding box
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (let i = 0; i < count; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];

        min[0] = Math.min(min[0], x);
        min[1] = Math.min(min[1], y);
        min[2] = Math.min(min[2], z);
        max[0] = Math.max(max[0], x);
        max[1] = Math.max(max[1], y);
        max[2] = Math.max(max[2], z);
    }

    // Calculate scale (range / maxValue)
    // We map [min, max] to [-maxValue, maxValue]
    const range = [
        max[0] - min[0],
        max[1] - min[1],
        max[2] - min[2]
    ];

    // Avoid division by zero for flat dimensions
    const scale = [
        range[0] > 0 ? range[0] / (2 * maxValue) : 1,
        range[1] > 0 ? range[1] / (2 * maxValue) : 1,
        range[2] > 0 ? range[2] / (2 * maxValue) : 1
    ];

    // Center point for translation
    const center = [
        (min[0] + max[0]) / 2,
        (min[1] + max[1]) / 2,
        (min[2] + max[2]) / 2
    ];

    // Quantize
    const quantized = new ArrayType(positions.length);

    for (let i = 0; i < count; i++) {
        const x = positions[i * 3];
        const y = positions[i * 3 + 1];
        const z = positions[i * 3 + 2];

        // Normalize to [-maxValue, maxValue] range
        quantized[i * 3] = Math.round((x - center[0]) / scale[0]);
        quantized[i * 3 + 1] = Math.round((y - center[1]) / scale[1]);
        quantized[i * 3 + 2] = Math.round((z - center[2]) / scale[2]);

        // Clamp to valid range
        quantized[i * 3] = Math.max(-maxValue, Math.min(maxValue, quantized[i * 3]));
        quantized[i * 3 + 1] = Math.max(-maxValue, Math.min(maxValue, quantized[i * 3 + 1]));
        quantized[i * 3 + 2] = Math.max(-maxValue, Math.min(maxValue, quantized[i * 3 + 2]));
    }

    // For glTF, we need to provide the transform that converts quantized back to original
    // The formula is: original = quantized * scale + center
    // In glTF terms: original = quantized * scale + translation

    return {
        quantized,
        min,
        max,
        scale,
        center,
        componentType,
        // For accessor min/max (in quantized space)
        quantizedMin: [-maxValue, -maxValue, -maxValue],
        quantizedMax: [maxValue, maxValue, maxValue]
    };
}

/**
 * Quantize normals from Float32 VEC3 to Int8 VEC3 normalized
 * KHR_mesh_quantization compatible - keeps VEC3 format
 *
 * @param {Float32Array} normals - Input normals (x,y,z triplets, should be normalized)
 * @returns {Object} { quantized: Int8Array (VEC3), componentType, normalized }
 */
export function quantizeNormals(normals) {
    const count = normals.length / 3;
    const quantized = new Int8Array(count * 3);

    for (let i = 0; i < count; i++) {
        let nx = normals[i * 3];
        let ny = normals[i * 3 + 1];
        let nz = normals[i * 3 + 2];

        // Normalize if needed (normals should already be unit length)
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0) {
            nx /= len;
            ny /= len;
            nz /= len;
        }

        // Quantize to [-127, 127] (normalized byte)
        quantized[i * 3] = Math.round(nx * 127);
        quantized[i * 3 + 1] = Math.round(ny * 127);
        quantized[i * 3 + 2] = Math.round(nz * 127);
    }

    return {
        quantized,
        componentType: GL.BYTE,
        type: 'VEC3',
        normalized: true
    };
}

/**
 * Quantize normals using octahedral encoding (optional, more aggressive)
 * Note: This produces VEC2 output which requires shader support
 * Not used by default for KHR_mesh_quantization compatibility
 *
 * @param {Float32Array} normals - Input normals (x,y,z triplets)
 * @returns {Object} { quantized: Int8Array (VEC2), componentType, normalized }
 */
export function quantizeNormalsOctahedral(normals) {
    const count = normals.length / 3;
    const quantized = new Int8Array(count * 2);

    for (let i = 0; i < count; i++) {
        let nx = normals[i * 3];
        let ny = normals[i * 3 + 1];
        let nz = normals[i * 3 + 2];

        // Normalize
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 0) {
            nx /= len;
            ny /= len;
            nz /= len;
        }

        // Octahedral encoding
        const absSum = Math.abs(nx) + Math.abs(ny) + Math.abs(nz);
        let ox = nx / absSum;
        let oy = ny / absSum;

        if (nz < 0) {
            const oldOx = ox;
            ox = (1 - Math.abs(oy)) * (ox >= 0 ? 1 : -1);
            oy = (1 - Math.abs(oldOx)) * (oy >= 0 ? 1 : -1);
        }

        quantized[i * 2] = Math.round(ox * 127);
        quantized[i * 2 + 1] = Math.round(oy * 127);
    }

    return {
        quantized,
        componentType: GL.BYTE,
        type: 'VEC2',
        normalized: true
    };
}

/**
 * Quantize texture coordinates from Float32 to Uint16 normalized
 *
 * @param {Float32Array} uvs - Input UVs (u,v pairs)
 * @returns {Object} { quantized: Uint16Array, componentType, normalized }
 */
export function quantizeUVs(uvs) {
    const count = uvs.length / 2;
    const quantized = new Uint16Array(uvs.length);

    // Find UV range
    let minU = Infinity, maxU = -Infinity;
    let minV = Infinity, maxV = -Infinity;

    for (let i = 0; i < count; i++) {
        const u = uvs[i * 2];
        const v = uvs[i * 2 + 1];
        minU = Math.min(minU, u);
        maxU = Math.max(maxU, u);
        minV = Math.min(minV, v);
        maxV = Math.max(maxV, v);
    }

    // Check if UVs are in [0,1] range (common case)
    const inStandardRange = minU >= 0 && maxU <= 1 && minV >= 0 && maxV <= 1;

    if (inStandardRange) {
        // Simple case: direct mapping to [0, 65535]
        for (let i = 0; i < count; i++) {
            quantized[i * 2] = Math.round(uvs[i * 2] * 65535);
            quantized[i * 2 + 1] = Math.round(uvs[i * 2 + 1] * 65535);
        }

        return {
            quantized,
            componentType: GL.UNSIGNED_SHORT,
            type: 'VEC2',
            normalized: true,
            min: [0, 0],
            max: [1, 1]
        };
    }

    // Extended range: need to normalize
    const rangeU = maxU - minU || 1;
    const rangeV = maxV - minV || 1;

    for (let i = 0; i < count; i++) {
        const u = (uvs[i * 2] - minU) / rangeU;
        const v = (uvs[i * 2 + 1] - minV) / rangeV;
        quantized[i * 2] = Math.round(u * 65535);
        quantized[i * 2 + 1] = Math.round(v * 65535);
    }

    return {
        quantized,
        componentType: GL.UNSIGNED_SHORT,
        type: 'VEC2',
        normalized: true,
        min: [minU, minV],
        max: [maxU, maxV],
        // These are needed to reconstruct original UVs
        offset: [minU, minV],
        scale: [rangeU, rangeV]
    };
}

/**
 * Quantize tangents from Float32 VEC4 to Int8 VEC4 normalized
 *
 * @param {Float32Array} tangents - Input tangents (x,y,z,w quads)
 * @returns {Object} { quantized: Int8Array, componentType, normalized }
 */
export function quantizeTangents(tangents) {
    const count = tangents.length / 4;
    const quantized = new Int8Array(tangents.length);

    for (let i = 0; i < count; i++) {
        let tx = tangents[i * 4];
        let ty = tangents[i * 4 + 1];
        let tz = tangents[i * 4 + 2];
        const tw = tangents[i * 4 + 3]; // Handedness, should be ±1

        // Normalize xyz
        const len = Math.sqrt(tx * tx + ty * ty + tz * tz);
        if (len > 0) {
            tx /= len;
            ty /= len;
            tz /= len;
        }

        // Quantize to [-127, 127]
        quantized[i * 4] = Math.round(tx * 127);
        quantized[i * 4 + 1] = Math.round(ty * 127);
        quantized[i * 4 + 2] = Math.round(tz * 127);
        quantized[i * 4 + 3] = tw >= 0 ? 127 : -127;
    }

    return {
        quantized,
        componentType: GL.BYTE,
        type: 'VEC4',
        normalized: true
    };
}

/**
 * Calculate the compression ratio for each quantization type
 */
export function getCompressionStats(originalBytes, quantizedBytes, type) {
    const ratio = quantizedBytes / originalBytes;
    const savings = 1 - ratio;

    return {
        originalBytes,
        quantizedBytes,
        ratio,
        savingsPercent: (savings * 100).toFixed(1) + '%',
        type
    };
}
