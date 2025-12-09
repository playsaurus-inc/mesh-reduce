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
        this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 1000);
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
        this.normalization = null;

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

    async loadGLB(arrayBuffer, useNormalization = null, preserveCamera = false) {
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
                    const maxDim = Math.max(size.x, size.y, size.z);

                    // Use provided normalization or calculate new one
                    if (useNormalization) {
                        this.normalization = useNormalization;
                    } else {
                        this.normalization = {
                            center: center.clone(),
                            scale: 2 / maxDim,
                        };
                    }

                    // Apply normalization
                    this.model.position.sub(this.normalization.center);
                    this.model.scale.multiplyScalar(this.normalization.scale);

                    this.scene.add(this.model);

                    if (!preserveCamera) {
                        this.camera.position.set(2, 1.5, 2);
                        this.controls.target.set(0, 0, 0);
                        this.controls.update();
                    }

                    resolve({ gltf, normalization: this.normalization });
                },
                (error) => {
                    reject(error);
                },
            );
        });
    }

    getNormalization() {
        return this.normalization;
    }

    getCamera() {
        return {
            position: this.camera.position.clone(),
            target: this.controls.target.clone(),
        };
    }

    setCamera(position, target) {
        this.camera.position.copy(position);
        this.controls.target.copy(target);
        this.controls.update();
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
        this.camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 1000);
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

        this.originalModel = null;
        this.optimizedModel = null;
        this.pointCloud = null;
        this.edgeDiff = null; // { shared, origOnly, optOnly, stats }
        this.mode = 'overlay';
        this.animationId = null;
        this.lastStats = null;
        this.edgeDiffStats = null;

        this.animate();
    }

    setupLighting() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 10, 7.5);
        this.scene.add(directionalLight);

        const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
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

        // Clear old models and visualizations
        this.clearAll();

        // Get scenes
        const origScene = originalGltf.scene;
        const optScene = optimizedGltf.scene;

        // Calculate normalization from original
        const box = new THREE.Box3().setFromObject(origScene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);
        const normalization = {
            center: center.clone(),
            scale: 2 / maxDim,
        };

        // Apply normalization to both scenes BEFORE cloning
        origScene.position.sub(normalization.center);
        origScene.scale.multiplyScalar(normalization.scale);
        optScene.position.sub(normalization.center);
        optScene.scale.multiplyScalar(normalization.scale);

        // Clone and prepare original model (cyan wireframe)
        this.originalModel = origScene.clone();
        this.originalModel.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshBasicMaterial({
                    color: 0x00ffff,
                    wireframe: true,
                    transparent: true,
                    opacity: 0.7,
                    depthTest: true,
                });
            }
        });
        this.scene.add(this.originalModel);

        // Clone and prepare optimized model (magenta semi-transparent solid)
        this.optimizedModel = optScene.clone();
        this.optimizedModel.traverse((child) => {
            if (child.isMesh) {
                child.material = new THREE.MeshBasicMaterial({
                    color: 0xff00ff,
                    transparent: true,
                    opacity: 0.4,
                    depthTest: true,
                    side: THREE.DoubleSide,
                });
            }
        });
        this.scene.add(this.optimizedModel);

        // Extract vertices for point cloud comparison
        const originalVertices = this.extractVertices(this.originalModel);
        const optimizedVertices = this.extractVertices(this.optimizedModel);

        // Create point cloud
        this.pointCloud = this.createErrorPointCloud(originalVertices, optimizedVertices);
        if (this.pointCloud) {
            this.pointCloud.visible = false;
            this.scene.add(this.pointCloud);
        }

        // Create edge diff visualization
        this.edgeDiff = this.createEdgeDiffLines(this.originalModel, this.optimizedModel);
        this.edgeDiffStats = this.edgeDiff.stats;
        if (this.edgeDiff.shared) {
            this.edgeDiff.shared.visible = false;
            this.scene.add(this.edgeDiff.shared);
        }
        if (this.edgeDiff.origOnly) {
            this.edgeDiff.origOnly.visible = false;
            this.scene.add(this.edgeDiff.origOnly);
        }
        if (this.edgeDiff.optOnly) {
            this.edgeDiff.optOnly.visible = false;
            this.scene.add(this.edgeDiff.optOnly);
        }

        // Reset camera
        this.camera.position.set(2, 1.5, 2);
        this.controls.target.set(0, 0, 0);
        this.controls.update();

        // Apply current diff mode
        this.setMode(this.mode);
    }

    extractVertices(model) {
        const vertices = [];
        model.traverse((child) => {
            if (child.isMesh && child.geometry) {
                const posAttr = child.geometry.getAttribute('position');
                if (!posAttr) return;

                child.updateWorldMatrix(true, false);
                const worldMatrix = child.matrixWorld;

                for (let i = 0; i < posAttr.count; i++) {
                    const v = new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
                    v.applyMatrix4(worldMatrix);
                    vertices.push(v);
                }
            }
        });
        return vertices;
    }

    buildSpatialIndex(vertices, cellSize = 0.1) {
        const index = new Map();
        for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];
            const key = `${Math.floor(v.x / cellSize)},${Math.floor(v.y / cellSize)},${Math.floor(v.z / cellSize)}`;
            if (!index.has(key)) {
                index.set(key, []);
            }
            index.get(key).push(i);
        }
        return { index, cellSize, vertices };
    }

    findNearestDistance(point, spatialIndex) {
        const { index, cellSize, vertices } = spatialIndex;
        const cx = Math.floor(point.x / cellSize);
        const cy = Math.floor(point.y / cellSize);
        const cz = Math.floor(point.z / cellSize);

        let minDist = Infinity;

        // Search in a 3x3x3 neighborhood
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = `${cx + dx},${cy + dy},${cz + dz}`;
                    const cell = index.get(key);
                    if (cell) {
                        for (const idx of cell) {
                            const dist = point.distanceTo(vertices[idx]);
                            if (dist < minDist) {
                                minDist = dist;
                            }
                        }
                    }
                }
            }
        }

        // If no points found in neighborhood, do exhaustive search
        if (minDist === Infinity) {
            for (const v of vertices) {
                const dist = point.distanceTo(v);
                if (dist < minDist) {
                    minDist = dist;
                }
            }
        }

        return minDist;
    }

    createErrorPointCloud(origVerts, optVerts) {
        if (!origVerts.length || !optVerts.length) return null;

        // Build spatial index from original vertices
        const spatialIndex = this.buildSpatialIndex(origVerts);

        // Calculate error for each optimized vertex
        const errors = [];
        let maxError = 0;
        let sumError = 0;

        for (const v of optVerts) {
            const error = this.findNearestDistance(v, spatialIndex);
            errors.push(error);
            maxError = Math.max(maxError, error);
            sumError += error;
        }

        const avgError = sumError / errors.length;

        // Calculate threshold based on model scale (use 0.1% of bounding box diagonal)
        const bbox = new THREE.Box3();
        for (const v of origVerts) bbox.expandByPoint(v);
        const modelSize = bbox.getSize(new THREE.Vector3()).length();
        const tolerance = modelSize * 0.001; // 0.1% of model size

        // Count points within tolerance
        let withinTolerance = 0;
        for (const e of errors) {
            if (e <= tolerance) withinTolerance++;
        }

        // Store stats
        this.lastStats = {
            maxError,
            avgError,
            tolerance,
            withinTolerance,
            totalPoints: errors.length,
            percentWithin: ((withinTolerance / errors.length) * 100).toFixed(1),
        };

        // Create geometry
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(optVerts.length * 3);
        const colors = new Float32Array(optVerts.length * 3);

        // Color scale: green (0) -> yellow (0.5) -> red (1)
        const errorScale = maxError > 0 ? maxError : 1;

        for (let i = 0; i < optVerts.length; i++) {
            positions[i * 3] = optVerts[i].x;
            positions[i * 3 + 1] = optVerts[i].y;
            positions[i * 3 + 2] = optVerts[i].z;

            // Normalize error to [0, 1]
            const t = Math.min(errors[i] / errorScale, 1);

            // Color gradient: green -> yellow -> red
            let r, g, b;
            if (t < 0.5) {
                // Green to yellow
                r = t * 2;
                g = 1;
                b = 0;
            } else {
                // Yellow to red
                r = 1;
                g = 1 - (t - 0.5) * 2;
                b = 0;
            }

            colors[i * 3] = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.02,
            vertexColors: true,
            sizeAttenuation: true,
        });

        return new THREE.Points(geometry, material);
    }

    extractEdges(model, precision = 4) {
        const edges = new Set();
        const edgeList = [];

        model.traverse((child) => {
            if (child.isMesh && child.geometry) {
                const posAttr = child.geometry.getAttribute('position');
                const indexAttr = child.geometry.index;
                if (!posAttr) return;

                child.updateWorldMatrix(true, false);
                const worldMatrix = child.matrixWorld;

                const getVertex = (idx) => {
                    const v = new THREE.Vector3(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx));
                    v.applyMatrix4(worldMatrix);
                    return v;
                };

                const makeEdgeKey = (v1, v2) => {
                    const p = precision;
                    const a = `${v1.x.toFixed(p)},${v1.y.toFixed(p)},${v1.z.toFixed(p)}`;
                    const b = `${v2.x.toFixed(p)},${v2.y.toFixed(p)},${v2.z.toFixed(p)}`;
                    return a < b ? `${a}|${b}` : `${b}|${a}`;
                };

                const addEdge = (i1, i2) => {
                    const v1 = getVertex(i1);
                    const v2 = getVertex(i2);
                    const key = makeEdgeKey(v1, v2);
                    if (!edges.has(key)) {
                        edges.add(key);
                        edgeList.push({ v1, v2, key });
                    }
                };

                if (indexAttr) {
                    for (let i = 0; i < indexAttr.count; i += 3) {
                        const a = indexAttr.getX(i);
                        const b = indexAttr.getX(i + 1);
                        const c = indexAttr.getX(i + 2);
                        addEdge(a, b);
                        addEdge(b, c);
                        addEdge(c, a);
                    }
                } else {
                    for (let i = 0; i < posAttr.count; i += 3) {
                        addEdge(i, i + 1);
                        addEdge(i + 1, i + 2);
                        addEdge(i + 2, i);
                    }
                }
            }
        });

        return { edges, edgeList };
    }

    createEdgeDiffLines(origModel, optModel) {
        const origData = this.extractEdges(origModel);
        const optData = this.extractEdges(optModel);

        const sharedEdges = [];
        const origOnlyEdges = [];
        const optOnlyEdges = [];

        // Find shared and original-only edges
        for (const edge of origData.edgeList) {
            if (optData.edges.has(edge.key)) {
                sharedEdges.push(edge);
            } else {
                origOnlyEdges.push(edge);
            }
        }

        // Find optimized-only edges
        for (const edge of optData.edgeList) {
            if (!origData.edges.has(edge.key)) {
                optOnlyEdges.push(edge);
            }
        }

        const createLineSegments = (edgeList, color, opacity) => {
            if (edgeList.length === 0) return null;

            const positions = new Float32Array(edgeList.length * 6);
            for (let i = 0; i < edgeList.length; i++) {
                const e = edgeList[i];
                positions[i * 6] = e.v1.x;
                positions[i * 6 + 1] = e.v1.y;
                positions[i * 6 + 2] = e.v1.z;
                positions[i * 6 + 3] = e.v2.x;
                positions[i * 6 + 4] = e.v2.y;
                positions[i * 6 + 5] = e.v2.z;
            }

            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

            const material = new THREE.LineBasicMaterial({
                color,
                transparent: true,
                opacity,
                depthTest: true,
            });

            return new THREE.LineSegments(geometry, material);
        };

        return {
            shared: createLineSegments(sharedEdges, 0x4444ff, 0.3), // Transparent blue
            origOnly: createLineSegments(origOnlyEdges, 0xff4444, 0.9), // Red
            optOnly: createLineSegments(optOnlyEdges, 0x44ff44, 0.9), // Green
            stats: {
                shared: sharedEdges.length,
                origOnly: origOnlyEdges.length,
                optOnly: optOnlyEdges.length,
                total: origData.edges.size + optData.edges.size - sharedEdges.length,
            },
        };
    }

    updateStatsDisplay() {
        const statsEl = document.getElementById('diff-stats');
        if (!statsEl || !this.lastStats) return;

        statsEl.innerHTML = `
            <div class="stat-row"><span>Max Error:</span> <span>${(this.lastStats.maxError * 1000).toFixed(3)} mm</span></div>
            <div class="stat-row"><span>Avg Error:</span> <span>${(this.lastStats.avgError * 1000).toFixed(3)} mm</span></div>
            <div class="stat-row"><span>Points within tolerance:</span> <span>${this.lastStats.percentWithin}% (${this.lastStats.withinTolerance}/${this.lastStats.totalPoints})</span></div>
            <div class="stat-row"><span>Tolerance:</span> <span>${(this.lastStats.tolerance * 1000).toFixed(3)} mm (0.1% of model)</span></div>
        `;
    }

    updateEdgeDiffStats() {
        const statsEl = document.getElementById('diff-stats');
        if (!statsEl || !this.edgeDiffStats) return;

        const sharedPct = ((this.edgeDiffStats.shared / this.edgeDiffStats.total) * 100).toFixed(1);
        statsEl.innerHTML = `
            <div class="stat-row"><span style="color: #4444ff;">■ Shared edges:</span> <span>${this.edgeDiffStats.shared} (${sharedPct}%)</span></div>
            <div class="stat-row"><span style="color: #ff4444;">■ Original only:</span> <span>${this.edgeDiffStats.origOnly}</span></div>
            <div class="stat-row"><span style="color: #44ff44;">■ Optimized only:</span> <span>${this.edgeDiffStats.optOnly}</span></div>
            <div class="stat-row"><span>Total unique edges:</span> <span>${this.edgeDiffStats.total}</span></div>
        `;
    }

    clearStats() {
        const statsEl = document.getElementById('diff-stats');
        if (statsEl) {
            statsEl.innerHTML = '';
        }
    }

    setMode(mode) {
        this.mode = mode;
        if (!this.originalModel || !this.optimizedModel) return;

        // Hide point cloud and edge diff by default
        if (this.pointCloud) this.pointCloud.visible = false;
        if (this.edgeDiff) {
            if (this.edgeDiff.shared) this.edgeDiff.shared.visible = false;
            if (this.edgeDiff.origOnly) this.edgeDiff.origOnly.visible = false;
            if (this.edgeDiff.optOnly) this.edgeDiff.optOnly.visible = false;
        }

        // Clear stats by default
        this.clearStats();

        if (mode === 'overlay') {
            this.originalModel.visible = true;
            this.optimizedModel.visible = true;
            this.originalModel.traverse((child) => {
                if (child.isMesh) {
                    child.material.wireframe = true;
                    child.material.color.setHex(0x00ffff);
                    child.material.opacity = 0.6;
                }
            });
            this.optimizedModel.traverse((child) => {
                if (child.isMesh) {
                    child.material.wireframe = false;
                    child.material.color.setHex(0xff00ff);
                    child.material.opacity = 0.5;
                }
            });
        } else if (mode === 'wireframe') {
            this.originalModel.visible = true;
            this.optimizedModel.visible = true;
            this.originalModel.traverse((child) => {
                if (child.isMesh) {
                    child.material.wireframe = true;
                    child.material.color.setHex(0x00ffff);
                    child.material.opacity = 0.8;
                }
            });
            this.optimizedModel.traverse((child) => {
                if (child.isMesh) {
                    child.material.wireframe = true;
                    child.material.color.setHex(0xff00ff);
                    child.material.opacity = 0.8;
                }
            });
        } else if (mode === 'edgediff') {
            this.originalModel.visible = false;
            this.optimizedModel.visible = false;
            if (this.edgeDiff) {
                if (this.edgeDiff.shared) this.edgeDiff.shared.visible = true;
                if (this.edgeDiff.origOnly) this.edgeDiff.origOnly.visible = true;
                if (this.edgeDiff.optOnly) this.edgeDiff.optOnly.visible = true;
            }
            this.updateEdgeDiffStats();
        } else if (mode === 'pointcloud') {
            this.originalModel.visible = false;
            this.optimizedModel.visible = false;
            if (this.pointCloud) this.pointCloud.visible = true;
            this.updateStatsDisplay();
        } else if (mode === 'pointcloud-overlay') {
            this.originalModel.visible = true;
            this.optimizedModel.visible = false;
            this.originalModel.traverse((child) => {
                if (child.isMesh) {
                    child.material.wireframe = true;
                    child.material.color.setHex(0x444444);
                    child.material.opacity = 0.3;
                }
            });
            if (this.pointCloud) this.pointCloud.visible = true;
            this.updateStatsDisplay();
        } else if (mode === 'original') {
            this.originalModel.visible = true;
            this.optimizedModel.visible = false;
        } else if (mode === 'optimized') {
            this.originalModel.visible = false;
            this.optimizedModel.visible = true;
        }
    }

    getStats() {
        return this.lastStats;
    }

    getCamera() {
        return {
            position: this.camera.position.clone(),
            target: this.controls.target.clone(),
        };
    }

    setCamera(position, target) {
        this.camera.position.copy(position);
        this.controls.target.copy(target);
        this.controls.update();
    }

    clearAll() {
        if (this.originalModel) {
            this.scene.remove(this.originalModel);
            this.disposeModel(this.originalModel);
            this.originalModel = null;
        }
        if (this.optimizedModel) {
            this.scene.remove(this.optimizedModel);
            this.disposeModel(this.optimizedModel);
            this.optimizedModel = null;
        }
        if (this.pointCloud) {
            this.scene.remove(this.pointCloud);
            if (this.pointCloud.geometry) this.pointCloud.geometry.dispose();
            if (this.pointCloud.material) this.pointCloud.material.dispose();
            this.pointCloud = null;
        }
        if (this.edgeDiff) {
            if (this.edgeDiff.shared) {
                this.scene.remove(this.edgeDiff.shared);
                if (this.edgeDiff.shared.geometry) this.edgeDiff.shared.geometry.dispose();
                if (this.edgeDiff.shared.material) this.edgeDiff.shared.material.dispose();
            }
            if (this.edgeDiff.origOnly) {
                this.scene.remove(this.edgeDiff.origOnly);
                if (this.edgeDiff.origOnly.geometry) this.edgeDiff.origOnly.geometry.dispose();
                if (this.edgeDiff.origOnly.material) this.edgeDiff.origOnly.material.dispose();
            }
            if (this.edgeDiff.optOnly) {
                this.scene.remove(this.edgeDiff.optOnly);
                if (this.edgeDiff.optOnly.geometry) this.edgeDiff.optOnly.geometry.dispose();
                if (this.edgeDiff.optOnly.material) this.edgeDiff.optOnly.material.dispose();
            }
            this.edgeDiff = null;
        }
        this.lastStats = null;
        this.edgeDiffStats = null;
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
        this.clearAll();
        this.controls.dispose();
        this.renderer.dispose();
    }
}
