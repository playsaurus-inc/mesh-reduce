/**
 * View-Based Importance Analysis
 *
 * Renders the textured mesh from multiple viewpoints, detects visual edges,
 * and projects importance back to mesh triangles/vertices.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'meshoptimizer';

const RENDER_SIZE = 512;

const VIEWPOINTS = [
    { pos: [0, 0, 2.5], up: [0, 1, 0] },
    { pos: [0, 0, -2.5], up: [0, 1, 0] },
    { pos: [2.5, 0, 0], up: [0, 1, 0] },
    { pos: [-2.5, 0, 0], up: [0, 1, 0] },
    { pos: [0, 2.5, 0], up: [0, 0, -1] },
    { pos: [0, -2.5, 0], up: [0, 0, 1] },
    { pos: [1.8, 1.8, 1.8], up: [0, 1, 0] },
    { pos: [-1.8, 1.8, 1.8], up: [0, 1, 0] },
    { pos: [1.8, -1.8, 1.8], up: [0, 1, 0] },
    { pos: [-1.8, -1.8, 1.8], up: [0, 1, 0] },
    { pos: [1.8, 1.8, -1.8], up: [0, 1, 0] },
    { pos: [-1.8, 1.8, -1.8], up: [0, 1, 0] },
];

/**
 * Analyze view-based importance for a GLB model
 */
export async function analyzeViewImportance(glbArrayBuffer) {
    console.log('Starting view-based importance analysis...');
    const startTime = performance.now();

    const { renderer, renderTarget, readBuffer } = setupOffscreenRenderer();
    const gltf = await loadGLTF(glbArrayBuffer.slice(0));

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(1, 2, 3);
    scene.add(ambientLight);
    scene.add(directionalLight);

    const model = gltf.scene;
    const normalization = normalizeModel(model);

    scene.add(model);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);

    const meshInfos = collectMeshes(model);
    const totalTriangles = meshInfos.reduce((sum, m) => sum + m.triangleCount, 0);
    console.log(`Found ${meshInfos.length} meshes with ${totalTriangles} total triangles`);

    const idScene = new THREE.Scene();
    idScene.background = new THREE.Color(0x000000);
    createIdMeshes(meshInfos, idScene, normalization);

    const triangleImportance = new Float32Array(totalTriangles);
    const triangleVisibility = new Uint16Array(totalTriangles);

    for (let v = 0; v < VIEWPOINTS.length; v++) {
        const viewpoint = VIEWPOINTS[v];

        camera.position.set(...viewpoint.pos);
        camera.up.set(...viewpoint.up);
        camera.lookAt(0, 0, 0);
        camera.updateMatrixWorld();

        renderer.setRenderTarget(renderTarget);
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(renderTarget, 0, 0, RENDER_SIZE, RENDER_SIZE, readBuffer);
        const texturedPixels = new Uint8Array(readBuffer);

        renderer.render(idScene, camera);
        renderer.readRenderTargetPixels(renderTarget, 0, 0, RENDER_SIZE, RENDER_SIZE, readBuffer);
        const idPixels = new Uint8Array(readBuffer);

        processView(texturedPixels, idPixels, triangleImportance, triangleVisibility, totalTriangles);
    }

    for (let t = 0; t < totalTriangles; t++) {
        if (triangleVisibility[t] > 0) {
            triangleImportance[t] /= triangleVisibility[t];
        }
    }

    let maxImportance = 0;
    for (let t = 0; t < totalTriangles; t++) {
        maxImportance = Math.max(maxImportance, triangleImportance[t]);
    }
    if (maxImportance > 0) {
        for (let t = 0; t < totalTriangles; t++) {
            triangleImportance[t] /= maxImportance;
        }
    }

    const perVertexImportance = new Map();
    const perTriangleImportance = new Map();
    let triangleOffset = 0;

    for (let m = 0; m < meshInfos.length; m++) {
        const meshInfo = meshInfos[m];
        const vertexCount = meshInfo.vertexCount;
        const triCount = meshInfo.triangleCount;

        const meshTriImportance = new Float32Array(triCount);
        for (let t = 0; t < triCount; t++) {
            meshTriImportance[t] = triangleImportance[triangleOffset + t];
        }
        perTriangleImportance.set(m, meshTriImportance);

        const vertexImportance = triangleToVertexImportance(
            meshTriImportance,
            meshInfo.indices,
            vertexCount
        );
        perVertexImportance.set(m, vertexImportance);

        triangleOffset += triCount;
    }

    renderer.dispose();
    renderTarget.dispose();
    disposeScene(scene);
    disposeScene(idScene);

    const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
    console.log(`View-based analysis complete in ${elapsed}s`);

    let totalAbove50 = 0;
    for (const [meshIdx, importance] of perVertexImportance) {
        for (let v = 0; v < importance.length; v++) {
            if (importance[v] > 0.5) totalAbove50++;
        }
    }
    console.log(`View importance: ${totalAbove50} vertices above 0.5 threshold`);

    return { perVertex: perVertexImportance, perTriangle: perTriangleImportance };
}

