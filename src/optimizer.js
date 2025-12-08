/**
 * Optimizer - Main optimization pipeline using meshoptimizer WASM
 *
 * Optimizations applied:
 * 1. Vertex deduplication (compactMesh)
 * 2. Vertex cache optimization (reorderMesh)
 * 3. Quantization (positions, normals, UVs)
 */

import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { quantizePositions, quantizeNormals, quantizeUVs, quantizeTangents } from './quantizer.js';
import { GL, TYPE_COMPONENTS, COMPONENT_SIZE } from './glb-parser.js';
import { analyzeTextureImportance, findUVSeams, buildVertexLock } from './texture-importance.js';
import { analyzeViewImportance, mergeImportance } from './view-importance.js';

export const DEFAULT_OPTIONS = {
    deduplicateVertices: true,
    optimizeVertexCache: true,
    quantizePositions: true,
    quantizeNormals: true,
    quantizeUVs: true,
    quantizeTangents: true,
    positionBits: 16,
    meshoptCompression: true
};

/**
 * Initialize WASM modules - must be called before optimization
 */
export async function initOptimizer() {
    await Promise.all([
        MeshoptEncoder.ready,
        MeshoptSimplifier.ready
    ]);

    if (!MeshoptEncoder.supported || !MeshoptSimplifier.supported) {
        throw new Error('WebAssembly not supported in this browser');
    }
}

/**
 * Optimize a single mesh primitive
 */
