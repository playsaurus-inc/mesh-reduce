/**
 * 3D Viewer - Three.js based GLB viewer with comparison support
 */

import { MeshoptDecoder } from 'meshoptimizer';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class GLBViewer {
    constructor(canvas, options = {}) {
        this.canvas = canvas;
        this.options = options;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);

        const rect = canvas.getBoundingClientRect();
        this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.01, 1000);
        this.camera.position.set(2, 2, 2);

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
        });
        this.renderer.setSize(rect.width, rect.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        this.setupLighting();

        this.model = null;
        this.wireframeMode = false;
        this.animationId = null;

        this.animate();
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(5, 10, 7.5);
        this.scene.add(directionalLight);

        const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
        fillLight.position.set(-5, 0, -5);
        this.scene.add(fillLight);

        const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
        grid.position.y = -0.01;
        this.scene.add(grid);
        this.grid = grid;
    }

    async loadGLB(arrayBuffer) {
        return new Promise((resolve, reject) => {
            const loader = new GLTFLoader();

            try {
                if (MeshoptDecoder.supported) {
                    loader.setMeshoptDecoder(MeshoptDecoder);
                }
            } catch (_e) {
                // Decoder not ready
            }

            loader.parse(
                arrayBuffer,
                '',
                (gltf) => {
                    if (this.model) {
                        this.scene.remove(this.model);
                        this.disposeModel(this.model);
                    }

                    this.model = gltf.scene;

                    const box = new THREE.Box3().setFromObject(this.model);
                    const center = box.getCenter(new THREE.Vector3());
                    const size = box.getSize(new THREE.Vector3());

                    this.model.position.sub(center);

                    const maxDim = Math.max(size.x, size.y, size.z);
                    const scale = 2 / maxDim;
                    this.model.scale.setScalar(scale);

                    this.scene.add(this.model);

                    this.camera.position.set(2, 1.5, 2);
                    this.controls.target.set(0, 0, 0);
                    this.controls.update();

                    resolve(gltf);
                },
                (error) => {
                    reject(error);
                },
            );
        });
    }

    setWireframe(enabled) {
        this.wireframeMode = enabled;

        if (this.model) {
            this.model.traverse((child) => {
                if (child.isMesh && child.material) {
                    if (Array.isArray(child.material)) {
                        child.material.forEach((m) => (m.wireframe = enabled));
                    } else {
                        child.material.wireframe = enabled;
                    }
                }
            });
        }
    }

    syncCamera(otherViewer) {
        this.controls.addEventListener('change', () => {
            otherViewer.camera.position.copy(this.camera.position);
            otherViewer.camera.quaternion.copy(this.camera.quaternion);
            otherViewer.controls.target.copy(this.controls.target);
        });
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.camera.aspect = rect.width / rect.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(rect.width, rect.height);
    }

    disposeModel(model) {
        model.traverse((child) => {
            if (child.geometry) {
                child.geometry.dispose();
            }
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((m) => {
                        if (m.map) m.map.dispose();
                        m.dispose();
                    });
                } else {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            }
        });
    }

    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }

        if (this.model) {
            this.scene.remove(this.model);
            this.disposeModel(this.model);
        }

        this.controls.dispose();
        this.renderer.dispose();
    }
}

export class DiffViewer {
    constructor(canvas) {
        this.canvas = canvas;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a2e);

