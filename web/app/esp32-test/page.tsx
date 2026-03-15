"use client";

import { useState, useTransition } from "react";
import Editor from "@monaco-editor/react";
import {
  DEFAULT_ESP32_BOARD_ID,
  ESP32_BOARDS,
  getEsp32BoardById,
  type Esp32CompileResult
} from "@/lib/esp32/boards";
import { uploadToEsp32 } from "@/lib/esp32/upload";

const DEFAULT_CODE = `#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
}

void loop() {
  digitalWrite(2, HIGH);
  delay(500);
  digitalWrite(2, LOW);
  delay(500);
  Serial.println("Blink from ESP32 test page");
}
`;

function nowLabel() {
  return new Date().toLocaleTimeString();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export default function Esp32TestPage() {
  const [code, setCode] = useState(DEFAULT_CODE);
  const [boardId, setBoardId] = useState<string>(DEFAULT_ESP32_BOARD_ID);
  const [librariesText, setLibrariesText] = useState("");
  const [compileResult, setCompileResult] = useState<Esp32CompileResult | null>(null);
  const [selectedPort, setSelectedPort] = useState<SerialPort | null>(null);
  const [progress, setProgress] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([`[${nowLabel()}] Ready.`]);

  const [isCompiling, startCompileTransition] = useTransition();
  const [isFlashing, startFlashTransition] = useTransition();

  const selectedBoard = getEsp32BoardById(boardId) ?? ESP32_BOARDS[0];

  const appendLog = (line: string) => {
    setLogs((previous) => [...previous, `[${nowLabel()}] ${line}`].slice(-250));
  };

  async function doCompile() {
    try {
      setErrorText(null);
      setCompileResult(null);
      setProgress(0);
      appendLog(`Compiling for ${selectedBoard.label}...`);

      const libraries = librariesText
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

      const response = await fetch("/api/esp32/compile", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          code,
          boardId,
          libraries
        })
      });

      const payload = (await response.json()) as
        | Esp32CompileResult
        | { ok: false; error?: string; details?: unknown };

      if (!response.ok || !("ok" in payload) || payload.ok !== true) {
        const message = "error" in payload && payload.error ? payload.error : "Compile failed.";
        throw new Error(message);
      }

      setCompileResult(payload);
      appendLog(
        `Compile success. ${payload.files.length} files, ${(payload.size / 1024).toFixed(1)} KB total.`
      );
      if (payload.warnings.length) {
        appendLog(`Warnings: ${payload.warnings.join(" | ")}`);
      }
    } catch (error) {
      const message = toErrorMessage(error);
      setErrorText(message);
      appendLog(`Compile error: ${message}`);
    }
  }

  async function handlePortConnect() {
    try {
      setErrorText(null);
      if (!("serial" in navigator)) {
        throw new Error("Web Serial is not available in this browser.");
      }

      const port = await navigator.serial.requestPort();
      setSelectedPort(port);
      const info = port.getInfo();
      appendLog(
        `Port selected (VID: ${info.usbVendorId ?? "n/a"}, PID: ${info.usbProductId ?? "n/a"}).`
      );
    } catch (error) {
      const message = toErrorMessage(error);
      setErrorText(message);
      appendLog(`Port error: ${message}`);
    }
  }

  async function handleDisconnect() {
    try {
      if (!selectedPort) {
        return;
      }
      if (selectedPort.readable || selectedPort.writable) {
        await selectedPort.close();
      }
      setSelectedPort(null);
      appendLog("Port disconnected.");
    } catch (error) {
      const message = toErrorMessage(error);
      setErrorText(message);
      appendLog(`Disconnect error: ${message}`);
    }
  }

  async function doFlash() {
    if (!compileResult) {
      setErrorText("Compile firmware before flashing.");
      return;
    }
    if (!selectedPort) {
      setErrorText("Select serial port first.");
      return;
    }

    try {
      setErrorText(null);
      setProgress(0);
      appendLog("Starting ESP32 flash...");

      await uploadToEsp32({
        port: selectedPort,
        board: selectedBoard,
        files: compileResult.files,
        onProgress: setProgress,
        onLog: appendLog
      });

      appendLog("Flash completed successfully.");
    } catch (error) {
      const message = toErrorMessage(error);
      setErrorText(message);
      appendLog(`Flash error: ${message}`);
    }
  }

  return (
    <main className="page-shell">
      <h1 className="hero-title">ESP32 Compile + Flash Test</h1>
      <p className="hero-subtitle">
        Minimal test page for the full flow: compile in backend, flash in browser via Web Serial.
      </p>

      <section className="surface">
        <div className="field">
          <label className="label" htmlFor="board">
            Board
          </label>
          <select
            id="board"
            className="select"
            value={boardId}
            onChange={(event) => setBoardId(event.target.value)}
            disabled={isCompiling || isFlashing}
          >
            {ESP32_BOARDS.map((board) => (
              <option key={board.id} value={board.id}>
                {board.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ marginTop: 10 }}>
          <label className="label" htmlFor="libraries">
            Optional libraries (comma-separated)
          </label>
          <input
            id="libraries"
            className="input"
            value={librariesText}
            onChange={(event) => setLibrariesText(event.target.value)}
            placeholder="Adafruit MPU6050, DHT sensor library"
            disabled={isCompiling || isFlashing}
          />
        </div>

        <div className="editor-frame">
          <Editor
            height="380px"
            defaultLanguage="cpp"
            language="cpp"
            value={code}
            onChange={(value) => setCode(value ?? "")}
            theme="vs-dark"
            options={{
              minimap: { enabled: false },
              fontSize: 14,
              tabSize: 2,
              automaticLayout: true,
              scrollBeyondLastLine: false
            }}
          />
        </div>

        <div className="actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => startCompileTransition(() => void doCompile())}
            disabled={isCompiling || isFlashing}
          >
            {isCompiling ? "Compiling..." : "Compile"}
          </button>

          <button
            type="button"
            className="button button-muted"
            onClick={handlePortConnect}
            disabled={isCompiling || isFlashing}
          >
            Select Port
          </button>

          <button
            type="button"
            className="button button-muted"
            onClick={handleDisconnect}
            disabled={isCompiling || isFlashing || !selectedPort}
          >
            Disconnect Port
          </button>

          <button
            type="button"
            className="button button-primary"
            onClick={() => startFlashTransition(() => void doFlash())}
            disabled={isCompiling || isFlashing || !compileResult || !selectedPort}
          >
            {isFlashing ? "Flashing..." : "Flash to ESP32"}
          </button>
        </div>

        <div className="status-row">
          <div className="status-chip">Port: {selectedPort ? "selected" : "not selected"}</div>
          <div className="status-chip">
            Firmware: {compileResult ? `${compileResult.files.length} files` : "not compiled"}
          </div>
          <div className="status-chip">Progress: {progress}%</div>
        </div>

        <div className="progress-wrap" aria-label="Flash progress">
          <div className="progress-bar" style={{ width: `${progress}%` }} />
        </div>

        {errorText ? <div className="error-box">{errorText}</div> : null}

        <div className="hint">
          Tip: if sync fails, hold <strong>BOOT</strong>, tap <strong>EN</strong>, then retry.
        </div>

        <div className="logs">
          {logs.map((line, index) => (
            <div key={`${line}-${index}`}>{line}</div>
          ))}
        </div>
      </section>
    </main>
  );
}