export function optimizePrimitive(primitive, options = DEFAULT_OPTIONS) {
    const result = {
        meshIndex: primitive.meshIndex,
        primitiveIndex: primitive.primitiveIndex,
        meshName: primitive.meshName,
        mode: primitive.mode,
        material: primitive.material,
        attributes: {},
        indices: null,
        stats: {
            originalVertices: 0,
            optimizedVertices: 0,
            originalBytes: 0,
            optimizedBytes: 0
        }
    };

    const posAttr = primitive.attributes.POSITION;
    if (!posAttr) {
        throw new Error('Primitive missing POSITION attribute');
    }

    let positions = new Float32Array(posAttr.data);
    let vertexCount = positions.length / 3;
    result.stats.originalVertices = vertexCount;

    let indices = primitive.indices
        ? new Uint32Array(primitive.indices)
        : createDefaultIndices(vertexCount);

    result.stats.originalBytes = calculateOriginalBytes(primitive);

    if (options.deduplicateVertices && MeshoptSimplifier.supported) {
        const [remap, uniqueCount] = MeshoptSimplifier.compactMesh(indices);

        positions = remapAttribute(positions, remap, 3);
        vertexCount = uniqueCount;

        for (const [name, attr] of Object.entries(primitive.attributes)) {
            if (name !== 'POSITION') {
                const numComponents = TYPE_COMPONENTS[attr.accessor.type];
                primitive.attributes[name] = {
                    ...attr,
                    data: remapAttribute(new Float32Array(attr.data), remap, numComponents)
                };
            }
        }
    }

    result.stats.optimizedVertices = vertexCount;

    if (options.optimizeVertexCache && MeshoptEncoder.supported) {
        const [remap, unique] = MeshoptEncoder.reorderMesh(indices, true, false);

        positions = remapAttribute(positions, remap, 3);
        vertexCount = unique;

        for (const [name, attr] of Object.entries(primitive.attributes)) {
            if (name !== 'POSITION') {
                const data = name === 'POSITION' ? positions : attr.data;
                const numComponents = TYPE_COMPONENTS[attr.accessor.type];
                primitive.attributes[name] = {
                    ...attr,
                    data: remapAttribute(new Float32Array(data), remap, numComponents)
                };
            }
        }
    }

    if (options.quantizePositions) {
        const quantized = quantizePositions(positions, options.positionBits);
        result.attributes.POSITION = {
            data: quantized.quantized,
            componentType: quantized.componentType,
            type: 'VEC3',
            count: vertexCount,
            min: quantized.quantizedMin,
            max: quantized.quantizedMax,
            transform: {
                scale: quantized.scale,
                translation: quantized.center
            }
        };
    } else {
        result.attributes.POSITION = {
            data: positions,
            componentType: GL.FLOAT,
            type: 'VEC3',
            count: vertexCount,
            min: computeMin(positions, 3),
            max: computeMax(positions, 3)
        };
    }

    const normAttr = primitive.attributes.NORMAL;
    if (normAttr) {
        const normals = new Float32Array(normAttr.data);
        if (options.quantizeNormals) {
            const quantized = quantizeNormals(normals);
            result.attributes.NORMAL = {
                data: quantized.quantized,
                componentType: quantized.componentType,
                type: quantized.type,
                count: vertexCount,
                normalized: quantized.normalized
            };
        } else {
            result.attributes.NORMAL = {
                data: normals,
                componentType: GL.FLOAT,
                type: 'VEC3',
                count: vertexCount
            };
        }
    }

    for (let i = 0; i < 4; i++) {
        const uvName = i === 0 ? 'TEXCOORD_0' : `TEXCOORD_${i}`;
        const uvAttr = primitive.attributes[uvName];
        if (uvAttr) {
            const uvs = new Float32Array(uvAttr.data);
            if (options.quantizeUVs) {
                const quantized = quantizeUVs(uvs);
                result.attributes[uvName] = {
                    data: quantized.quantized,
                    componentType: quantized.componentType,
                    type: quantized.type,
                    count: vertexCount,
                    normalized: quantized.normalized
                };
            } else {
                result.attributes[uvName] = {
                    data: uvs,
                    componentType: GL.FLOAT,
                    type: 'VEC2',
                    count: vertexCount
                };
            }
        }
    }

    const tanAttr = primitive.attributes.TANGENT;
    if (tanAttr) {
        const tangents = new Float32Array(tanAttr.data);
        if (options.quantizeTangents) {
            const quantized = quantizeTangents(tangents);
            result.attributes.TANGENT = {
                data: quantized.quantized,
                componentType: quantized.componentType,
                type: quantized.type,
                count: vertexCount,
                normalized: quantized.normalized
            };
        } else {
            result.attributes.TANGENT = {
                data: tangents,
                componentType: GL.FLOAT,
                type: 'VEC4',
                count: vertexCount
            };
        }
    }

    for (const [name, attr] of Object.entries(primitive.attributes)) {
        if (!result.attributes[name]) {
            const numComponents = TYPE_COMPONENTS[attr.accessor.type];
            result.attributes[name] = {
                data: attr.data,
                componentType: attr.accessor.componentType,
                type: attr.accessor.type,
                count: vertexCount,
                normalized: attr.accessor.normalized
            };
        }
    }

    result.indices = optimizeIndexBuffer(indices, vertexCount);
    result.stats.optimizedBytes = calculateOptimizedBytes(result);

    return result;
}

/**
 * Optimize all primitives in a parsed GLB
 */
