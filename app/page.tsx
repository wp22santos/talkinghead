"use client";

import { useState, useRef } from "react";

type Step = "idle" | "loading" | "done" | "error";

export default function Home() {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [audioName, setAudioName] = useState<string | null>(null);
  const [duration, setDuration] = useState(15);
  const [step, setStep] = useState<Step>("idle");
  const [progress, setProgress] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ frames: number; seed: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const imgRef = useRef<HTMLInputElement>(null);
  const audRef = useRef<HTMLInputElement>(null);

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

  async function generate() {
    if (!imageFile || !audioFile) {
      setErrorMsg("Sobe a foto e o áudio antes de gerar.");
      return;
    }
    setStep("loading");
    setProgress("Enviando para o servidor...");
    setVideoUrl(null);
    setErrorMsg(null);
    setMeta(null);

    const fd = new FormData();
    fd.append("image", imageFile);
    fd.append("audio", audioFile);
    fd.append("duration", String(duration));

    const timer = setInterval(() => {
      setProgress((p) => {
        const mins = p.match(/(\d+) min/);
        const n = mins ? Number(mins[1]) + 1 : 1;
        return `Gerando vídeo... ${n} min (EchoMimic V2 leva 8–15 min para 15s)`;
      });
    }, 60000);

    setTimeout(() => setProgress("Gerando vídeo... pode levar 8–15 min"), 2000);

    try {
      const res = await fetch("/api/generate", { method: "POST", body: fd });
      clearInterval(timer);
      const data = await res.json();
      if (!res.ok) {
        setStep("error");
        setErrorMsg(data.error ?? "Erro desconhecido");
        return;
      }
      setVideoUrl(data.video);
      setMeta({ frames: data.frames, seed: data.seed });
      setStep("done");
      setProgress(`Vídeo gerado! ${data.frames} frames, seed ${data.seed}`);
    } catch (e) {
      clearInterval(timer);
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

  const canGenerate = !!imageFile && !!audioFile && step !== "loading";

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
              <div className="text-xs mt-1">JPG ou PNG · rosto frontal · até 10MB</div>
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
        {step === "loading" ? "⏳ Gerando..." : "🎬 Gerar vídeo"}
      </button>

      {/* Status */}
      {(progress || errorMsg) && (
        <div className="mt-4 text-sm text-center px-2">
          {step === "error" ? (
            <span className="text-red-600">{errorMsg}</span>
          ) : (
            <span className="text-slate-600">{progress}</span>
          )}
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
              {meta.frames} frames · seed {meta.seed}
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
