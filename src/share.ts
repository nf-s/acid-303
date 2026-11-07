import { readProject } from "./model";
import type { Project } from "./model";

const MAX_BYTES = 200000;

export async function encodeTrack(project: Project): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(project));
  const stream = new Blob([data])
    .stream()
    .pipeThrough(new CompressionStream("gzip"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `v1.${btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "")}`;
}

export async function decodeTrack(encoded: string): Promise<Project | null> {
  if (
    !encoded.startsWith("v1.") ||
    encoded.length > MAX_BYTES ||
    !/^v1\.[\w-]+$/.test(encoded)
  )
    return null;
  try {
    const binary = atob(
      encoded.slice(3).replaceAll("-", "+").replaceAll("_", "/"),
    );
    const data = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const reader = new Blob([data])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"))
      .getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return readProject(parsed);
  } catch {
    return null;
  }
}
