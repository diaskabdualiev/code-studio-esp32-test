import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_ESP32_BOARD_ID, getEsp32BoardById } from "@/lib/esp32/boards";

const compileSchema = z.object({
  code: z.string().min(1).max(512_000),
  boardId: z.string().default(DEFAULT_ESP32_BOARD_ID),
  libraries: z.array(z.string().min(1).max(120)).max(20).default([])
});

const COMPILER_URL = process.env.ESP32_COMPILER_URL ?? "http://localhost:8080";

export async function POST(request: NextRequest) {
  let rawBody: unknown;

  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid JSON body."
      },
      { status: 400 }
    );
  }

  const parsed = compileSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid request payload.",
        details: parsed.error.flatten()
      },
      { status: 400 }
    );
  }

  const board = getEsp32BoardById(parsed.data.boardId);
  if (!board) {
    return NextResponse.json(
      {
        ok: false,
        error: `Unsupported boardId: ${parsed.data.boardId}`
      },
      { status: 400 }
    );
  }

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(`${COMPILER_URL}/api/compile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        code: parsed.data.code,
        boardFqbn: board.fqbn,
        libraries: parsed.data.libraries
      }),
      cache: "no-store"
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown compiler connection error.";
    return NextResponse.json(
      {
        ok: false,
        error: `Compiler service unavailable: ${message}`
      },
      { status: 502 }
    );
  }

  const upstreamJson = await upstreamResponse.json().catch(() => null);
  if (!upstreamResponse.ok) {
    return NextResponse.json(
      upstreamJson ?? {
        ok: false,
        error: "Compiler service failed with unknown payload."
      },
      { status: upstreamResponse.status }
    );
  }

  return NextResponse.json(upstreamJson, { status: 200 });
}
