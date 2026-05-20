"""
FastAPI server para EchoMimic V2 — Talking Head Generation
POST /generate  → {job_id}  (retorno imediato, inferência em background)
GET  /status/{job_id} → {status, progress, video}
"""

import os, sys, time, uuid, base64, tempfile, subprocess, logging, threading
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Dict, Any

import torch
import numpy as np
from fastapi import FastAPI, File, UploadFile, HTTPException, Form
from fastapi.responses import JSONResponse
from PIL import Image

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

MODEL_DIR = Path(os.environ.get("MODEL_DIR", "/app/models"))
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
pipeline = None

# Armazena jobs em memória (suficiente para uso single-replica)
jobs: Dict[str, Dict[str, Any]] = {}


def download_models():
    from huggingface_hub import snapshot_download

    local_dir = MODEL_DIR / "EchoMimicV2"
    if not local_dir.exists() or not any(local_dir.iterdir()):
        log.info("Baixando EchoMimic V2 (~8 GB)...")
        snapshot_download(
            repo_id="antgroup/EchoMimicV2",
            local_dir=str(local_dir),
            ignore_patterns=["*.md", "*.txt", ".git*"],
        )
        log.info("Download concluído.")
    else:
        log.info("Modelos já existem.")

    whisper_dir = MODEL_DIR / "whisper-tiny"
    if not whisper_dir.exists():
        log.info("Baixando Whisper tiny...")
        snapshot_download(repo_id="openai/whisper-tiny", local_dir=str(whisper_dir))
        log.info("Whisper pronto.")


