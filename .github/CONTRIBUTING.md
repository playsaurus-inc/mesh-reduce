# Contributing to Playsaurus Mesh Reduce

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
- [Biome](https://biomejs.dev/) for linting. It's recommended to use the [Biome extension](https://marketplace.visualstudio.com/items?itemName=biomejs.biome) for Visual Studio Code.

To lint the code, run:

```bash
npm run lint
```

## 🌐 Deploying

Simply create a new release in GitHub and the website will be automatically deployed to the server.

> [!NOTE]
> **How it works:** When you create a new Github release, a GitHub Action will merge the `main` branch into the `production` branch and Forge will deploy the changes. The deployment is handled by Laravel Forge using the `production` branch.

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
