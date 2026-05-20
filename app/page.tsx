"use client";

import { useState, useRef, useEffect, useCallback } from "react";

type Step = "idle" | "submitting" | "polling" | "done" | "error";

async function compressImage(file: File, maxSize = 512): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ratio = Math.min(maxSize / img.width, maxSize / img.height, 1);
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.85);
    };
    img.src = url;
  });
}

export default function Home() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [duration, setDuration] = useState(15);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ frames: number; seed: number; duration_seconds: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  const imgRef = useRef<HTMLInputElement>(null);
  const audRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startTimeRef = useRef<number>(0);

  function pickImage(f: File | null) {
    setImageFile(f);
    setVideoUrl(null);
    if (f) {
      const reader = new FileReader();
      reader.onload = () => setImagePreview(String(reader.result));
      reader.readAsDataURL(f);
    } else {
      setImagePreview(null);
    }
  }

  function pickAudio(f: File | null) {
    setAudioFile(f);
    setAudioName(f?.name ?? null);
    setVideoUrl(null);
  }

  const pollStatus = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/status/${id}`);
      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        setStep("error");
        setErrorMsg(`Resposta inválida: ${text.slice(0, 200)}`);
        return;
      }

      if (!res.ok) {
        setStep("error");
        setErrorMsg(String(data.error ?? `HTTP ${res.status}`));
        return;
      }

      const status = data.status as string;
      const prog = (data.progress as string) || "";
      const secs = Math.round((Date.now() - startTimeRef.current) / 1000);
      setElapsed(secs);

      if (status === "done") {
        const b64 = data.video as string;
        setVideoUrl(`data:video/mp4;base64,${b64}`);
        setMeta({
          frames: data.frames as number,
          seed: data.seed as number,
          duration_seconds: data.duration_seconds as number,
        });
        setProgress(`Concluído em ${secs}s`);
        setStep("done");
      } else if (status === "error") {
        setStep("error");
        setErrorMsg(String(data.error ?? "Erro desconhecido no servidor"));
      } else {
        setProgress(prog || `Processando... ${secs}s`);
        pollRef.current = setTimeout(() => pollStatus(id), 10000);
      }
    } catch (e) {
      setStep("error");
      setErrorMsg(String(e));
    }
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, []);

  async function generate() {
    if (!imageFile || !audioFile) {
      setErrorMsg("Sobe a foto e o áudio antes de gerar.");
      return;
    }
    if (pollRef.current) clearTimeout(pollRef.current);

    setStep("submitting");
    setProgress("Comprimindo imagem...");
    setVideoUrl(null);
    setErrorMsg(null);
    setMeta(null);
    setJobId(null);
    setElapsed(0);

    let imgBlob: Blob;
    try {
      imgBlob = await compressImage(imageFile);
    } catch {
      imgBlob = imageFile;
    }

    setProgress("Enviando para o servidor...");

    const fd = new FormData();
    fd.append("image", imgBlob, "portrait.jpg");
    fd.append("audio", audioFile);
    fd.append("duration", String(duration));

    try {
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      const text = await res.text();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(text);
      } catch {
        setStep("error");
        setErrorMsg(`Erro do servidor: ${text.slice(0, 200)}`);
        return;
      }

      if (!res.ok) {
        setStep("error");
        setErrorMsg(String(data.error ?? `HTTP ${res.status}`));
        return;
      }

      const id = data.job_id as string;
      setJobId(id);
      setStep("polling");
      setProgress("Job enviado! Aguardando processamento...");
      startTimeRef.current = Date.now();
      pollRef.current = setTimeout(() => pollStatus(id), 5000);
    } catch (e) {
      setStep("error");
      setErrorMsg(String(e));
    }
  }

  function download() {
    if (!videoUrl) return;
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `talkinghead_${Date.now()}.mp4`;
    a.click();
  }

  const isLoading = step === "submitting" || step === "polling";
  const canGenerate = !!imageFile && !!audioFile && !isLoading;

  const progressPct = step === "polling"
    ? Math.min(95, (elapsed / (duration * 50)) * 100)
    : step === "done" ? 100 : 0;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      <header className="text-center mb-8">
        <h1 className="text-3xl font-bold text-indigo-700">
          Talking Head <span className="text-slate-400 text-xl font-normal">· EchoMimic V2</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Foto + áudio → vídeo realista de pessoa falando (até 30s)
        </p>
      </header>

      {/* Foto */}
      <section className="mb-5">
        <label className="block text-sm font-semibold mb-2 text-slate-700">
          1. Foto da pessoa (retrato frontal)
        </label>
        <div
          onClick={() => imgRef.current?.click()}
          className="border-2 border-dashed border-indigo-200 rounded-xl p-4 text-center cursor-pointer hover:bg-indigo-50 transition"
        >
          {imagePreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imagePreview} alt="preview" className="max-h-56 mx-auto rounded-lg" />
          ) : (
            <div className="text-slate-400 py-8">
              <div className="text-4xl mb-2">📷</div>
              Clique para escolher uma foto
              <div className="text-xs mt-1">JPG ou PNG · rosto frontal · redimensionado para 512px</div>
            </div>
          )}
          <input
            ref={imgRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => pickImage(e.target.files?.[0] ?? null)}
          />
        </div>
      </section>

      {/* Áudio */}
      <section className="mb-5">
        <label className="block text-sm font-semibold mb-2 text-slate-700">
          2. Áudio da fala
        </label>
        <div
          onClick={() => audRef.current?.click()}
          className="border-2 border-dashed border-indigo-200 rounded-xl p-4 text-center cursor-pointer hover:bg-indigo-50 transition"
        >
          {audioName ? (
            <div className="text-indigo-700 py-4 font-medium">
              <div className="text-3xl mb-1">🎵</div>
              {audioName}
              <div className="text-xs text-slate-400 mt-1">clique para trocar</div>
            </div>
          ) : (
            <div className="text-slate-400 py-8">
              <div className="text-4xl mb-2">🎤</div>
              Clique para escolher o áudio
              <div className="text-xs mt-1">WAV ou MP3 · até 20MB</div>
            </div>
          )}
          <input
            ref={audRef}
            type="file"
            accept="audio/wav,audio/mp3,audio/mpeg,audio/*"
            className="hidden"
            onChange={(e) => pickAudio(e.target.files?.[0] ?? null)}
          />
        </div>
      </section>

      {/* Duração */}
      <section className="mb-6">
        <label className="block text-sm font-semibold mb-2 text-slate-700">
          3. Duração: <span className="text-indigo-600">{duration}s</span>
        </label>
        <input
          type="range"
          min={3}
          max={30}
          value={duration}
          onChange={(e) => setDuration(Number(e.target.value))}
          className="w-full accent-indigo-600"
        />
        <div className="flex justify-between text-xs text-slate-400 mt-1">
          <span>3s (rápido)</span>
          <span>15s (padrão)</span>
          <span>30s (lento)</span>
        </div>
      </section>

      {/* Botão */}
      <button
        onClick={generate}
        disabled={!canGenerate}
        className="w-full bg-indigo-600 hover:bg-indigo-700 text-white py-4 rounded-xl font-semibold text-lg disabled:opacity-40 transition active:scale-[0.99]"
      >
        {isLoading ? "⏳ Gerando..." : "🎬 Gerar vídeo"}
      </button>

      {/* Progress bar */}
      {isLoading && (
        <div className="mt-4">
          <div className="w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-indigo-500 h-2 rounded-full transition-all duration-1000"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Status */}
      {(progress || errorMsg) && (
        <div className="mt-3 text-sm text-center px-2">
          {step === "error" ? (
            <span className="text-red-600">{errorMsg}</span>
          ) : (
            <span className="text-slate-600">
              {progress}
              {step === "polling" && elapsed > 0 && ` · ${elapsed}s`}
            </span>
          )}
        </div>
      )}

      {jobId && step === "polling" && (
        <div className="mt-1 text-center text-xs text-slate-400">
          Job ID: {jobId} · verificando a cada 10s
        </div>
      )}

      {/* Resultado */}
      {videoUrl && step === "done" && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold mb-3 text-slate-700">Vídeo gerado</h2>
          <video
            src={videoUrl}
            controls
            autoPlay
            loop
            className="w-full rounded-xl shadow-lg bg-black"
          />
          {meta && (
            <p className="text-xs text-slate-400 mt-2 text-center">
              {meta.frames} frames · {meta.duration_seconds.toFixed(1)}s · seed {meta.seed}
            </p>
          )}
          <button
            onClick={download}
            className="mt-3 w-full bg-slate-800 text-white py-3 rounded-xl font-semibold hover:bg-slate-900 transition"
          >
            ⬇️ Baixar MP4
          </button>
        </section>
      )}

      <footer className="mt-12 text-center text-xs text-slate-400">
        EchoMimic V2 · Ant Group · SaladCloud RTX 4090
      </footer>
    </main>
  );
}