export function optimizeGLB(parsedGLB, options = DEFAULT_OPTIONS) {
    const primitives = parsedGLB.getAllPrimitives();
    const optimized = [];

    let totalOriginalBytes = 0;
    let totalOptimizedBytes = 0;
    let totalOriginalVertices = 0;
    let totalOptimizedVertices = 0;

    const attrStats = {
        indices: { original: 0, optimized: 0 },
        POSITION: { original: 0, optimized: 0 },
        NORMAL: { original: 0, optimized: 0 },
        TEXCOORD: { original: 0, optimized: 0 },
        TANGENT: { original: 0, optimized: 0 },
        OTHER: { original: 0, optimized: 0 }
    };

    for (const prim of primitives) {
        const opt = optimizePrimitive(prim, options);
        optimized.push(opt);

        totalOriginalBytes += opt.stats.originalBytes;
        totalOptimizedBytes += opt.stats.optimizedBytes;
        totalOriginalVertices += opt.stats.originalVertices;
        totalOptimizedVertices += opt.stats.optimizedVertices;

        if (prim.indices) {
            attrStats.indices.original += prim.indices.byteLength;
        }
        for (const [name, attr] of Object.entries(prim.attributes)) {
            const bytes = attr.data.byteLength;
            if (name === 'POSITION') {
                attrStats.POSITION.original += bytes;
            } else if (name === 'NORMAL') {
                attrStats.NORMAL.original += bytes;
            } else if (name.startsWith('TEXCOORD')) {
                attrStats.TEXCOORD.original += bytes;
            } else if (name === 'TANGENT') {
                attrStats.TANGENT.original += bytes;
            } else {
                attrStats.OTHER.original += bytes;
            }
        }

        if (opt.indices) {
            attrStats.indices.optimized += opt.indices.data.byteLength;
        }
        for (const [name, attr] of Object.entries(opt.attributes)) {
            const bytes = attr.data.byteLength;
            if (name === 'POSITION') {
                attrStats.POSITION.optimized += bytes;
            } else if (name === 'NORMAL') {
                attrStats.NORMAL.optimized += bytes;
            } else if (name.startsWith('TEXCOORD')) {
                attrStats.TEXCOORD.optimized += bytes;
            } else if (name === 'TANGENT') {
                attrStats.TANGENT.optimized += bytes;
            } else {
                attrStats.OTHER.optimized += bytes;
            }
        }
    }

    return {
        primitives: optimized,
        originalJSON: parsedGLB.json,
        originalBinChunk: parsedGLB.binChunk,
        stats: {
            totalOriginalBytes,
            totalOptimizedBytes,
            totalOriginalVertices,
            totalOptimizedVertices,
            bytesReduction: ((1 - totalOptimizedBytes / totalOriginalBytes) * 100).toFixed(1) + '%',
            verticesReduction: ((1 - totalOptimizedVertices / totalOriginalVertices) * 100).toFixed(1) + '%',
            attributes: attrStats
        }
    };
}

function createDefaultIndices(vertexCount) {
    const indices = new Uint32Array(vertexCount);
    for (let i = 0; i < vertexCount; i++) {
        indices[i] = i;
    }
    return indices;
}

function remapAttribute(data, remap, numComponents) {
    const oldCount = data.length / numComponents;
    const newCount = Math.max(...remap) + 1;
    const result = new data.constructor(newCount * numComponents);

    for (let i = 0; i < oldCount; i++) {
        const newIndex = remap[i];
        if (newIndex < newCount) {
            for (let j = 0; j < numComponents; j++) {
                result[newIndex * numComponents + j] = data[i * numComponents + j];
            }
        }
    }

    return result;
}

function optimizeIndexBuffer(indices, vertexCount) {
    if (vertexCount <= 255) {
        const result = new Uint8Array(indices.length);
        for (let i = 0; i < indices.length; i++) {
            result[i] = indices[i];
        }
        return { data: result, componentType: GL.UNSIGNED_BYTE };
    } else if (vertexCount <= 65535) {
        const result = new Uint16Array(indices.length);
        for (let i = 0; i < indices.length; i++) {
            result[i] = indices[i];
        }
        return { data: result, componentType: GL.UNSIGNED_SHORT };
    } else {
        return { data: indices, componentType: GL.UNSIGNED_INT };
    }
}

function calculateOriginalBytes(primitive) {
    let bytes = 0;

    if (primitive.indices) {
        bytes += primitive.indices.byteLength;
    }

    for (const attr of Object.values(primitive.attributes)) {
        bytes += attr.data.byteLength;
    }

    return bytes;
}

function calculateOptimizedBytes(result) {
    let bytes = 0;

    if (result.indices) {
        bytes += result.indices.data.byteLength;
    }

    for (const attr of Object.values(result.attributes)) {
        bytes += attr.data.byteLength;
    }

    return bytes;
}

