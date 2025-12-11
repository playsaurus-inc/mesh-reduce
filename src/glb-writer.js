/**
 * GLB Writer - Generates optimized GLB files
 *
 * Creates a valid GLB with:
 * - Quantized vertex attributes
 * - KHR_mesh_quantization extension
 * - EXT_meshopt_compression for actual byte compression
 * - Optimized buffer layout
 * - Preserved images and textures
 */

import { MeshoptEncoder } from 'meshoptimizer';
import { COMPONENT_SIZE, GL, TYPE_COMPONENTS } from './glb-parser.js';

/**
 * Write optimized data to a GLB file
 */
export function writeGLB(optimizedData, options = {}, processedImages = null) {
    const { primitives, originalJSON, originalBinChunk } = optimizedData;
    const useMeshoptCompression = options.meshoptCompression !== false;

    const json = {
        asset: {
            version: '2.0',
            generator: 'Playsaurus Mesh Reduce',
        },
        extensionsUsed: ['KHR_mesh_quantization'],
        extensionsRequired: ['KHR_mesh_quantization'],
    };

    if (useMeshoptCompression) {
        json.extensionsUsed.push('EXT_meshopt_compression');
        // MUST be in extensionsRequired - without decompression support, file is unreadable
        json.extensionsRequired.push('EXT_meshopt_compression');
    }

    if (originalJSON.scene !== undefined) json.scene = originalJSON.scene;
    if (originalJSON.scenes) json.scenes = JSON.parse(JSON.stringify(originalJSON.scenes));
    if (originalJSON.nodes) json.nodes = JSON.parse(JSON.stringify(originalJSON.nodes));
    if (originalJSON.materials) json.materials = JSON.parse(JSON.stringify(originalJSON.materials));
    if (originalJSON.textures) json.textures = JSON.parse(JSON.stringify(originalJSON.textures));
    if (originalJSON.samplers) json.samplers = JSON.parse(JSON.stringify(originalJSON.samplers));
    if (originalJSON.animations) json.animations = JSON.parse(JSON.stringify(originalJSON.animations));
    if (originalJSON.skins) json.skins = JSON.parse(JSON.stringify(originalJSON.skins));
    if (originalJSON.cameras) json.cameras = JSON.parse(JSON.stringify(originalJSON.cameras));

    const bufferData = [];
    const bufferViews = [];
    const accessors = [];
    let currentOffset = 0;

    const meshesByIndex = new Map();
    for (const prim of primitives) {
        if (!meshesByIndex.has(prim.meshIndex)) {
            meshesByIndex.set(prim.meshIndex, []);
        }
        meshesByIndex.get(prim.meshIndex).push(prim);
    }

    const meshes = [];
    for (const [_meshIndex, prims] of meshesByIndex) {
        const mesh = {
            name: prims[0].meshName,
            primitives: [],
        };

        for (const prim of prims) {
            const primitive = {
                attributes: {},
                mode: prim.mode,
            };

            if (prim.material !== undefined) {
                primitive.material = prim.material;
            }

            if (prim.indices) {
                const indexData = prim.indices.data;
                const indexCount = indexData.length;
                const _indexStride = indexData.BYTES_PER_ELEMENT;

                let finalData;
                let bufferView;

                const canCompressIndices = useMeshoptCompression && MeshoptEncoder.supported && indexCount > 0;

                if (canCompressIndices) {
                    let indices32 = indexData;
                    if (!(indexData instanceof Uint32Array)) {
                        indices32 = new Uint32Array(indexData);
                    }

                    let compressed;
                    try {
                        compressed = MeshoptEncoder.encodeIndexBuffer(indices32, indexCount, 4);
                    } catch (e) {
                        console.warn('Failed to compress indices, falling back to uncompressed:', e);
                        compressed = null;
                    }

                    if (compressed) {
                        const alignedOffset = alignTo(currentOffset, 4);
                        if (alignedOffset > currentOffset) {
                            bufferData.push(new Uint8Array(alignedOffset - currentOffset));
                            currentOffset = alignedOffset;
                        }

                        bufferView = {
                            buffer: 0,
                            byteOffset: currentOffset,
                            byteLength: compressed.byteLength,
                            extensions: {
                                EXT_meshopt_compression: {
                                    buffer: 0,
                                    byteOffset: currentOffset,
                                    byteLength: compressed.byteLength,
                                    byteStride: 4,
                                    count: indexCount,
                                    mode: 'TRIANGLES',
                                },
                            },
                        };
                        finalData = compressed;

                        bufferViews.push(bufferView);
                        accessors.push({
                            bufferView: bufferViews.length - 1,
                            componentType: GL.UNSIGNED_INT,
                            count: indexCount,
                            type: 'SCALAR',
                        });
                        primitive.indices = accessors.length - 1;
                        bufferData.push(finalData);
                        currentOffset += finalData.byteLength;
                    } else {
                        const alignedOffset = alignTo(currentOffset, 4);
                        if (alignedOffset > currentOffset) {
                            bufferData.push(new Uint8Array(alignedOffset - currentOffset));
                            currentOffset = alignedOffset;
                        }
                        bufferView = {
                            buffer: 0,
                            byteOffset: currentOffset,
                            byteLength: indexData.byteLength,
                            target: 34963,
                        };
                        finalData = new Uint8Array(indexData.buffer, indexData.byteOffset, indexData.byteLength);

                        bufferViews.push(bufferView);
                        accessors.push({
                            bufferView: bufferViews.length - 1,
                            componentType: prim.indices.componentType,
                            count: indexCount,
                            type: 'SCALAR',
                        });
                        primitive.indices = accessors.length - 1;
                        bufferData.push(finalData);
                        currentOffset += finalData.byteLength;
                    }
                } else {
                    const alignedOffset = alignTo(currentOffset, 4);
                    if (alignedOffset > currentOffset) {
                        bufferData.push(new Uint8Array(alignedOffset - currentOffset));
                        currentOffset = alignedOffset;
                    }

                    bufferView = {
                        buffer: 0,
                        byteOffset: currentOffset,
                        byteLength: indexData.byteLength,
                        target: 34963,
                    };
                    finalData = new Uint8Array(indexData.buffer, indexData.byteOffset, indexData.byteLength);

                    bufferViews.push(bufferView);
                    accessors.push({
                        bufferView: bufferViews.length - 1,
                        componentType: prim.indices.componentType,
                        count: indexCount,
                        type: 'SCALAR',
                    });
                    primitive.indices = accessors.length - 1;
                    bufferData.push(finalData);
                    currentOffset += finalData.byteLength;
                }
            }

            for (const [attrName, attr] of Object.entries(prim.attributes)) {
                const data = attr.data;
                const componentSize = COMPONENT_SIZE[attr.componentType];
                const numComponents = TYPE_COMPONENTS[attr.type];
                const stride = componentSize * numComponents;
                const count = attr.count;

                let finalData;
                let bufferView;

                const canCompress =
                    useMeshoptCompression && MeshoptEncoder.supported && stride % 4 === 0 && stride <= 256 && count > 0;

                if (canCompress) {
                    const dataBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                    let compressed;
                    try {
                        compressed = MeshoptEncoder.encodeVertexBuffer(dataBytes, count, stride);
                    } catch (e) {
                        console.warn(`Failed to compress ${attrName} buffer, falling back to uncompressed:`, e);
                        compressed = null;
                    }

                    if (compressed) {
                        const alignedOffset = alignTo(currentOffset, 4);
                        if (alignedOffset > currentOffset) {
                            bufferData.push(new Uint8Array(alignedOffset - currentOffset));
                            currentOffset = alignedOffset;
                        }

                        bufferView = {
                            buffer: 0,
                            byteOffset: currentOffset,
                            byteLength: compressed.byteLength,
                            extensions: {
                                EXT_meshopt_compression: {
                                    buffer: 0,
                                    byteOffset: currentOffset,
                                    byteLength: compressed.byteLength,
                                    byteStride: stride,
                                    count: count,
                                    mode: 'ATTRIBUTES',
                                },
                            },
                        };
                        finalData = compressed;
                    } else {
                        const alignedOffset = alignTo(currentOffset, componentSize);
                        if (alignedOffset > currentOffset) {
                            bufferData.push(new Uint8Array(alignedOffset - currentOffset));
                            currentOffset = alignedOffset;
                        }

                        bufferView = {
                            buffer: 0,
                            byteOffset: currentOffset,
                            byteLength: data.byteLength,
                            target: 34962,
                        };
                        finalData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                    }
                } else {
                    const alignedOffset = alignTo(currentOffset, componentSize);
                    if (alignedOffset > currentOffset) {
                        bufferData.push(new Uint8Array(alignedOffset - currentOffset));
                        currentOffset = alignedOffset;
                    }

                    bufferView = {
                        buffer: 0,
                        byteOffset: currentOffset,
                        byteLength: data.byteLength,
                        target: 34962,
                    };
                    finalData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
                }

                bufferViews.push(bufferView);

                const accessor = {
                    bufferView: bufferViews.length - 1,
                    componentType: attr.componentType,
                    count: count,
                    type: attr.type,
                };

                if (attr.normalized) {
                    accessor.normalized = true;
                }

                if (attrName === 'POSITION' && attr.min && attr.max) {
                    accessor.min = attr.min;
                    accessor.max = attr.max;
                }

                accessors.push(accessor);
                primitive.attributes[attrName] = accessors.length - 1;

                bufferData.push(finalData);
                currentOffset += finalData.byteLength;
            }

            mesh.primitives.push(primitive);
        }

        meshes.push(mesh);
    }

    json.meshes = meshes;
    json.accessors = accessors;

    const _imageData = [];
    if (originalJSON.images && originalBinChunk) {
        json.images = [];
        for (let i = 0; i < originalJSON.images.length; i++) {
            const origImage = originalJSON.images[i];

            if (origImage.bufferView !== undefined) {
                let imageBytes;
                if (processedImages?.has(i)) {
                    imageBytes = processedImages.get(i);
                } else {
                    const origBufferView = originalJSON.bufferViews[origImage.bufferView];
                    const byteOffset = origBufferView.byteOffset || 0;
                    const byteLength = origBufferView.byteLength;
                    imageBytes = new Uint8Array(originalBinChunk, byteOffset, byteLength);
                }

                const byteLength = imageBytes.byteLength;

                const alignedOffset = alignTo(currentOffset, 4);
                if (alignedOffset > currentOffset) {
                    bufferData.push(new Uint8Array(alignedOffset - currentOffset));
                    currentOffset = alignedOffset;
                }

                const newBufferViewIndex = bufferViews.length;
                bufferViews.push({
                    buffer: 0,
                    byteOffset: currentOffset,
                    byteLength: byteLength,
                });

                bufferData.push(imageBytes instanceof Uint8Array ? imageBytes.slice() : new Uint8Array(imageBytes));
                currentOffset += byteLength;

                const newImage = { bufferView: newBufferViewIndex };
                if (origImage.mimeType) newImage.mimeType = origImage.mimeType;
                if (origImage.name) newImage.name = origImage.name;
                json.images.push(newImage);
            } else if (origImage.uri) {
                json.images.push(JSON.parse(JSON.stringify(origImage)));
            }
        }
    }

    if ((originalJSON.animations || originalJSON.skins) && originalBinChunk) {
        const meshAccessorIndices = new Set();
        for (const mesh of originalJSON.meshes || []) {
            for (const prim of mesh.primitives) {
                if (prim.indices !== undefined) meshAccessorIndices.add(prim.indices);
                for (const accIdx of Object.values(prim.attributes)) {
                    meshAccessorIndices.add(accIdx);
                }
                if (prim.targets) {
                    for (const target of prim.targets) {
                        for (const accIdx of Object.values(target)) {
                            meshAccessorIndices.add(accIdx);
                        }
                    }
                }
            }
        }

        const accessorRemapping = new Map();
        if (originalJSON.animations) {
            for (const anim of originalJSON.animations) {
                for (const sampler of anim.samplers) {
                    if (!meshAccessorIndices.has(sampler.input)) {
                        copyAccessor(sampler.input, 'input');
                    }
                    if (!meshAccessorIndices.has(sampler.output)) {
                        copyAccessor(sampler.output, 'output');
                    }
                }
            }
        }

        if (originalJSON.skins) {
            for (const skin of originalJSON.skins) {
                if (skin.inverseBindMatrices !== undefined && !meshAccessorIndices.has(skin.inverseBindMatrices)) {
                    copyAccessor(skin.inverseBindMatrices, 'inverseBindMatrices');
                }
            }
        }

        function copyAccessor(origAccIdx, _debugName) {
            if (accessorRemapping.has(origAccIdx)) return;

            const origAccessor = originalJSON.accessors[origAccIdx];
            const origBufferView = originalJSON.bufferViews[origAccessor.bufferView];

            const componentSize = COMPONENT_SIZE[origAccessor.componentType];
            const numComponents = TYPE_COMPONENTS[origAccessor.type];
            const elementSize = componentSize * numComponents;
            const byteLength = origAccessor.count * elementSize;

            const srcOffset = (origBufferView.byteOffset || 0) + (origAccessor.byteOffset || 0);
            const srcData = new Uint8Array(originalBinChunk, srcOffset, byteLength);

            const alignedOffset = alignTo(currentOffset, componentSize);
            if (alignedOffset > currentOffset) {
                bufferData.push(new Uint8Array(alignedOffset - currentOffset));
                currentOffset = alignedOffset;
            }

            const newBufferViewIndex = bufferViews.length;
            bufferViews.push({
                buffer: 0,
                byteOffset: currentOffset,
                byteLength: byteLength,
            });

            const newAccessorIndex = accessors.length;
            const newAccessor = {
                bufferView: newBufferViewIndex,
                componentType: origAccessor.componentType,
                count: origAccessor.count,
                type: origAccessor.type,
            };
            if (origAccessor.min) newAccessor.min = origAccessor.min;
            if (origAccessor.max) newAccessor.max = origAccessor.max;
            if (origAccessor.normalized) newAccessor.normalized = origAccessor.normalized;
            accessors.push(newAccessor);

            bufferData.push(srcData.slice());
            currentOffset += byteLength;

            accessorRemapping.set(origAccIdx, newAccessorIndex);
        }

        if (json.animations) {
            for (const anim of json.animations) {
                for (const sampler of anim.samplers) {
                    if (accessorRemapping.has(sampler.input)) {
                        sampler.input = accessorRemapping.get(sampler.input);
                    }
                    if (accessorRemapping.has(sampler.output)) {
                        sampler.output = accessorRemapping.get(sampler.output);
                    }
                }
            }
        }

        if (json.skins) {
            for (const skin of json.skins) {
                if (skin.inverseBindMatrices !== undefined && accessorRemapping.has(skin.inverseBindMatrices)) {
                    skin.inverseBindMatrices = accessorRemapping.get(skin.inverseBindMatrices);
                }
            }
        }
    }

    json.bufferViews = bufferViews;

    const totalBufferSize = currentOffset;
    const combinedBuffer = new Uint8Array(totalBufferSize);
    let offset = 0;
    for (const chunk of bufferData) {
        combinedBuffer.set(chunk, offset);
        offset += chunk.byteLength;
    }

    json.buffers = [
        {
            byteLength: totalBufferSize,
        },
    ];

    applyQuantizationTransforms(json, primitives, originalJSON);

    const jsonString = JSON.stringify(json);
    const jsonBytes = new TextEncoder().encode(jsonString);

    const jsonPaddedLength = alignTo(jsonBytes.length, 4);
    const jsonPadded = new Uint8Array(jsonPaddedLength);
    jsonPadded.set(jsonBytes);
    for (let i = jsonBytes.length; i < jsonPaddedLength; i++) {
        jsonPadded[i] = 0x20;
    }

    const binPaddedLength = alignTo(combinedBuffer.length, 4);
    const binPadded = new Uint8Array(binPaddedLength);
    binPadded.set(combinedBuffer);

    const totalLength = 12 + 8 + jsonPaddedLength + 8 + binPaddedLength;

    const glb = new ArrayBuffer(totalLength);
    const view = new DataView(glb);
    const bytes = new Uint8Array(glb);

    view.setUint32(0, 0x46546c67, true);
    view.setUint32(4, 2, true);
    view.setUint32(8, totalLength, true);

    view.setUint32(12, jsonPaddedLength, true);
    view.setUint32(16, 0x4e4f534a, true);
    bytes.set(jsonPadded, 20);

    const binChunkOffset = 20 + jsonPaddedLength;
    view.setUint32(binChunkOffset, binPaddedLength, true);
    view.setUint32(binChunkOffset + 4, 0x004e4942, true);
    bytes.set(binPadded, binChunkOffset + 8);

    return glb;
}