function setupOffscreenRenderer() {
    const canvas = document.createElement('canvas');
    canvas.width = RENDER_SIZE;
    canvas.height = RENDER_SIZE;

    const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: false,
        preserveDrawingBuffer: true
    });
    renderer.setSize(RENDER_SIZE, RENDER_SIZE);

    const renderTarget = new THREE.WebGLRenderTarget(RENDER_SIZE, RENDER_SIZE, {
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType
    });

    const readBuffer = new Uint8Array(RENDER_SIZE * RENDER_SIZE * 4);

    return { renderer, renderTarget, readBuffer };
}

async function loadGLTF(arrayBuffer) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();

        try {
            if (MeshoptDecoder.supported) {
                loader.setMeshoptDecoder(MeshoptDecoder);
            }
        } catch (e) {
            // Decoder not ready
        }

        loader.parse(arrayBuffer, '', resolve, reject);
    });
}

function normalizeModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 2 / maxDim;

    model.position.sub(center);
    model.scale.multiplyScalar(scale);

    return { center: center.clone(), scale };
}

function collectMeshes(model) {
    const meshInfos = [];

    model.traverse((child) => {
        if (child.isMesh && child.geometry) {
            const geometry = child.geometry;
            const position = geometry.attributes.position;
            const index = geometry.index;

            let triangleCount, indices;
            if (index) {
                triangleCount = index.count / 3;
                indices = new Uint32Array(index.array);
            } else {
                triangleCount = position.count / 3;
                indices = null;
            }

            meshInfos.push({
                mesh: child,
                geometry: geometry,
                vertexCount: position.count,
                triangleCount: triangleCount,
                indices: indices,
                worldMatrix: child.matrixWorld.clone()
            });
        }
    });

    return meshInfos;
}

function createIdMeshes(meshInfos, idScene, normalization) {
    let globalTriangleOffset = 0;

    for (const meshInfo of meshInfos) {
        let geometry = meshInfo.geometry.clone();

        if (geometry.index) {
            geometry = geometry.toNonIndexed();
        }

        const positionAttr = geometry.attributes.position;
        const vertexCount = positionAttr.count;
        const triangleCount = vertexCount / 3;

        const colors = new Float32Array(vertexCount * 3);

        for (let t = 0; t < triangleCount; t++) {
            const globalTriId = globalTriangleOffset + t;
            const id = globalTriId + 1;
            const r = (id & 0xFF) / 255;
            const g = ((id >> 8) & 0xFF) / 255;
            const b = ((id >> 16) & 0xFF) / 255;

            for (let v = 0; v < 3; v++) {
                const idx = t * 3 + v;
                colors[idx * 3] = r;
                colors[idx * 3 + 1] = g;
                colors[idx * 3 + 2] = b;
            }
        }

        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.MeshBasicMaterial({
            vertexColors: true,
            side: THREE.DoubleSide
        });

        const idMesh = new THREE.Mesh(geometry, material);
        idMesh.matrix.copy(meshInfo.worldMatrix);
        idMesh.matrixAutoUpdate = false;
        idMesh.position.sub(normalization.center);
        idMesh.scale.multiplyScalar(normalization.scale);
        idMesh.updateMatrix();

        idScene.add(idMesh);

        globalTriangleOffset += meshInfo.triangleCount;
    }
}

