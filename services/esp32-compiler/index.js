const cors = require("cors");
const express = require("express");
const fs = require("fs-extra");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const app = express();

const PORT = Number(process.env.PORT || 8080);
const ARDUINO_CLI_PATH = process.env.ARDUINO_CLI_PATH || "/app/arduino-cli/arduino-cli";
const ARDUINO_DATA_DIR = process.env.ARDUINO_DATA_DIR || "/app/arduino-data";
const DEFAULT_BOARD_FQBN = "esp32:esp32:esp32";
const MAX_CODE_LENGTH = 512_000;
const LIBRARY_NAME_PATTERN = /^[A-Za-z0-9 _.:+\-/]{1,80}$/;
const LIB_INSTALL_CACHE = new Set();

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "esp32-compiler", timestamp: new Date().toISOString() });
});

app.post("/api/compile", async (request, response) => {
  const startedAt = Date.now();

  try {
    const payload = validateCompilePayload(request.body);
    const compileOutput = await compileSketch(payload);

    response.json({
      ok: true,
      platform: "esp32",
      board: payload.boardFqbn,
      files: compileOutput.files,
      size: compileOutput.size,
      warnings: compileOutput.warnings,
      durationMs: Date.now() - startedAt,
      logs: compileOutput.logs
    });
  } catch (error) {
    const statusCode = error && typeof error.statusCode === "number" ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : String(error);
    response.status(statusCode).json({ ok: false, error: message });
  }
});

app.listen(PORT, () => {
  console.log(`[esp32-compiler] listening on ${PORT}`);
});

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateCompilePayload(body) {
  if (!body || typeof body !== "object") {
    throw createHttpError(400, "Request body must be a JSON object.");
  }

  const code = typeof body.code === "string" ? body.code : "";
  const boardFqbn = typeof body.boardFqbn === "string" ? body.boardFqbn : DEFAULT_BOARD_FQBN;
  const libraries = Array.isArray(body.libraries) ? body.libraries : [];

  if (!code.trim()) {
    throw createHttpError(400, "code is required.");
  }
  if (code.length > MAX_CODE_LENGTH) {
    throw createHttpError(400, `code length exceeds ${MAX_CODE_LENGTH} characters.`);
  }
  if (!boardFqbn.startsWith("esp32:")) {
    throw createHttpError(400, "Only esp32:* board FQBN is allowed in this test service.");
  }
  if (libraries.length > 20) {
    throw createHttpError(400, "libraries length exceeds 20 entries.");
  }

  const cleanedLibraries = libraries.map((lib) => {
    if (typeof lib !== "string") {
      throw createHttpError(400, "library name must be a string.");
    }
    const cleaned = lib.trim();
    if (!cleaned) {
      throw createHttpError(400, "library name cannot be empty.");
    }
    if (!LIBRARY_NAME_PATTERN.test(cleaned)) {
      throw createHttpError(400, `Unsupported library name format: ${cleaned}`);
    }
    return cleaned;
  });

  return {
    code,
    boardFqbn,
    libraries: cleanedLibraries
  };
}

async function compileSketch({ code, boardFqbn, libraries }) {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "esp32-compile-"));
  const sketchName = "main";
  const sketchDir = path.join(workspaceRoot, "sketch");
  const buildDir = path.join(workspaceRoot, "build");
  const sketchPath = path.join(sketchDir, `${sketchName}.ino`);

  await fs.ensureDir(sketchDir);
  await fs.ensureDir(buildDir);
  await fs.writeFile(sketchPath, code, "utf8");

  const logs = [];

  try {
    for (const libraryName of libraries) {
      const installLog = await ensureLibraryInstalled(libraryName);
      if (installLog) {
        logs.push(installLog);
      }
    }

    const compileResult = await runCommand(
      ARDUINO_CLI_PATH,
      ["compile", "--fqbn", boardFqbn, "--output-dir", buildDir, sketchPath],
      { timeoutMs: 7 * 60 * 1000, cwd: sketchDir }
    );

    if (compileResult.code !== 0) {
      throw createHttpError(
        422,
        `Compilation failed.\n${compileResult.stdout}\n${compileResult.stderr}`.trim()
      );
    }

    logs.push(compileResult.stdout);
    logs.push(compileResult.stderr);

    const artifactResult = await collectArtifacts(buildDir);

    return {
      files: artifactResult.files,
      size: artifactResult.size,
      warnings: artifactResult.warnings,
      logs: logs.filter(Boolean).join("\n").trim()
    };
  } finally {
    await fs.remove(workspaceRoot);
  }
}