function applyQuantizationTransforms(json, primitives, originalJSON) {
    for (const prim of primitives) {
        const posAttr = prim.attributes.POSITION;
        if (posAttr?.transform) {
        }
    }

    if (json.nodes && originalJSON.nodes) {
        for (let i = 0; i < json.nodes.length; i++) {
            const node = json.nodes[i];
            if (node.mesh !== undefined) {
                const meshPrims = primitives.filter((p) => p.meshIndex === node.mesh);
                if (meshPrims.length > 0 && meshPrims[0].attributes.POSITION?.transform) {
                    const transform = meshPrims[0].attributes.POSITION.transform;
                    const dqScale = transform.scale;
                    const dqOffset = transform.translation;

                    const origScale = node.scale ? [...node.scale] : [1, 1, 1];
                    const origRotation = node.rotation ? [...node.rotation] : [0, 0, 0, 1];

                    if (!node.scale) {
                        node.scale = [dqScale[0], dqScale[1], dqScale[2]];
                    } else {
                        node.scale[0] *= dqScale[0];
                        node.scale[1] *= dqScale[1];
                        node.scale[2] *= dqScale[2];
                    }

                    let scaledOffset = [
                        origScale[0] * dqOffset[0],
                        origScale[1] * dqOffset[1],
                        origScale[2] * dqOffset[2],
                    ];

                    if (node.rotation) {
                        scaledOffset = rotateVectorByQuaternion(scaledOffset, origRotation);
                    }

                    if (!node.translation) {
                        node.translation = scaledOffset;
                    } else {
                        node.translation[0] += scaledOffset[0];
                        node.translation[1] += scaledOffset[1];
                        node.translation[2] += scaledOffset[2];
                    }
                }
            }
        }
    }
}

function rotateVectorByQuaternion(v, q) {
    const qx = q[0],
        qy = q[1],
        qz = q[2],
        qw = q[3];
    const vx = v[0],
        vy = v[1],
        vz = v[2];

    const cx = qy * vz - qz * vy + qw * vx;
    const cy = qz * vx - qx * vz + qw * vy;
    const cz = qx * vy - qy * vx + qw * vz;

    return [vx + 2 * (qy * cz - qz * cy), vy + 2 * (qz * cx - qx * cz), vz + 2 * (qx * cy - qy * cx)];
}

function alignTo(offset, alignment) {
    return Math.ceil(offset / alignment) * alignment;
}

export function createDownloadBlob(glbData) {
    return new Blob([glbData], { type: 'model/gltf-binary' });
}

export function downloadGLB(glbData, filename = 'optimized.glb') {
    const blob = createDownloadBlob(glbData);
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    URL.revokeObjectURL(url);
}