function computeMin(data, numComponents) {
    const min = new Array(numComponents).fill(Infinity);
    const count = data.length / numComponents;

    for (let i = 0; i < count; i++) {
        for (let j = 0; j < numComponents; j++) {
            min[j] = Math.min(min[j], data[i * numComponents + j]);
        }
    }

    return min;
}

function computeMax(data, numComponents) {
    const max = new Array(numComponents).fill(-Infinity);
    const count = data.length / numComponents;

    for (let i = 0; i < count; i++) {
        for (let j = 0; j < numComponents; j++) {
            max[j] = Math.max(max[j], data[i * numComponents + j]);
        }
    }

    return max;
}

/**
 * Simplify a mesh primitive to a target triangle ratio
 */
export function simplifyPrimitive(primitive, targetRatio, errorThreshold = 0.02, options = {}) {
    if (!MeshoptSimplifier.supported) {
        console.warn('MeshoptSimplifier not supported');
        return primitive;
    }

    const posAttr = primitive.attributes.POSITION;
    if (!posAttr) {
        throw new Error('Primitive missing POSITION attribute');
    }

    const positions = new Float32Array(posAttr.data);
    const vertexCount = positions.length / 3;

    let indices = primitive.indices
        ? new Uint32Array(primitive.indices)
        : createDefaultIndices(vertexCount);

    const originalTriangleCount = indices.length / 3;
    const targetIndexCount = Math.floor(indices.length * targetRatio);
    const targetIndexCountAligned = Math.max(3, Math.floor(targetIndexCount / 3) * 3);

    let simplifiedIndices, resultError;

    console.log('Simplify options:', { textureAware: options.textureAware, hasImportance: !!options.textureImportance, threshold: options.importanceThreshold });

    if (options.textureAware && options.textureImportance) {
        const uvAttr = primitive.attributes.TEXCOORD_0;
        const uvs = uvAttr ? new Float32Array(uvAttr.data) : null;

        const uvSeams = uvs ? findUVSeams(positions, uvs) : new Set();

        const vertexLock = buildVertexLock(
            options.textureImportance,
            uvSeams,
            options.importanceThreshold || 0.5
        );

        if (uvs) {
            const attributeWeights = [1.0, 1.0];
            [simplifiedIndices, resultError] = MeshoptSimplifier.simplifyWithAttributes(
                indices,
                positions,
                3,
                uvs,
                2,
                attributeWeights,
                vertexLock,
                targetIndexCountAligned,
                errorThreshold,
                ['LockBorder']
            );
        } else {
            [simplifiedIndices, resultError] = MeshoptSimplifier.simplify(
                indices,
                positions,
                3,
                targetIndexCountAligned,
                errorThreshold,
                ['LockBorder']
            );
        }

        const lockedCount = Array.from(vertexLock).filter(v => v).length;
        console.log(`Texture-aware: ${uvSeams.size} UV seams detected, ${lockedCount}/${vertexCount} vertices locked (${(lockedCount/vertexCount*100).toFixed(1)}%)`);
    } else {
        console.log('Standard simplification (texture-aware disabled or no importance data)');
        [simplifiedIndices, resultError] = MeshoptSimplifier.simplify(
            indices,
            positions,
            3,
            targetIndexCountAligned,
            errorThreshold,
            ['LockBorder']
        );
    }

    const newTriangleCount = simplifiedIndices.length / 3;

    const [remap, uniqueCount] = MeshoptSimplifier.compactMesh(simplifiedIndices);

    const newAttributes = {};
    for (const [name, attr] of Object.entries(primitive.attributes)) {
        const numComponents = TYPE_COMPONENTS[attr.accessor.type];
        const oldData = new Float32Array(attr.data);
        const newData = new Float32Array(uniqueCount * numComponents);

        for (let oldIdx = 0; oldIdx < vertexCount; oldIdx++) {
            const newIdx = remap[oldIdx];
            if (newIdx < uniqueCount) {
                for (let c = 0; c < numComponents; c++) {
                    newData[newIdx * numComponents + c] = oldData[oldIdx * numComponents + c];
                }
            }
        }

        newAttributes[name] = {
            ...attr,
            data: newData
        };
    }

    return {
        ...primitive,
        attributes: newAttributes,
        indices: simplifiedIndices,
        stats: {
            originalTriangles: originalTriangleCount,
            simplifiedTriangles: newTriangleCount,
            originalVertices: vertexCount,
            simplifiedVertices: uniqueCount,
            reduction: ((1 - newTriangleCount / originalTriangleCount) * 100).toFixed(1) + '%',
            error: resultError
        }
    };
}

