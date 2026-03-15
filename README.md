# ESP32 Test Workspace

Minimal experimental workspace for ESP32 browser flashing:

- `web/`: Next.js 15 app with `/esp32-test` page
- `services/esp32-compiler/`: Express service that compiles Arduino ESP32 sketches via `arduino-cli`

## 1) Run compiler service

```bash
docker compose up --build esp32-compiler
```

Health check:

```bash
curl http://localhost:8080/health
```

## 2) Run web app

```bash
cd web
npm install
npm run dev
```

Open:

- `http://localhost:3000/esp32-test`

## 3) Compile + flash flow

1. Paste or edit Arduino sketch in Monaco editor.
2. Click `Compile`.
3. Click `Select Port` and choose ESP32 serial port.
4. Click `Flash to ESP32`.

The compiler returns multi-bin image with flash offsets:

- `0x1000` `bootloader.bin`
- `0x8000` `partitions.bin`
- `0xe000` `boot_app0.bin` (when available)
- `0x10000` `app.bin`

## Notes

- Browser must support Web Serial (Chrome/Edge desktop).
- Use a data-capable USB cable.
- If sync fails: hold `BOOT`, tap `EN`, retry flash.