        const rect = canvas.getBoundingClientRect();
        this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.01, 1000);
        this.camera.position.set(2, 2, 2);

        this.renderer = new THREE.WebGLRenderer({
            canvas,
            antialias: true,
            alpha: true,
        });
        this.renderer.setSize(rect.width, rect.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.controls = new OrbitControls(this.camera, canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;

        this.setupLighting();

        this.originalModel = null;
        this.optimizedModel = null;
        this.diffObjects = [];
        this.mode = 'overlay';
        this.animationId = null;

        this.animate();
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7.5);
        this.scene.add(directionalLight);

        const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
        grid.position.y = -0.01;
        this.scene.add(grid);
    }

    async loadModels(originalBuffer, optimizedBuffer) {
        const loader = new GLTFLoader();

        try {
            if (MeshoptDecoder.supported) {
                loader.setMeshoptDecoder(MeshoptDecoder);
            }
        } catch (_e) {
            // Decoder not ready
        }

        const loadModel = (buffer) =>
            new Promise((resolve, reject) => {
                loader.parse(buffer, '', resolve, reject);
            });

        const [originalGltf, optimizedGltf] = await Promise.all([
            loadModel(originalBuffer.slice(0)),
            loadModel(optimizedBuffer.slice(0)),
        ]);

        this.clearModels();

        this.originalModel = originalGltf.scene;
        this.optimizedModel = optimizedGltf.scene;

        this.normalizeModel(this.originalModel);
        this.normalizeModel(this.optimizedModel);

        this.setMode(this.mode);
    }

    normalizeModel(model) {
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        model.position.sub(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        const scale = 2 / maxDim;
        model.scale.setScalar(scale);
    }

    setMode(mode) {
        this.mode = mode;
        this.clearDiffObjects();

        if (!this.originalModel || !this.optimizedModel) return;

        switch (mode) {
            case 'overlay':
                this.showOverlay();
                break;
            case 'wireframe':
                this.showWireframe();
                break;
            case 'edgediff':
                this.showEdgeDiff();
                break;
            case 'pointcloud':
                this.showPointCloud();
                break;
            case 'pointcloud-overlay':
                this.showPointCloudOverlay();
                break;
            case 'original':
                this.showOriginalOnly();
                break;
            case 'optimized':
                this.showOptimizedOnly();
                break;
        }
    }

    showOverlay() {
        const origClone = this.originalModel.clone(true);
        const optClone = this.optimizedModel.clone(true);

        origClone.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshBasicMaterial({
                    color: 0x00ffff,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.5,
                });
            }
        });

        optClone.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshBasicMaterial({
                    color: 0xff00ff,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.5,
                });
            }
        });

        this.scene.add(origClone);
        this.scene.add(optClone);
        this.diffObjects.push(origClone, optClone);
    }

    showWireframe() {
        const origClone = this.originalModel.clone(true);
        const optClone = this.optimizedModel.clone(true);

        origClone.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshBasicMaterial({
                    color: 0x00ff00,
                    wireframe: true,
                });
            }
        });

        optClone.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshBasicMaterial({
                    color: 0xff0000,
                    wireframe: true,
                });
            }
        });

        this.scene.add(origClone);
        this.scene.add(optClone);
        this.diffObjects.push(origClone, optClone);
    }

    showEdgeDiff() {
        const origEdges = this.extractEdges(this.originalModel);
        const optEdges = this.extractEdges(this.optimizedModel);

        const origSet = new Set(origEdges.map((e) => e.key));
        const optSet = new Set(optEdges.map((e) => e.key));

        const sharedEdges = [];
        const origOnlyEdges = [];
        const optOnlyEdges = [];

        for (const edge of origEdges) {
            if (optSet.has(edge.key)) {
                sharedEdges.push(edge);
            } else {
                origOnlyEdges.push(edge);
            }
        }

        for (const edge of optEdges) {
            if (!origSet.has(edge.key)) {
                optOnlyEdges.push(edge);
            }
        }

        if (sharedEdges.length > 0) {
            const sharedLine = this.createEdgeLines(sharedEdges, 0x0066ff);
            this.scene.add(sharedLine);
            this.diffObjects.push(sharedLine);
        }

        if (origOnlyEdges.length > 0) {
            const origLine = this.createEdgeLines(origOnlyEdges, 0xff0000);
            this.scene.add(origLine);
            this.diffObjects.push(origLine);
        }

        if (optOnlyEdges.length > 0) {
            const optLine = this.createEdgeLines(optOnlyEdges, 0x00ff00);
            this.scene.add(optLine);
            this.diffObjects.push(optLine);
        }
    }

    extractEdges(model) {
        const edges = [];
        const precision = 1000;

        model.traverse((child) => {
            if (child.isMesh && child.geometry) {
                const geometry = child.geometry;
                const position = geometry.attributes.position;
                const index = geometry.index;

                child.updateMatrixWorld();
                const matrix = child.matrixWorld;

                const getVertex = (idx) => {
                    const v = new THREE.Vector3(position.getX(idx), position.getY(idx), position.getZ(idx));
                    v.applyMatrix4(matrix);
                    return v;
                };

                const makeKey = (v1, v2) => {
                    const k1 = `${Math.round(v1.x * precision)},${Math.round(v1.y * precision)},${Math.round(v1.z * precision)}`;
                    const k2 = `${Math.round(v2.x * precision)},${Math.round(v2.y * precision)},${Math.round(v2.z * precision)}`;
                    return k1 < k2 ? `${k1}-${k2}` : `${k2}-${k1}`;
                };

                const addEdge = (i1, i2) => {
                    const v1 = getVertex(i1);
                    const v2 = getVertex(i2);
                    edges.push({
                        key: makeKey(v1, v2),
                        v1,
                        v2,
                    });
                };

                if (index) {
                    for (let i = 0; i < index.count; i += 3) {
                        const a = index.getX(i);
                        const b = index.getX(i + 1);
                        const c = index.getX(i + 2);
                        addEdge(a, b);
                        addEdge(b, c);
                        addEdge(c, a);
                    }
                } else {
                    for (let i = 0; i < position.count; i += 3) {
                        addEdge(i, i + 1);
                        addEdge(i + 1, i + 2);
                        addEdge(i + 2, i);
                    }
                }
            }
        });

        const unique = new Map();
        for (const edge of edges) {
            if (!unique.has(edge.key)) {
                unique.set(edge.key, edge);
            }
        }

        return Array.from(unique.values());
    }

    createEdgeLines(edges, color) {
        const positions = [];
        for (const edge of edges) {
            positions.push(edge.v1.x, edge.v1.y, edge.v1.z);
            positions.push(edge.v2.x, edge.v2.y, edge.v2.z);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

        const material = new THREE.LineBasicMaterial({ color });
        return new THREE.LineSegments(geometry, material);
    }

    showPointCloud() {
        const origPositions = this.extractPositions(this.originalModel);
        const optPositions = this.extractPositions(this.optimizedModel);

        const colors = [];
        const positions = [];

        for (const pos of optPositions) {
            let minDist = Infinity;
            for (const origPos of origPositions) {
                const dist = pos.distanceTo(origPos);
                if (dist < minDist) minDist = dist;
            }

            positions.push(pos.x, pos.y, pos.z);

            const t = Math.min(1, minDist * 50);
            colors.push(t, 1 - t, 0);
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.02,
            vertexColors: true,
        });

        const points = new THREE.Points(geometry, material);
        this.scene.add(points);
        this.diffObjects.push(points);
    }

    showPointCloudOverlay() {
        this.showPointCloud();

        const origClone = this.originalModel.clone(true);
        origClone.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshBasicMaterial({
                    color: 0x444444,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.3,
                });
            }
        });
        this.scene.add(origClone);
        this.diffObjects.push(origClone);
    }

    extractPositions(model) {
        const positions = [];

        model.traverse((child) => {
            if (child.isMesh && child.geometry) {
                const position = child.geometry.attributes.position;
                child.updateMatrixWorld();

                for (let i = 0; i < position.count; i++) {
                    const v = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
                    v.applyMatrix4(child.matrixWorld);
                    positions.push(v);
                }
            }
        });

        return positions;
    }

    showOriginalOnly() {
        const clone = this.originalModel.clone(true);
        this.scene.add(clone);
        this.diffObjects.push(clone);
    }

    showOptimizedOnly() {
        const clone = this.optimizedModel.clone(true);
        this.scene.add(clone);
        this.diffObjects.push(clone);
    }

    clearDiffObjects() {
        for (const obj of this.diffObjects) {
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) {
                    obj.material.forEach((m) => m.dispose());
                } else {
                    obj.material.dispose();
                }
            }
        }
        this.diffObjects = [];
    }

    clearModels() {
        this.clearDiffObjects();

        if (this.originalModel) {
            this.disposeModel(this.originalModel);
            this.originalModel = null;
        }

        if (this.optimizedModel) {
            this.disposeModel(this.optimizedModel);
            this.optimizedModel = null;
        }
    }

    disposeModel(model) {
        model.traverse((child) => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach((m) => m.dispose());
                } else {
                    child.material.dispose();
                }
            }
        });
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    resize() {
        const rect = this.canvas.getBoundingClientRect();
        this.camera.aspect = rect.width / rect.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(rect.width, rect.height);
    }

    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        this.clearModels();
        this.controls.dispose();
        this.renderer.dispose();
    }
}
