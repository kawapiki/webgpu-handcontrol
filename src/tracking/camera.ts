/**
 * Webcam wrapper. Requests user media, attaches the stream to the <video>
 * element, and resolves once the video has real dimensions (so MediaPipe
 * doesn't get a 0×0 frame on the first inference call).
 */

export interface CameraInit {
  videoEl: HTMLVideoElement;
  width: number;
  height: number;
  facingMode?: 'user' | 'environment';
}

export interface CameraResult {
  stream: MediaStream;
  width: number;
  height: number;
}

export async function startCamera({ videoEl, width, height, facingMode = 'user' }: CameraInit): Promise<CameraResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia is not available in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode,
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 60, max: 60 },
    },
  });

  videoEl.srcObject = stream;
  await videoEl.play();

  // Wait for the first frame with non-zero dimensions.
  await new Promise<void>((resolve) => {
    const check = () => {
      if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
        resolve();
      } else {
        requestAnimationFrame(check);
      }
    };
    check();
  });

  return { stream, width: videoEl.videoWidth, height: videoEl.videoHeight };
}
