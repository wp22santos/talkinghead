"""
FastAPI server para EchoMimic V2 — Talking Head Generation
Aceita: imagem (retrato) + áudio (fala) → vídeo MP4 base64
"""

import os
import sys
import time
import uuid
import base64
import tempfile
import subprocess
import logging
from pathlib import Path
from contextlib import asynccontextmanager

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


def download_models():
    """Baixa modelos EchoMimic V2 do HuggingFace se não existirem."""
    from huggingface_hub import snapshot_download

    model_id = "antgroup/EchoMimicV2"
    local_dir = MODEL_DIR / "EchoMimicV2"

    if not local_dir.exists() or not any(local_dir.iterdir()):
        log.info("Baixando EchoMimic V2 (~8 GB)...")
        snapshot_download(
            repo_id=model_id,
            local_dir=str(local_dir),
            ignore_patterns=["*.md", "*.txt", ".git*"],
        )
        log.info("Download concluído.")
    else:
        log.info("Modelos já existem, pulando download.")

    # Whisper tiny (para encoder de áudio)
    whisper_dir = MODEL_DIR / "whisper-tiny"
    if not whisper_dir.exists():
        log.info("Baixando Whisper tiny...")
        from huggingface_hub import snapshot_download
        snapshot_download(
            repo_id="openai/whisper-tiny",
            local_dir=str(whisper_dir),
        )
        log.info("Whisper pronto.")


def load_pipeline():
    global pipeline

    model_path = MODEL_DIR / "EchoMimicV2"
    whisper_path = MODEL_DIR / "whisper-tiny"

    log.info(f"Carregando EchoMimic V2 de {model_path} em {DEVICE}...")

    # Importa após download para evitar erro no build
    sys.path.insert(0, "/app/EchoMimicV2")
    from src.pipelines.pipeline_echomimic_v2 import EchoMimicV2Pipeline
    from src.models.unet_2d_condition import UNet2DConditionModel
    from src.models.unet_3d_echo import EchoUNet3DConditionModel
    from src.models.pose_encoder import PoseEncoder
    from diffusers import AutoencoderKL, DDIMScheduler
    from transformers import WhisperModel

    # VAE
    vae = AutoencoderKL.from_pretrained(
        "stabilityai/sd-vae-ft-mse", torch_dtype=torch.float16
    ).to(DEVICE)

    # Reference UNet
    reference_unet = UNet2DConditionModel.from_pretrained(
        str(model_path / "reference_unet"),
        torch_dtype=torch.float16,
    ).to(DEVICE)

    # Denoising UNet
    denoising_unet = EchoUNet3DConditionModel.from_pretrained(
        str(model_path / "denoising_unet"),
        torch_dtype=torch.float16,
    ).to(DEVICE)

    # Pose Encoder
    pose_encoder = PoseEncoder(
        320, conditioning_channels=3, block_out_channels=(16, 32, 96, 256)
    ).to(dtype=torch.float16, device=DEVICE)
    pose_encoder.load_state_dict(
        torch.load(str(model_path / "pose_encoder.pth"), map_location=DEVICE)
    )

    # Whisper
    audio_encoder = WhisperModel.from_pretrained(
        str(whisper_path), torch_dtype=torch.float16
    ).to(DEVICE)

    # Scheduler
    scheduler = DDIMScheduler(
        beta_end=0.012,
        beta_schedule="scaled_linear",
        beta_start=0.00085,
        clip_sample=False,
        num_train_timesteps=1000,
        set_alpha_to_one=False,
        steps_offset=1,
    )

    pipeline = EchoMimicV2Pipeline(
        vae=vae,
        reference_unet=reference_unet,
        denoising_unet=denoising_unet,
        pose_encoder=pose_encoder,
        scheduler=scheduler,
    )
    pipeline.enable_vae_slicing()

    log.info("Pipeline EchoMimic V2 pronta.")


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


@app.post("/generate")
async def generate(
    image: UploadFile = File(..., description="Foto da pessoa (JPG/PNG)"),
    audio: UploadFile = File(..., description="Áudio da fala (WAV/MP3)"),
    width: int = Form(512),
    height: int = Form(512),
    fps: int = Form(24),
    duration_seconds: int = Form(15),
    steps: int = Form(6),
    cfg: float = Form(2.5),
    seed: int = Form(-1),
):
    if pipeline is None:
        raise HTTPException(status_code=503, detail="Model loading, try again")

    tmp = Path(tempfile.mkdtemp())
    try:
        # Salva arquivos de entrada
        img_path = tmp / f"input_{uuid.uuid4().hex}.png"
        aud_path = tmp / f"audio_{uuid.uuid4().hex}.wav"
        out_path = tmp / f"output_{uuid.uuid4().hex}.mp4"

        img_bytes = await image.read()
        with open(img_path, "wb") as f:
            f.write(img_bytes)

        aud_bytes = await audio.read()
        raw_aud = tmp / "raw_audio"
        with open(raw_aud, "wb") as f:
            f.write(aud_bytes)

        # Converte áudio para WAV 16kHz mono (ffmpeg)
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(raw_aud), "-ar", "16000", "-ac", "1", str(aud_path)],
            check=True,
            capture_output=True,
        )

        # Carrega imagem
        pil_image = Image.open(img_path).convert("RGB").resize((width, height))
        ref_image = np.array(pil_image)

        num_frames = fps * duration_seconds
        rng_seed = seed if seed >= 0 else int(time.time() * 1000) % (2**31)

        log.info(f"Gerando {num_frames} frames ({duration_seconds}s @ {fps}fps) seed={rng_seed}")
        t0 = time.time()

        with torch.inference_mode():
            video_frames = pipeline(
                ref_image_pil=pil_image,
                audio_path=str(aud_path),
                ref_image_np=ref_image,
                width=width,
                height=height,
                video_length=num_frames,
                num_inference_steps=steps,
                guidance_scale=cfg,
                generator=torch.manual_seed(rng_seed),
            ).videos[0]  # (C, T, H, W) float [0,1]

        log.info(f"Inferência concluída em {time.time()-t0:.1f}s")

        # Converte frames para MP4 via ffmpeg
        frames_dir = tmp / "frames"
        frames_dir.mkdir()
        video_np = (video_frames.permute(1, 2, 3, 0).cpu().numpy() * 255).astype(np.uint8)
        for i, frame in enumerate(video_np):
            Image.fromarray(frame).save(frames_dir / f"{i:06d}.png")

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-framerate", str(fps),
                "-i", str(frames_dir / "%06d.png"),
                "-c:v", "libx264",
                "-pix_fmt", "yuv420p",
                "-crf", "23",
                str(out_path),
            ],
            check=True,
            capture_output=True,
        )

        video_b64 = base64.b64encode(out_path.read_bytes()).decode()
        duration_actual = len(video_np) / fps

        return JSONResponse({
            "video": video_b64,
            "format": "mp4",
            "frames": len(video_np),
            "fps": fps,
            "duration_seconds": duration_actual,
            "width": width,
            "height": height,
            "seed": rng_seed,
        })

    except subprocess.CalledProcessError as e:
        log.error(f"ffmpeg error: {e.stderr.decode()}")
        raise HTTPException(status_code=500, detail=f"ffmpeg error: {e.stderr.decode()[:300]}")
    except Exception as e:
        log.exception("Erro na geração")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        import shutil
        shutil.rmtree(tmp, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("PORT", 3000)))
