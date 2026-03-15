export type Esp32BoardId = "esp32dev";

export type Esp32BoardConfig = {
  id: Esp32BoardId;
  label: string;
  fqbn: string;
  flashMode: "dio" | "qio" | "dout" | "qout" | "keep";
  flashFreq: "40m" | "80m" | "26m" | "20m" | "keep";
  flashSize: "4MB" | "8MB" | "16MB" | "keep";
  defaultBaudRate: number;
};

export type Esp32CompileFile = {
  name: string;
  address: number;
  dataBase64: string;
  size: number;
};

export type Esp32CompileResult = {
  ok: true;
  platform: "esp32";
  board: string;
  files: Esp32CompileFile[];
  durationMs: number;
  size: number;
  logs: string;
  warnings: string[];
};

export const ESP32_BOARDS: Esp32BoardConfig[] = [
  {
    id: "esp32dev",
    label: "ESP32 Dev Module",
    fqbn: "esp32:esp32:esp32",
    flashMode: "dio",
    flashFreq: "40m",
    flashSize: "4MB",
    defaultBaudRate: 115200
  }
];

export const DEFAULT_ESP32_BOARD_ID: Esp32BoardId = "esp32dev";

export function getEsp32BoardById(boardId: string): Esp32BoardConfig | undefined {
  return ESP32_BOARDS.find((board) => board.id === boardId);
}