/**
 * Generate LOD chain for a parsed GLB
 */
export async function generateLODChain(parsedGLB, levels = [0.9, 0.75, 0.5, 0.25], options = DEFAULT_OPTIONS, glbArrayBuffer = null) {
    const lodChain = [];
    const originalPrimitives = parsedGLB.getAllPrimitives();

    const errorThreshold = options.lodErrorThreshold || 0.02;
    const textureAware = options.textureAware === true;

    const textureImportanceMap = new Map();
    const textureCache = {};

    let viewImportanceResult = options.viewImportanceResult || null;

    console.log('generateLODChain: textureAware =', textureAware, '(from options.textureAware =', options.textureAware, ')');

    if (textureAware) {
        if (!viewImportanceResult && glbArrayBuffer) {
            try {
                console.log('Running view-based importance analysis...');
                viewImportanceResult = await analyzeViewImportance(glbArrayBuffer);
                console.log('View-based analysis complete, meshes analyzed:', viewImportanceResult.perVertex.size);
            } catch (err) {
                console.warn('View-based analysis failed, falling back to texture-only:', err);
            }
        } else if (viewImportanceResult) {
            console.log('Using pre-computed view importance, meshes:', viewImportanceResult.perVertex.size);
        }

        console.log('Computing texture importance for', originalPrimitives.length, 'primitives...');
        for (let i = 0; i < originalPrimitives.length; i++) {
            const prim = originalPrimitives[i];
            try {
                const textureImportance = await analyzeTextureImportance(prim, parsedGLB, textureCache);

                const viewImportance = viewImportanceResult?.perVertex.get(i) || null;

                if (textureImportance || viewImportance) {
                    const merged = mergeImportance(textureImportance, viewImportance);
                    textureImportanceMap.set(i, merged);

                    const hasTexture = textureImportance ? 'yes' : 'no';
                    const hasView = viewImportance ? 'yes' : 'no';
                    console.log(`Primitive ${i}: texture=${hasTexture}, view=${hasView}, merged ${merged?.length || 0} vertices`);
                }
            } catch (err) {
                console.warn(`Failed to compute importance for primitive ${i}:`, err);
            }
        }
    }

    for (const targetRatio of levels) {
        const simplifiedPrimitives = originalPrimitives.map((prim, primIndex) =>
            simplifyPrimitive(prim, targetRatio, errorThreshold, {
                textureAware: textureAware && textureImportanceMap.has(primIndex),
                textureImportance: textureImportanceMap.get(primIndex),
                importanceThreshold: options.importanceThreshold || 0.5
            })
        );

        const simplifiedGLB = {
            ...parsedGLB,
            getAllPrimitives: () => simplifiedPrimitives
        };

        const optimized = optimizeGLB(simplifiedGLB, options);

        let totalTriangles = 0;
        let totalOriginalTriangles = 0;
        for (const prim of simplifiedPrimitives) {
            if (prim.stats) {
                totalTriangles += prim.stats.simplifiedTriangles;
                totalOriginalTriangles += prim.stats.originalTriangles;
            }
        }

        lodChain.push({
            level: targetRatio,
            levelPercent: Math.round(targetRatio * 100) + '%',
            optimizedData: optimized,
            triangleCount: totalTriangles,
            originalTriangleCount: totalOriginalTriangles,
            triangleReduction: ((1 - totalTriangles / totalOriginalTriangles) * 100).toFixed(1) + '%'
        });
    }

    return lodChain;
}
