/**
 * GLB Parser - Parses glTF Binary (.glb) files
 *
 * GLB Structure:
 * - 12-byte header: magic (4) + version (4) + length (4)
 * - JSON chunk: chunkLength (4) + chunkType (4) + JSON data
 * - BIN chunk: chunkLength (4) + chunkType (4) + binary data
 */

// GL constants for component types
export const GL = {
    BYTE: 5120,
    UNSIGNED_BYTE: 5121,
    SHORT: 5122,
    UNSIGNED_SHORT: 5123,
    UNSIGNED_INT: 5125,
    FLOAT: 5126
};

// Size in bytes for each component type
export const COMPONENT_SIZE = {
    [GL.BYTE]: 1,
    [GL.UNSIGNED_BYTE]: 1,
    [GL.SHORT]: 2,
    [GL.UNSIGNED_SHORT]: 2,
    [GL.UNSIGNED_INT]: 4,
    [GL.FLOAT]: 4
};

// Number of components for each accessor type
export const TYPE_COMPONENTS = {
    'SCALAR': 1,
    'VEC2': 2,
    'VEC3': 3,
    'VEC4': 4,
    'MAT2': 4,
    'MAT3': 9,
    'MAT4': 16
};

// TypedArray constructors for each component type
const TYPED_ARRAY = {
    [GL.BYTE]: Int8Array,
    [GL.UNSIGNED_BYTE]: Uint8Array,
    [GL.SHORT]: Int16Array,
    [GL.UNSIGNED_SHORT]: Uint16Array,
    [GL.UNSIGNED_INT]: Uint32Array,
    [GL.FLOAT]: Float32Array
};

/**
 * Parse a GLB file from an ArrayBuffer
 * @param {ArrayBuffer} buffer - The GLB file data
 * @returns {Object} Parsed GLB with json, binChunk, and helper methods
 */
export function parseGLB(buffer) {
    const view = new DataView(buffer);

    // Parse header
    const magic = view.getUint32(0, true);
    if (magic !== 0x46546C67) { // 'glTF' in little-endian
        throw new Error('Invalid GLB file: magic number mismatch');
    }

    const version = view.getUint32(4, true);
    if (version !== 2) {
        throw new Error(`Unsupported glTF version: ${version}`);
    }

    const totalLength = view.getUint32(8, true);

    // Parse chunks
    let offset = 12;
    let json = null;
    let binChunk = null;

    while (offset < totalLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const chunkData = buffer.slice(offset + 8, offset + 8 + chunkLength);

        if (chunkType === 0x4E4F534A) { // 'JSON'
            const decoder = new TextDecoder('utf-8');
            json = JSON.parse(decoder.decode(chunkData));
        } else if (chunkType === 0x004E4942) { // 'BIN'
            binChunk = chunkData;
        }

        // Move to next chunk (chunks are 4-byte aligned)
        offset += 8 + chunkLength;
        // Align to 4 bytes
        offset = (offset + 3) & ~3;
    }

    if (!json) {
        throw new Error('GLB file missing JSON chunk');
    }

    return {
        json,
        binChunk,

        /**
         * Get accessor data as a typed array
         * @param {number} accessorIndex - Index into json.accessors
         * @returns {TypedArray} The accessor data
         */
        getAccessorData(accessorIndex) {
            const accessor = json.accessors[accessorIndex];
            const bufferView = json.bufferViews[accessor.bufferView];

            const componentSize = COMPONENT_SIZE[accessor.componentType];
            const numComponents = TYPE_COMPONENTS[accessor.type];
            const elementSize = componentSize * numComponents;

            const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
            const byteStride = bufferView.byteStride || elementSize;

            const TypedArrayConstructor = TYPED_ARRAY[accessor.componentType];

            // If data is tightly packed (no stride or stride equals element size)
            if (!bufferView.byteStride || bufferView.byteStride === elementSize) {
                return new TypedArrayConstructor(
                    binChunk,
                    byteOffset,
                    accessor.count * numComponents
                );
            }

            // Handle strided data - need to copy
            const result = new TypedArrayConstructor(accessor.count * numComponents);
            const sourceView = new DataView(binChunk);

            for (let i = 0; i < accessor.count; i++) {
                const srcOffset = byteOffset + i * byteStride;
                for (let j = 0; j < numComponents; j++) {
                    const value = readComponent(sourceView, srcOffset + j * componentSize, accessor.componentType);
                    result[i * numComponents + j] = value;
                }
            }

            return result;
        },

        /**
         * Get all primitives from all meshes with their data
         * @returns {Array} Array of primitive objects with vertex/index data
         */
        getAllPrimitives() {
            const primitives = [];

            for (let meshIdx = 0; meshIdx < (json.meshes || []).length; meshIdx++) {
                const mesh = json.meshes[meshIdx];

                for (let primIdx = 0; primIdx < mesh.primitives.length; primIdx++) {
                    const prim = mesh.primitives[primIdx];
                    const primData = {
                        meshIndex: meshIdx,
                        primitiveIndex: primIdx,
                        meshName: mesh.name || `mesh_${meshIdx}`,
                        mode: prim.mode !== undefined ? prim.mode : 4, // Default to TRIANGULAR
                        material: prim.material,
                        attributes: {}
                    };

                    // Get indices if present
                    if (prim.indices !== undefined) {
                        primData.indices = this.getAccessorData(prim.indices);
                        primData.indicesAccessor = json.accessors[prim.indices];
                    }

                    // Get all attributes
                    for (const [attrName, accessorIdx] of Object.entries(prim.attributes)) {
                        primData.attributes[attrName] = {
                            data: this.getAccessorData(accessorIdx),
                            accessor: json.accessors[accessorIdx]
                        };
                    }

                    primitives.push(primData);
                }
            }

            return primitives;
        },

        /**
         * Get mesh statistics
         * @returns {Object} Statistics about the GLB
         */
        getStats() {
            let totalVertices = 0;
            let totalTriangles = 0;
            let meshCount = (json.meshes || []).length;
            let primitiveCount = 0;

            for (const mesh of json.meshes || []) {
                for (const prim of mesh.primitives) {
                    primitiveCount++;

                    // Count vertices from POSITION accessor
                    if (prim.attributes.POSITION !== undefined) {
                        const accessor = json.accessors[prim.attributes.POSITION];
                        totalVertices += accessor.count;
                    }

                    // Count triangles from indices
                    if (prim.indices !== undefined) {
                        const accessor = json.accessors[prim.indices];
                        totalTriangles += Math.floor(accessor.count / 3);
                    }
                }
            }

            return {
                meshCount,
                primitiveCount,
                totalVertices,
                totalTriangles,
                binChunkSize: binChunk ? binChunk.byteLength : 0,
                totalSize: buffer.byteLength
            };
        }
    };
}

