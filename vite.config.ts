import { defineConfig } from 'vite';

// HTTPS in dev is not strictly required because getUserMedia works on http://localhost,
// but if you want to test on a LAN device you need HTTPS. Run `vite --https`
// or wire up a self-signed cert here.
//
// `base` is the public path the bundle is served from. GitHub Pages serves
// project sites at `https://<user>.github.io/<repo>/`, so the built asset
// URLs need that prefix. In dev (`vite`) base defaults to '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/webgpu-handcontrol/' : '/',
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  optimizeDeps: {
    // MediaPipe ships its own .wasm; let Vite handle it.
    exclude: ['@mediapipe/tasks-vision'],
  },
}));
