# Playsaurus Mesh Reduce

[![Tests](https://github.com/playsaurus-inc/mesh-reduce/actions/workflows/tests.yml/badge.svg)](https://github.com/playsaurus-inc/mesh-reduce/actions/workflows/tests.yml)

A web-based tool for compressing and optimizing glTF Binary (.glb) 3D model files. Achieves significant file size reduction through mesh optimization, vertex quantization, and meshopt compression.

> **🚀 Try it now: [mesh-reduce.labs.playsaurus.com](https://mesh-reduce.labs.playsaurus.com/)**

![Playsaurus Mesh Reduce](./art/screenshot.png)

## ✨ Features

- **Vertex Deduplication** - Removes duplicate vertices
- **Vertex Cache Optimization** - Reorders vertices for better GPU performance
- **Quantization** - Reduces precision of positions (16-bit), normals (8-bit), and UVs (16-bit)
- **Meshopt Compression** - Applies EXT_meshopt_compression for additional size reduction
- **Texture-Aware Simplification** - Preserves detail in areas with high texture complexity
- **LOD Generation** - Creates multiple levels of detail (100%, 75%, 50%, 25%)
- **Texture Resizing** - Optional texture downscaling
- **Before/After Comparison** - Side-by-side 3D viewer with diff visualization

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

## 👨‍💻 Contributing

To contribute to Playsaurus Mesh Reduce, please read the [contributing documentation](./.github/CONTRIBUTING.md).

## 🔒 License

MIT
