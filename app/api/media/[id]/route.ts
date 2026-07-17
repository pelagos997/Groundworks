import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "../../../../db";
import { fieldMedia } from "../../../../db/schema";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getRuntimeEnv } from "../../../../lib/runtime-env";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await getChatGPTUser())) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const runtime = getRuntimeEnv();
  if (!runtime.MEDIA) return NextResponse.json({ error: "Media storage unavailable." }, { status: 503 });
  const { id } = await context.params;
  const [metadata] = await getDb().select().from(fieldMedia).where(eq(fieldMedia.id, id)).limit(1);
  if (!metadata) return NextResponse.json({ error: "Media not found." }, { status: 404 });
  const object = await runtime.MEDIA.get(metadata.storageKey);
  if (!object) return NextResponse.json({ error: "Media object not found." }, { status: 404 });
  return new Response(object.body, {
    headers: {
      "content-type": metadata.contentType,
      "cache-control": "private, max-age=60",
      "content-security-policy": "default-src 'none'; img-src 'self'; sandbox",
      "x-content-type-options": "nosniff",
      "content-disposition": `inline; filename="${id}.${extension(metadata.contentType)}"`,
    },
  });
}

function extension(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return "jpg";
}