def load_pipeline():
    global pipeline
    model_path = MODEL_DIR / "EchoMimicV2"
    whisper_path = MODEL_DIR / "whisper-tiny"
    log.info(f"Carregando EchoMimic V2 em {DEVICE}...")

    sys.path.insert(0, "/app/EchoMimicV2")
    from src.pipelines.pipeline_echomimic_v2 import EchoMimicV2Pipeline
    from src.models.unet_2d_condition import UNet2DConditionModel
    from src.models.unet_3d_echo import EchoUNet3DConditionModel
    from src.models.pose_encoder import PoseEncoder
    from diffusers import AutoencoderKL, DDIMScheduler
    from transformers import WhisperModel

    vae = AutoencoderKL.from_pretrained(
        "stabilityai/sd-vae-ft-mse", torch_dtype=torch.float16
    ).to(DEVICE)
    reference_unet = UNet2DConditionModel.from_pretrained(
        str(model_path / "reference_unet"), torch_dtype=torch.float16
    ).to(DEVICE)
    denoising_unet = EchoUNet3DConditionModel.from_pretrained(
        str(model_path / "denoising_unet"), torch_dtype=torch.float16
    ).to(DEVICE)
    pose_encoder = PoseEncoder(
        320, conditioning_channels=3, block_out_channels=(16, 32, 96, 256)
    ).to(dtype=torch.float16, device=DEVICE)
    pose_encoder.load_state_dict(
        torch.load(str(model_path / "pose_encoder.pth"), map_location=DEVICE)
    )
    audio_encoder = WhisperModel.from_pretrained(
        str(whisper_path), torch_dtype=torch.float16
    ).to(DEVICE)
    scheduler = DDIMScheduler(
        beta_end=0.012, beta_schedule="scaled_linear", beta_start=0.00085,
        clip_sample=False, num_train_timesteps=1000,
        set_alpha_to_one=False, steps_offset=1,
    )
    pipeline = EchoMimicV2Pipeline(
        vae=vae, reference_unet=reference_unet, denoising_unet=denoising_unet,
        pose_encoder=pose_encoder, scheduler=scheduler,
    )
    pipeline.enable_vae_slicing()
    log.info("Pipeline pronta.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    download_models()
    load_pipeline()
    yield


app = FastAPI(title="TalkingHead API", lifespan=lifespan)


@app.get("/health")
def health():
    return {"status": "ok", "device": DEVICE, "model": "EchoMimicV2"}


@app.get("/ready")
def ready():
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Model not ready")
    return {"ready": True}


def run_inference(job_id: str, img_bytes: bytes, aud_bytes: bytes,
                  width: int, height: int, fps: int, duration_seconds: int,
                  steps: int, cfg: float, seed: int):
    jobs[job_id]["status"] = "running"
    jobs[job_id]["progress"] = "Iniciando inferência..."
    tmp = Path(tempfile.mkdtemp())
    try:
        img_path = tmp / "input.png"
        raw_aud = tmp / "raw_audio"
        aud_path = tmp / "audio.wav"
        out_path = tmp / "output.mp4"

        img_path.write_bytes(img_bytes)
        raw_aud.write_bytes(aud_bytes)

        subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw_aud), "-ar", "16000", "-ac", "1", str(aud_path)],
            check=True, capture_output=True,
        )

        pil_image = Image.open(img_path).convert("RGB").resize((width, height))
        ref_image = np.array(pil_image)
        num_frames = fps * duration_seconds
        rng_seed = seed if seed >= 0 else int(time.time() * 1000) % (2**31)

        log.info(f"[{job_id}] Gerando {num_frames} frames, seed={rng_seed}")
        jobs[job_id]["progress"] = f"Gerando {num_frames} frames ({duration_seconds}s)..."
        t0 = time.time()

        with torch.inference_mode():
            video_frames = pipeline(
                ref_image_pil=pil_image,
                audio_path=str(aud_path),
                ref_image_np=ref_image,
                width=width, height=height,
                video_length=num_frames,
                num_inference_steps=steps,
                guidance_scale=cfg,
                generator=torch.manual_seed(rng_seed),
            ).videos[0]

        elapsed = time.time() - t0
        log.info(f"[{job_id}] Inferência em {elapsed:.1f}s")
        jobs[job_id]["progress"] = f"Codificando vídeo..."

        frames_dir = tmp / "frames"
        frames_dir.mkdir()
        video_np = (video_frames.permute(1, 2, 3, 0).cpu().numpy() * 255).astype(np.uint8)
        for i, frame in enumerate(video_np):
            Image.fromarray(frame).save(frames_dir / f"{i:06d}.png")

        subprocess.run(
            ["ffmpeg", "-y", "-framerate", str(fps),
             "-i", str(frames_dir / "%06d.png"),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", str(out_path)],
            check=True, capture_output=True,
        )

        video_b64 = base64.b64encode(out_path.read_bytes()).decode()
        jobs[job_id].update({
            "status": "done",
            "progress": f"Concluído em {elapsed:.0f}s",
            "video": video_b64,
            "frames": len(video_np),
            "fps": fps,
            "duration_seconds": len(video_np) / fps,
            "seed": rng_seed,
        })
    except Exception as e:
        log.exception(f"[{job_id}] Erro")
        jobs[job_id].update({"status": "error", "error": str(e)})
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


@app.post("/generate")
async def generate(
    image: UploadFile = File(...),
    audio: UploadFile = File(...),
    width: int = Form(512),
    height: int = Form(512),
    fps: int = Form(24),
    duration_seconds: int = Form(15),
    steps: int = Form(6),
    cfg: float = Form(2.5),
    seed: int = Form(-1),
):
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Model loading, try again in a few minutes")

    job_id = uuid.uuid4().hex
    img_bytes = await image.read()
    aud_bytes = await audio.read()

    jobs[job_id] = {"status": "pending", "progress": "Na fila...", "created_at": time.time()}

    t = threading.Thread(
        target=run_inference,
        args=(job_id, img_bytes, aud_bytes, width, height, fps, duration_seconds, steps, cfg, seed),
        daemon=True,
    )
    t.start()

    return JSONResponse({"job_id": job_id, "status": "pending"})


@app.get("/status/{job_id}")
def status(job_id: str):
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job não encontrado")

    resp: Dict[str, Any] = {
        "job_id": job_id,
        "status": job["status"],
        "progress": job.get("progress", ""),
    }
    if job["status"] == "done":
        resp.update({
            "video": job["video"],
            "frames": job["frames"],
            "fps": job["fps"],
            "duration_seconds": job["duration_seconds"],
            "seed": job["seed"],
        })
    elif job["status"] == "error":
        resp["error"] = job.get("error", "Erro desconhecido")

    return JSONResponse(resp)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 3000)))