function processView(texturedPixels, idPixels, triangleImportance, triangleVisibility, totalTriangles) {
    const width = RENDER_SIZE;
    const height = RENDER_SIZE;

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;

            const r = idPixels[idx];
            const g = idPixels[idx + 1];
            const b = idPixels[idx + 2];
            const triangleId = (r | (g << 8) | (b << 16)) - 1;

            if (triangleId < 0 || triangleId >= totalTriangles) continue;

            const edge = sobelMagnitudeAt(texturedPixels, width, height, x, y);

            triangleImportance[triangleId] += edge;
            triangleVisibility[triangleId]++;
        }
    }
}

function sobelMagnitudeAt(pixels, width, height, x, y) {
    const getGray = (px, py) => {
        const idx = (py * width + px) * 4;
        return (pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114) / 255;
    };

    let gx = 0, gy = 0;

    gx += -1 * getGray(x - 1, y - 1);
    gx += 1 * getGray(x + 1, y - 1);
    gy += -1 * getGray(x - 1, y - 1);
    gy += -2 * getGray(x, y - 1);
    gy += -1 * getGray(x + 1, y - 1);

    gx += -2 * getGray(x - 1, y);
    gx += 2 * getGray(x + 1, y);

    gx += -1 * getGray(x - 1, y + 1);
    gx += 1 * getGray(x + 1, y + 1);
    gy += 1 * getGray(x - 1, y + 1);
    gy += 2 * getGray(x, y + 1);
    gy += 1 * getGray(x + 1, y + 1);

    return Math.min(1, Math.sqrt(gx * gx + gy * gy));
}

function triangleToVertexImportance(triangleImportance, indices, vertexCount) {
    const vertexImportance = new Float32Array(vertexCount);
    const vertexTriangleCount = new Uint16Array(vertexCount);

    const triCount = triangleImportance.length;

    if (indices) {
        for (let t = 0; t < triCount; t++) {
            const importance = triangleImportance[t];
            for (let v = 0; v < 3; v++) {
                const vertIdx = indices[t * 3 + v];
                vertexImportance[vertIdx] += importance;
                vertexTriangleCount[vertIdx]++;
            }
        }
    } else {
        for (let t = 0; t < triCount; t++) {
            const importance = triangleImportance[t];
            for (let v = 0; v < 3; v++) {
                const vertIdx = t * 3 + v;
                vertexImportance[vertIdx] += importance;
                vertexTriangleCount[vertIdx]++;
            }
        }
    }

    for (let v = 0; v < vertexCount; v++) {
        if (vertexTriangleCount[v] > 0) {
            vertexImportance[v] /= vertexTriangleCount[v];
        }
    }

    return vertexImportance;
}

function disposeScene(scene) {
    scene.traverse((child) => {
        if (child.geometry) {
            child.geometry.dispose();
        }
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
    });
}

/**
 * Merge texture-based and view-based importance
 */
export function mergeImportance(textureImportance, viewImportance) {
    if (!textureImportance && !viewImportance) return null;
    if (!textureImportance) return viewImportance;
    if (!viewImportance) return textureImportance;

    const length = Math.max(textureImportance.length, viewImportance.length);
    const merged = new Float32Array(length);

    for (let i = 0; i < length; i++) {
        const t = i < textureImportance.length ? textureImportance[i] : 0;
        const v = i < viewImportance.length ? viewImportance[i] : 0;
        merged[i] = Math.max(t, v);
    }

    return merged;
}
