# Frontend Dist Placeholder

`tauri.conf.json` points `build.frontendDist` to this directory. During development the Tauri app consumes the Vite dev server, so this folder remains empty.

Before creating a production bundle (`pnpm tauri build`), run `pnpm -C ../frontend build` and copy the generated `frontend/dist` contents into this directory:

```
pnpm -C ../frontend build
rm -rf tauri/src-tauri/frontend_resources/*
cp -R ../frontend/dist/* tauri/src-tauri/frontend_resources/
```

Keeping only this README in git prevents committed build artifacts while preserving the expected directory structure.
