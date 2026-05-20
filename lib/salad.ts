const BASE_URL = process.env.TALKINGHEAD_ENDPOINT_URL?.replace(/\/$/, "") ?? "";
const AUTH = process.env.TALKINGHEAD_AUTH_TOKEN ?? "";

function headers(extra: Record<string, string> = {}) {
  return {
    ...extra,
    ...(AUTH ? { Authorization: `Bearer ${AUTH}` } : {}),
  };
}

export interface TalkingHeadOpts {
  imageFile: File | Blob;
  audioFile: File | Blob;
  durationSeconds?: number;
  width?: number;
  height?: number;
  fps?: number;
  steps?: number;
  cfg?: number;
  seed?: number;
}

export interface TalkingHeadResult {
  videoDataUrl: string;       // data:video/mp4;base64,...
  durationSeconds: number;
  frames: number;
  seed: number;
}

export async function generateTalkingHead(
  opts: TalkingHeadOpts,
): Promise<TalkingHeadResult> {
  if (!BASE_URL) throw new Error("TALKINGHEAD_ENDPOINT_URL não configurada");

  const fd = new FormData();
  fd.append("image", opts.imageFile, "portrait.jpg");
  fd.append("audio", opts.audioFile, "speech.wav");
  fd.append("duration_seconds", String(opts.durationSeconds ?? 15));
  fd.append("width", String(opts.width ?? 512));
  fd.append("height", String(opts.height ?? 512));
  fd.append("fps", String(opts.fps ?? 24));
  fd.append("steps", String(opts.steps ?? 6));
  fd.append("cfg", String(opts.cfg ?? 2.5));
  fd.append("seed", String(opts.seed ?? -1));

  const res = await fetch(`${BASE_URL}/generate`, {
    method: "POST",
    headers: headers(),
    body: fd,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Salad /generate falhou: ${res.status} ${txt.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    video: string;
    duration_seconds: number;
    frames: number;
    seed: number;
  };

  return {
    videoDataUrl: `data:video/mp4;base64,${json.video}`,
    durationSeconds: json.duration_seconds,
    frames: json.frames,
    seed: json.seed,
  };
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/health`, { headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}
