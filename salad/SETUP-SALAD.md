# Setup — Talking Head no SaladCloud

## O que é

Container FastAPI + EchoMimic V2 no SaladCloud.
Recebe foto + áudio → devolve vídeo MP4 de pessoa falando (15s).

---

## Passo 1 — Build e push do Docker

```bash
# No terminal, na pasta web/talkinghead/salad/
docker build -t SEU_USUARIO_DOCKERHUB/talkinghead:latest .
docker push SEU_USUARIO_DOCKERHUB/talkinghead:latest
```

Primeira build: ~20 min (baixa PyTorch + deps).
Imagem final: ~12 GB.

> Alternativa: usar GitHub Actions para CI/CD automático.

---

## Passo 2 — Cria Container Group no SaladCloud

Portal: https://portal.salad.com
Organização: `artesanildo` → **Container Groups** → **Deploy** → **Custom Container**

### Imagem
```
Image Source: Docker Hub (Public)
Image Name:   SEU_USUARIO_DOCKERHUB/talkinghead:latest
```

### Recursos
```
CPU:     4 vCPU
RAM:     16 GB
GPU:     NVIDIA RTX 4090 24GB   ← obrigatório (EchoMimic precisa de 8GB+ VRAM)
Replicas:
  Min:   0  (desliga quando idle — paga só quando usar)
  Max:   1
Storage: 30 GB  ← modelos ficam em cache no disco
```

### Environment Variables
| Nome | Valor |
|------|-------|
| `PORT` | `3000` |
| `MODEL_DIR` | `/app/models` |
| `HF_TOKEN` | seu token do HuggingFace (se modelos privados) |

### Networking
```
Container Gateway: ENABLED
Port: 3000
Authentication: DISABLED (habilita depois com Bearer Token)
```

### Health Checks
```
Startup Probe:   GET /ready  port=3000  initialDelay=300s  period=15s  failures=40
Readiness Probe: GET /ready  port=3000  initialDelay=60s   period=15s  failures=20
Liveness Probe:  GET /health port=3000  initialDelay=120s  period=30s  failures=5
```

> initialDelay alto porque o container baixa ~10 GB de modelos no primeiro boot.
> Do segundo boot em diante (modelos em disco): ~30s para ficar pronto.

---

## Passo 3 — Deploy e aguardar

Clica **Deploy**. Monitora os logs no portal.

Sequência esperada:
1. Container pull da imagem (~5 min)
2. Download modelos EchoMimic V2 (~10 min, ~8 GB)
3. Download Whisper tiny (~500 MB)
4. `Pipeline EchoMimic V2 pronta.` aparece nos logs
5. Status muda para **Running**

URL pública aparece no card. Exemplo:
```
https://talkinghead-xxxxxxxxxxxx.salad.cloud
```

---

## Passo 4 — Testar

```bash
# Health check
curl https://talkinghead-xxxxxxxxxxxx.salad.cloud/health
# {"status":"ok","device":"cuda","model":"EchoMimicV2"}

# Readiness
curl https://talkinghead-xxxxxxxxxxxx.salad.cloud/ready
# {"ready":true}

# Gerar vídeo (substitui pelos seus arquivos)
curl -X POST https://talkinghead-xxxxxxxxxxxx.salad.cloud/generate \
  -F "image=@foto.jpg" \
  -F "audio=@fala.wav" \
  -F "width=512" \
  -F "height=512" \
  -F "duration_seconds=15" \
  -F "fps=24" \
  -o response.json

# Extrair vídeo do JSON
python3 -c "
import json, base64
r = json.load(open('response.json'))
open('output.mp4', 'wb').write(base64.b64decode(r['video']))
print('Vídeo salvo em output.mp4')
"
```

---

## Passo 5 — Configurar no Vercel

No projeto **talkinghead** no Vercel:
```
Settings → Environment Variables
TALKINGHEAD_ENDPOINT_URL = https://talkinghead-xxxxxxxxxxxx.salad.cloud
TALKINGHEAD_AUTH_TOKEN   = (só se ativar auth)
```

---

## Custo

| Cenário | $/hora | Por vídeo 15s |
|---------|--------|---------------|
| Min=0, Max=1 (só quando usar) | $0.30 × tempo ativo | ~$0.05–0.08 |
| Min=1 (sempre ligado) | $0.30 fixo | ~$0.0012 em escala |

Com Min=0: a GPU desliga quando idle. Cold start = ~30s (modelos em cache).

---

## Troubleshooting

**OOM (Out of Memory):** Reduce `width/height` para 512×512, `steps` para 6.

**Container não sobe:** Verifica logs. Se `ModuleNotFoundError`: o git clone do EchoMimicV2 falhou. Rebuild a imagem.

**Geração muito lenta (>20 min para 15s):** Normal no primeiro run (CPU offload). Segundo run é mais rápido com modelos em VRAM cache.

**Audio error:** Certifica que o arquivo de entrada é WAV ou MP3. O servidor converte para 16kHz mono automaticamente via ffmpeg.
