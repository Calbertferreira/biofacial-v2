FROM python:3.11-slim
WORKDIR /service
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
RUN mkdir -p /service/models && python - <<'PY'
from urllib.request import urlretrieve
from hashlib import sha256
base = 'https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/'
for name, path, digest in [
    ('yunet.onnx', 'face_detection_yunet/face_detection_yunet_2023mar.onnx', '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4'),
    ('sface.onnx', 'face_recognition_sface/face_recognition_sface_2021dec.onnx', '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79'),
]:
    target = '/service/models/' + name
    urlretrieve(base + path, target)
    with open(target, 'rb') as model:
        assert sha256(model.read()).hexdigest() == digest, name + ' hash mismatch'
PY
ENV MODEL_DIR=/service/models
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1"]