async function ensureLibraryInstalled(libraryName) {
  if (LIB_INSTALL_CACHE.has(libraryName)) {
    return "";
  }

  const result = await runCommand(
    ARDUINO_CLI_PATH,
    ["lib", "install", libraryName],
    { timeoutMs: 2 * 60 * 1000 }
  );

  const fullLog = `${result.stdout}\n${result.stderr}`.trim();
  if (result.code !== 0 && !fullLog.toLowerCase().includes("already installed")) {
    throw createHttpError(422, `Failed to install library "${libraryName}".\n${fullLog}`);
  }

  LIB_INSTALL_CACHE.add(libraryName);
  return fullLog;
}

async function collectArtifacts(buildDir) {
  const entries = await fs.readdir(buildDir);
  const binaries = entries.filter((name) => name.endsWith(".bin"));

  const appBinName = binaries.find(
    (name) => !name.includes(".bootloader.") && !name.includes(".partitions.") && name !== "boot_app0.bin"
  );
  const bootloaderName = binaries.find((name) => name.includes(".bootloader.bin"));
  const partitionsName = binaries.find((name) => name.includes(".partitions.bin"));

  if (!appBinName || !bootloaderName || !partitionsName) {
    throw createHttpError(
      500,
      `Missing ESP32 build artifacts in ${buildDir}. Found: ${binaries.join(", ") || "none"}`
    );
  }

  const warnings = [];
  const files = [];

  const bootloader = await encodeArtifact(path.join(buildDir, bootloaderName), "bootloader.bin", 0x1000);
  const partitions = await encodeArtifact(path.join(buildDir, partitionsName), "partitions.bin", 0x8000);
  const app = await encodeArtifact(path.join(buildDir, appBinName), "app.bin", 0x10000);
  const bootApp = await findBootApp0File(buildDir);

  files.push(bootloader, partitions);
  if (bootApp) {
    files.push(bootApp);
  } else {
    warnings.push("boot_app0.bin not found. Flash may fail on some boards.");
  }
  files.push(app);

  const size = files.reduce((sum, file) => sum + file.size, 0);

  return {
    files,
    size,
    warnings
  };
}

async function findBootApp0File(buildDir) {
  const localPath = path.join(buildDir, "boot_app0.bin");
  if (await fs.pathExists(localPath)) {
    return encodeArtifact(localPath, "boot_app0.bin", 0xe000);
  }

  const coreRoot = path.join(ARDUINO_DATA_DIR, "packages", "esp32", "hardware", "esp32");
  if (!(await fs.pathExists(coreRoot))) {
    return null;
  }

  const versions = (await fs.readdir(coreRoot)).sort().reverse();
  for (const version of versions) {
    const candidate = path.join(coreRoot, version, "tools", "partitions", "boot_app0.bin");
    if (await fs.pathExists(candidate)) {
      return encodeArtifact(candidate, "boot_app0.bin", 0xe000);
    }
  }

  return null;
}

async function encodeArtifact(filePath, name, address) {
  const content = await fs.readFile(filePath);
  return {
    name,
    address,
    size: content.length,
    dataBase64: content.toString("base64")
  };
}

function runCommand(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 60_000;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(
          createHttpError(
            504,
            `Command timeout after ${Math.round(timeoutMs / 1000)}s: ${command} ${args.join(" ")}`
          )
        );
        return;
      }
      resolve({
        code: code ?? 1,
        stdout,
        stderr
      });
    });
  });
}
