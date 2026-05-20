import { NextRequest, NextResponse } from "next/server";
import { startGeneration } from "@/lib/salad";

export const runtime = "nodejs";
export const maxDuration = 30; // just submits the job, fast

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "use multipart/form-data com 'image', 'audio'" },
        { status: 400 },
      );
    }

    const fd = await req.formData();
    const image = fd.get("image");
    const audio = fd.get("audio");
    const duration = Number(fd.get("duration") ?? 15);
    const width = Number(fd.get("width") ?? 512);
    const height = Number(fd.get("height") ?? 512);

    if (!(image instanceof File)) {
      return NextResponse.json({ error: "imagem ausente" }, { status: 400 });
    }
    if (!(audio instanceof File)) {
      return NextResponse.json({ error: "áudio ausente" }, { status: 400 });
    }
    if (image.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: "imagem maior que 10MB" }, { status: 400 });
    }
    if (audio.size > 20 * 1024 * 1024) {
      return NextResponse.json({ error: "áudio maior que 20MB" }, { status: 400 });
    }
    if (duration < 1 || duration > 30) {
      return NextResponse.json({ error: "duração deve ser 1–30s" }, { status: 400 });
    }

    const jobId = await startGeneration({
      imageFile: image,
      audioFile: audio,
      durationSeconds: duration,
      width,
      height,
    });

    return NextResponse.json({ job_id: jobId, status: "pending" });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
