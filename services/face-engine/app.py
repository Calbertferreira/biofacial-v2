"""Shared facial profile with event-scoped invitation and access checks."""
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


def extract(image_base64: str) -> tuple[np.ndarray, np.ndarray]:
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
    return feature, image


def ranked_profiles(conn, feature: np.ndarray):
    rows = conn.execute(
        "SELECT id, embedding_ciphertext FROM person_face_profiles WHERE model = %s",
        (MODEL,),
    ).fetchall()
    scores = []
    for profile_id, encrypted in rows:
        template = np.frombuffer(CIPHER.decrypt(bytes(encrypted)), dtype=np.float32)
        if template.shape != feature.shape:
            continue
        scores.append((float(np.dot(feature, template)), profile_id))
    scores.sort(key=lambda item: item[0], reverse=True)
    return scores


@app.get("/health")
def health():
    with connection() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok", "model": MODEL}


@app.post("/v1/enroll")  # Compatibilidade durante a atualização da API.
@app.post("/v1/verify-or-enroll")
def verify_or_enroll(payload: EnrollRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    feature, image = extract(payload.imageBase64)
    with connection() as conn:
        with conn.transaction():
            # Serializa a criação/associação de contatos, inclusive em convites simultâneos.
            conn.execute("SELECT pg_advisory_xact_lock(hashtext('biofacial_face_enrollment'))")
            guest = conn.execute(
                """SELECT email, phone_e164, person_face_id FROM guests
                    WHERE id = %s AND event_id = %s AND deleted_at IS NULL FOR UPDATE""",
                (payload.guestId, payload.eventId),
            ).fetchone()
            if not guest:
                raise HTTPException(404, "guest_not_found")
            email, phone, current_profile_id = guest
            matches = conn.execute(
                """SELECT DISTINCT profile_id FROM person_face_contacts
                    WHERE (kind = 'email' AND value = lower(%s))
                       OR (kind = 'phone' AND value = %s)""",
                (email, phone),
            ).fetchall()
            profile_ids = {row[0] for row in matches}
            if current_profile_id:
                profile_ids.add(current_profile_id)
            if len(profile_ids) > 1:
                raise HTTPException(409, "identity_conflict")
            profile_id = next(iter(profile_ids), None)
            ranked = ranked_profiles(conn, feature)
            closest = ranked[0] if ranked else None
            if profile_id:
                stored = conn.execute(
                    "SELECT embedding_ciphertext, model FROM person_face_profiles WHERE id = %s FOR UPDATE",
                    (profile_id,),
                ).fetchone()
                if not stored or stored[1] != MODEL:
                    raise HTTPException(409, "face_model_mismatch")
                template = np.frombuffer(CIPHER.decrypt(bytes(stored[0])), dtype=np.float32)
                if float(np.dot(feature, template)) < 0.55:
                    raise HTTPException(409, "face_mismatch")
                if closest and closest[1] != profile_id and closest[0] >= 0.55:
                    raise HTTPException(409, "identity_conflict")
                result = "matched"
            else:
                if closest and closest[0] >= 0.55:
                    if len(ranked) > 1 and closest[0] - ranked[1][0] < 0.08:
                        raise HTTPException(409, "face_review_required")
                    profile_id = closest[1]
                    result = "matched"
                elif closest and closest[0] >= 0.45:
                    raise HTTPException(409, "face_review_required")
                else:
                    encoded, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, 85])
                    if not encoded:
                        raise HTTPException(422, "invalid_image")
                    profile_id = conn.execute(
                        """INSERT INTO person_face_profiles (embedding_ciphertext, image_ciphertext, model)
                           VALUES (%s, %s, %s) RETURNING id""",
                        (CIPHER.encrypt(feature.tobytes()), CIPHER.encrypt(jpeg.tobytes()), MODEL),
                    ).fetchone()[0]
                    result = "enrolled"
            duplicate = conn.execute(
                """SELECT 1 FROM guests WHERE event_id = %s AND id <> %s
                   AND person_face_id = %s AND deleted_at IS NULL
                   AND invitation_status IN ('accepted', 'attended') LIMIT 1""",
                (payload.eventId, payload.guestId, profile_id),
            ).fetchone()
            if duplicate:
                raise HTTPException(409, "face_already_registered_for_event")
            for kind, value in (("email", email.lower() if email else None), ("phone", phone)):
                if value:
                    conn.execute(
                        """INSERT INTO person_face_contacts (kind, value, profile_id)
                           VALUES (%s, %s, %s) ON CONFLICT (kind, value) DO NOTHING""",
                        (kind, value, profile_id),
                    )
            conn.execute("UPDATE guests SET person_face_id = %s WHERE id = %s", (profile_id, payload.guestId))
    return {"profileId": str(profile_id), "result": result}


@app.post("/v1/identify")
def identify(payload: FaceRequest, authorization: str | None = Header(default=None)):
    authorize(authorization)
    query, _ = extract(payload.imageBase64)
    with connection() as conn:
        scores = ranked_profiles(conn, query)
    if not scores or scores[0][0] < 0.45:
        return {"status": "no_match"}
    if scores[0][0] < 0.55 or (len(scores) > 1 and scores[0][0] - scores[1][0] < 0.08):
        return {"status": "review"}
    return {"status": "match", "profileId": str(scores[0][1]), "confidence": min(1.0, max(0.0, scores[0][0]))}
