"""Isolated face-template service. Images are processed in memory and never persisted."""
import base64
import hmac
import os
import socket
from contextlib import contextmanager
from pathlib import Path
from threading import Lock
from urllib.parse import urlparse
from uuid import UUID

import cv2
import numpy as np
import psycopg
from cryptography.fernet import Fernet
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

MODEL = "opencv-sface-2021dec"
MODEL_DIR = Path(os.environ.get("MODEL_DIR", Path(__file__).parent / "models"))
TOKEN = os.environ["FACE_ENGINE_TOKEN"]
DATABASE_URL = os.environ["DATABASE_URL"]
CIPHER = Fernet(os.environ["FACE_TEMPLATE_KEY"].encode())
if len(TOKEN) < 32:
    raise RuntimeError("FACE_ENGINE_TOKEN must contain at least 32 characters")

detector = cv2.FaceDetectorYN.create(str(MODEL_DIR / "yunet.onnx"), "", (320, 320), 0.75, 0.3, 5000)
recognizer = cv2.FaceRecognizerSF.create(str(MODEL_DIR / "sface.onnx"), "")
model_lock = Lock()
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


class FaceRequest(BaseModel):
    eventId: UUID
    imageBase64: str = Field(min_length=16, max_length=2_000_000)


class EnrollRequest(FaceRequest):
    guestId: UUID


@contextmanager
def connection():
    hostname = urlparse(DATABASE_URL).hostname
    if not hostname:
        raise RuntimeError("DATABASE_URL has no hostname")
    ipv4 = socket.getaddrinfo(hostname, 5432, family=socket.AF_INET, type=socket.SOCK_STREAM)[0][4][0]
    with psycopg.connect(DATABASE_URL, hostaddr=ipv4, sslmode="require", autocommit=True) as conn:
        yield conn


def authorize(authorization: str | None):
    if not authorization or not hmac.compare_digest(authorization, "Bearer " + TOKEN):
        raise HTTPException(401, "unauthorized")


def extract(image_base64: str) -> np.ndarray:
    try:
        data = base64.b64decode(image_base64, validate=True)
    except ValueError as exc:
        raise HTTPException(422, "invalid_image") from exc
    if len(data) > 1_500_000:
        raise HTTPException(413, "image_too_large")
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None or min(image.shape[:2]) < 240:
        raise HTTPException(422, "image_too_small")
    height, width = image.shape[:2]
    if max(width, height) > 1600:
        scale = 1600 / max(width, height)
        image = cv2.resize(image, (round(width * scale), round(height * scale)))
    detection_scale = min(1.0, 640 / max(image.shape[:2]))
    detection_image = (cv2.resize(image, (round(image.shape[1] * detection_scale),
                                          round(image.shape[0] * detection_scale)))
                       if detection_scale < 1 else image)
    with model_lock:
        detector.setInputSize((detection_image.shape[1], detection_image.shape[0]))
        _, faces = detector.detect(detection_image)
        if (faces is None or len(faces) == 0) and detection_scale < 1:
            detector.setInputSize((image.shape[1], image.shape[0]))
            _, faces = detector.detect(image)
            detection_scale = 1.0
        if faces is None or len(faces) == 0:
            raise HTTPException(422, "face_not_found")
        if len(faces) > 1:
            raise HTTPException(422, "multiple_faces")
        face = faces[0].copy()
        face[:14] /= detection_scale
        if min(face[2], face[3]) < 100:
            raise HTTPException(422, "face_too_small")
        aligned = recognizer.alignCrop(image, face)
        feature = recognizer.feature(aligned).flatten().astype(np.float32)
    feature /= np.linalg.norm(feature)
    return feature


@app.get("/health")
def health():
    with connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok", "model": MODEL}


@app.post("/v1/enroll")
def enroll(payload: EnrollRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    feature = extract(payload.imageBase64)
    with connection() as conn:
        row = conn.execute("SELECT id, face_profile_id FROM guests WHERE id = %s AND event_id = %s", (payload.guestId, payload.eventId)).fetchone()
        if not row:
            raise HTTPException(404, "guest_not_found")
        if row[1]:
            return {"profileId": row[1]}
        existing = conn.execute("SELECT id FROM face_profiles WHERE guest_id = %s", (payload.guestId,)).fetchone()
        if existing:
            return {"profileId": str(existing[0])}
        encrypted = CIPHER.encrypt(feature.tobytes())
        profile_id = conn.execute(
            "INSERT INTO face_profiles (guest_id, embedding_ciphertext, model) VALUES (%s, %s, %s) RETURNING id",
            (payload.guestId, encrypted, MODEL),
        ).fetchone()[0]
    return {"profileId": str(profile_id)}


@app.post("/v1/identify")
def identify(payload: FaceRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    query = extract(payload.imageBase64)
    with connection() as conn:
        rows = conn.execute(
            """SELECT g.id, p.embedding_ciphertext FROM guests g
                 JOIN face_profiles p ON p.id::text = g.face_profile_id
                WHERE g.event_id = %s AND g.invitation_status IN ('accepted', 'attended') AND p.model = %s""",
            (payload.eventId, MODEL),
        ).fetchall()
    scores = []
    for guest_id, encrypted in rows:
        template = np.frombuffer(CIPHER.decrypt(bytes(encrypted)), dtype=np.float32)
        scores.append((float(np.dot(query, template)), str(guest_id)))
    scores.sort(reverse=True)
    if not scores or scores[0][0] < 0.45:
        return {"status": "no_match"}
    if scores[0][0] < 0.55 or (len(scores) > 1 and scores[0][0] - scores[1][0] < 0.08):
        return {"status": "review"}
    return {"status": "match", "guestId": scores[0][1], "confidence": min(1.0, max(0.0, scores[0][0]))}
