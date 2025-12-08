# Mesh Reduce

A web-based tool for compressing and optimizing glTF Binary (.glb) 3D model files. Achieves significant file size reduction through mesh optimization, vertex quantization, and meshopt compression.

## ✨ Features

- **Vertex Deduplication** - Removes duplicate vertices
- **Vertex Cache Optimization** - Reorders vertices for better GPU performance
- **Quantization** - Reduces precision of positions (16-bit), normals (8-bit), and UVs (16-bit)
- **Meshopt Compression** - Applies EXT_meshopt_compression for additional size reduction
- **Texture-Aware Simplification** - Preserves detail in areas with high texture complexity
- **LOD Generation** - Creates multiple levels of detail (100%, 75%, 50%, 25%)
- **Texture Resizing** - Optional texture downscaling
- **Before/After Comparison** - Side-by-side 3D viewer with diff visualization

## 👨‍💻 Development

```bash
git clone git@github.com:playsaurus-inc/mesh-reduce.git
cd mesh-reduce
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser.

The project uses the following technologies:
- [Vite](https://vitejs.dev/) as build system
- [Three.js](https://threejs.org/) for 3D rendering
- [meshoptimizer](https://github.com/zeux/meshoptimizer) for mesh optimization via WebAssembly

## 🎮 Usage

1. Open the app in your browser
2. Drag and drop a `.glb` file onto the drop zone (or click to browse)
3. Adjust compression settings as needed:
   - **Simplification** - How aggressively to reduce triangle count
   - **Texture-Aware** - Preserve detail in textured areas
   - **Detail Preservation** - Threshold for protecting important vertices
   - **Texture Resolution** - Optionally downscale textures
4. Click **Compress**
5. Review the before/after comparison
6. Select desired LOD level
7. Click **Download Optimized** to save

## 🌐 Deploying

```bash
npm run build
```

The built files will be in the `dist` directory, ready to be deployed to any static hosting service.

## 📦 Output Compatibility

The optimized GLB files use standard glTF 2.0 extensions:

- `KHR_mesh_quantization` - For quantized vertex attributes
- `EXT_meshopt_compression` - For buffer compression

These are supported by:
- Unity (glTFast, UnityGLTF)
- Unreal Engine
- Babylon.js
- Three.js
- Most modern glTF viewers

## 📁 Project Structure

```
mesh-reduce/
├── public/
│   └── favicon.svg
├── src/
│   ├── main.js                # Application entry point
│   ├── style.css              # Styles
│   ├── glb-parser.js          # GLB file parsing
│   ├── glb-writer.js          # GLB file writing
│   ├── optimizer.js           # Mesh optimization pipeline
│   ├── quantizer.js           # Vertex attribute quantization
│   ├── viewer.js              # Three.js 3D viewers
│   ├── texture-utils.js       # Texture analysis and resizing
│   ├── texture-importance.js  # Texture-based importance analysis
│   └── view-importance.js     # View-based importance analysis
├── index.html
└── package.json
```

## 🔒 License

MIT