/**
 * Read a single component value from a DataView
 */
function readComponent(view, offset, componentType) {
    switch (componentType) {
        case GL.BYTE:
            return view.getInt8(offset);
        case GL.UNSIGNED_BYTE:
            return view.getUint8(offset);
        case GL.SHORT:
            return view.getInt16(offset, true);
        case GL.UNSIGNED_SHORT:
            return view.getUint16(offset, true);
        case GL.UNSIGNED_INT:
            return view.getUint32(offset, true);
        case GL.FLOAT:
            return view.getFloat32(offset, true);
        default:
            throw new Error(`Unknown component type: ${componentType}`);
    }
}

/**
 * Parse a standalone glTF JSON file (for .gltf files)
 * Note: External buffers not supported - use GLB instead
 */
export function parseGLTF(jsonString) {
    const json = JSON.parse(jsonString);

    // Check for embedded base64 buffers
    const buffers = [];
    for (const buffer of json.buffers || []) {
        if (buffer.uri && buffer.uri.startsWith('data:')) {
            const base64 = buffer.uri.split(',')[1];
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            buffers.push(bytes.buffer);
        } else {
            throw new Error('External buffer URIs not supported. Please use GLB format.');
        }
    }

    // For simplicity, concatenate all buffers (most files have just one)
    const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
    const binChunk = new ArrayBuffer(totalLength);
    const view = new Uint8Array(binChunk);
    let offset = 0;
    for (const buffer of buffers) {
        view.set(new Uint8Array(buffer), offset);
        offset += buffer.byteLength;
    }

    // Return same interface as parseGLB
    return parseGLB(createGLBFromParts(json, binChunk));
}

/**
 * Helper to detect if a file is GLB or glTF
 */
export function isGLB(buffer) {
    const view = new DataView(buffer);
    return view.getUint32(0, true) === 0x46546C67;
}

/**
 * Create a minimal GLB from JSON and binary parts (internal helper)
 */
function createGLBFromParts(json, binChunk) {
    const jsonString = JSON.stringify(json);
    const jsonBytes = new TextEncoder().encode(jsonString);
    const jsonPadded = new Uint8Array(Math.ceil(jsonBytes.length / 4) * 4);
    jsonPadded.set(jsonBytes);
    // Pad with spaces
    for (let i = jsonBytes.length; i < jsonPadded.length; i++) {
        jsonPadded[i] = 0x20;
    }

    const binPadded = new Uint8Array(Math.ceil(binChunk.byteLength / 4) * 4);
    binPadded.set(new Uint8Array(binChunk));

    const totalLength = 12 + 8 + jsonPadded.length + 8 + binPadded.length;
    const result = new ArrayBuffer(totalLength);
    const view = new DataView(result);
    const bytes = new Uint8Array(result);

    // Header
    view.setUint32(0, 0x46546C67, true); // magic
    view.setUint32(4, 2, true); // version
    view.setUint32(8, totalLength, true); // length

    // JSON chunk
    view.setUint32(12, jsonPadded.length, true);
    view.setUint32(16, 0x4E4F534A, true);
    bytes.set(jsonPadded, 20);

    // BIN chunk
    const binOffset = 20 + jsonPadded.length;
    view.setUint32(binOffset, binPadded.length, true);
    view.setUint32(binOffset + 4, 0x004E4942, true);
    bytes.set(binPadded, binOffset + 8);

    return result;
}
