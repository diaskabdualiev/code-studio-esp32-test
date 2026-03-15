import type { Esp32BoardConfig, Esp32CompileFile } from "@/lib/esp32/boards";

type Esp32UploadOptions = {
  port: SerialPort;
  board: Esp32BoardConfig;
  files: Esp32CompileFile[];
  baudrate?: number;
  onProgress?: (progressPercent: number) => void;
  onLog?: (line: string) => void;
};

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function toFriendlyError(raw: unknown): Error {
  const message = raw instanceof Error ? raw.message : String(raw);
  const lowered = message.toLowerCase();

  if (lowered.includes("timed out") || lowered.includes("timeout")) {
    return new Error(
      "Timeout while connecting to ESP32. Hold BOOT, tap EN (reset), then retry flashing."
    );
  }

  if (lowered.includes("notfounderror") || lowered.includes("requestport")) {
    return new Error("No serial port selected. Choose ESP32 USB port first.");
  }

  if (lowered.includes("networkerror")) {
    return new Error("Serial connection was interrupted. Reconnect USB cable and retry.");
  }

  return new Error(message);
}

export async function uploadToEsp32(options: Esp32UploadOptions): Promise<void> {
  if (!("serial" in navigator)) {
    throw new Error("Web Serial is not supported in this browser.");
  }

  if (!options.files.length) {
    throw new Error("No firmware files returned by compiler.");
  }

  const baudrate = options.baudrate ?? options.board.defaultBaudRate;
  const { Transport, ESPLoader } = await import("esptool-js");

  const decodedFiles = options.files.map((file) => ({
    address: file.address,
    data: base64ToBytes(file.dataBase64),
    size: file.size,
    name: file.name
  }));

  const totalBytes = decodedFiles.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes <= 0) {
    throw new Error("Compiler returned empty binary payload.");
  }
  const fileProgress = new Map<number, number>();

  const transport = new Transport(options.port, false, true);
  const loader = new ESPLoader({
    transport,
    baudrate
  });

  try {
    if (options.port.readable || options.port.writable) {
      await options.port.close();
    }

    options.onProgress?.(1);
    options.onLog?.("Syncing with ESP32 bootloader...");
    await loader.main();

    options.onLog?.("Writing flash image...");
    await loader.writeFlash({
      fileArray: decodedFiles.map((file) => ({
        address: file.address,
        data: file.data
      })),
      flashMode: options.board.flashMode,
      flashFreq: options.board.flashFreq,
      flashSize: options.board.flashSize,
      eraseAll: false,
      compress: true,
      reportProgress: (fileIndex: number, written: number) => {
        fileProgress.set(fileIndex, written);
        const writtenTotal = Array.from(fileProgress.values()).reduce((sum, value) => sum + value, 0);
        const percent = Math.min(99, Math.max(1, Math.round((writtenTotal / totalBytes) * 100)));
        options.onProgress?.(percent);
      }
    });

    options.onLog?.("Finalizing and rebooting chip...");
    await loader.after();
    options.onProgress?.(100);
  } catch (error) {
    throw toFriendlyError(error);
  } finally {
    try {
      await transport.disconnect();
    } catch {
      if (options.port.readable || options.port.writable) {
        await options.port.close();
      }
    }
  }
}
