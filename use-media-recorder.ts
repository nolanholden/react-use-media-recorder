import { useRef, useEffect, useState } from "react";

export type UseMediaRecorderArgs = {
  mediaStreamConstraints: MediaStreamConstraints;
  blobOptions?: BlobPropertyBag;
  recordScreen?: boolean;
  customMediaStream?: MediaStream;
  onStart?: () => void;
  onStop?: (mediaBlob: Blob | null) => void;
  onDataAvailable?: (partialMediaBlob: Blob) => void;
  onError?: (error: unknown) => void;
  mediaRecorderOptions?: MediaRecorderOptions;
};

export type UseMediaRecorderResult = {
  browserSupportError: string | null;
  error: unknown;
  status: MediaRecorderStatus;
  isAudioMuted: boolean;
  startRecording: (timeSlice?: number) => Promise<void>;
  pauseRecording: () => void;
  resumeRecording: () => void;
  stopRecording: () => void;
  mediaBlob: Blob | null;
  clearMediaBlob: () => void;
  muteAudio: () => void;
  unmuteAudio: () => void;
  liveStream: MediaStream | null;

  // internals:

  activeMediaRecorder: MediaRecorder | null;
  acquireMediaStream: () => Promise<MediaStream | null>;
  releaseMediaStream: () => void;
};

export type MediaRecorderStatus =
  | "idle"
  | "acquiring_media"
  | "ready"
  | "recording"
  | "paused"
  | "stopping"
  | "stopped"
  | "failed";

export function useMediaRecorder({
  mediaStreamConstraints,
  blobOptions,
  recordScreen,
  customMediaStream,
  onStop,
  onStart,
  onError,
  mediaRecorderOptions,
  onDataAvailable,
}: UseMediaRecorderArgs): UseMediaRecorderResult {
  const mediaChunks = useRef<Blob[]>([]);
  const mediaStream = useRef<MediaStream | null>(null);
  const mediaRecorder = useRef<MediaRecorder | null>(null);

  const [browserSupportError, setBrowserSupportError] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<MediaRecorderStatus>("idle");
  const [activeMediaRecorder, setActiveMediaRecorder] =
    useState<MediaRecorder | null>(null);
  const [mediaBlob, setMediaBlob] = useState<Blob | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);

  async function acquireMediaStream() {
    if (error) {
      setError(null);
    }

    setStatus("acquiring_media");

    if (customMediaStream && customMediaStream instanceof MediaStream) {
      mediaStream.current = customMediaStream;
      setStatus("ready");
      return customMediaStream;
    }

    try {
      const stream = await (async () => {
        if (recordScreen) {
          const stream = await window.navigator.mediaDevices.getDisplayMedia(
            mediaStreamConstraints,
          );
          if (mediaStreamConstraints.audio) {
            const audioStream =
              await window.navigator.mediaDevices.getUserMedia({
                audio: mediaStreamConstraints.audio,
              });
            audioStream.getAudioTracks().forEach((t) => stream.addTrack(t));
          }
          return stream;
        } else {
          return await window.navigator.mediaDevices.getUserMedia(
            mediaStreamConstraints,
          );
        }
      })();

      mediaStream.current = stream;
      setStatus("ready");

      return stream;
    } catch (err) {
      setError(err);
      setStatus("failed");
      return null;
    }
  }

  function releaseMediaStream() {
    if (mediaStream.current) {
      mediaStream.current.getTracks().forEach((track) => track.stop());
      mediaStream.current = null;
      setStatus("idle");
    }
  }

  function handleDataAvailable(e: BlobEvent) {
    if (e.data.size) {
      mediaChunks.current.push(e.data);
    }
    onDataAvailable?.(e.data);
  }

  function handleStop() {
    const blob = (function () {
      const chunks = mediaChunks.current;
      if (hasLengthAtLeast(chunks, 1)) {
        const [sampleChunk] = chunks;
        const blobPropertyBag: BlobPropertyBag = {
          type: sampleChunk.type,
          ...blobOptions,
        };
        return new Blob(chunks, blobPropertyBag);
      } else {
        return null;
      }
    })();

    setStatus("stopped");
    setMediaBlob(blob);
    onStop?.(blob);
  }

  function handleError(e: Event) {
    setError(e);
    setStatus("idle");
    onError?.(e);
  }

  function handleTryCatchStart(error: unknown) {
    setError(error);
    setStatus("idle");
    onError?.(error);
  }

  async function startRecording(timeSlice?: number) {
    if (error) {
      setError(null);
    }

    const stream = mediaStream.current ?? (await acquireMediaStream());
    mediaChunks.current = [];

    if (stream) {
      const rec = (mediaRecorder.current = new MediaRecorder(
        stream,
        mediaRecorderOptions,
      ));
      rec.addEventListener("dataavailable", handleDataAvailable);
      rec.addEventListener("stop", handleStop);
      rec.addEventListener("error", handleError);
      setActiveMediaRecorder(rec);

      try {
        rec.start(timeSlice);
        setStatus("recording");
        onStart?.();
      } catch (error) {
        handleTryCatchStart(error);
      }
    }
  }

  function muteAudio(mute: boolean) {
    mediaStream.current?.getAudioTracks().forEach((t) => {
      t.enabled = !mute;
    });
    setIsAudioMuted(mute);
  }

  function pauseRecording() {
    const rec = mediaRecorder.current;
    if (rec?.state === "recording") {
      rec.pause();
      setStatus("paused");
    }
  }

  function resumeRecording() {
    const rec = mediaRecorder.current;
    if (rec?.state === "paused") {
      rec.resume();
      setStatus("recording");
    }
  }

  function stopRecording() {
    const rec = mediaRecorder.current;
    if (rec) {
      setStatus("stopping");
      rec.stop();

      // not sure whether to place clean up in useEffect?
      // If placed in useEffect the handler functions become dependencies of useEffect
      rec.removeEventListener("dataavailable", handleDataAvailable);
      rec.removeEventListener("stop", handleStop);
      rec.removeEventListener("error", handleError);

      mediaRecorder.current = null;

      if (!customMediaStream) {
        releaseMediaStream();
      }
    }
  }

  useEffect(() => {
    if (!window.MediaRecorder) {
      setBrowserSupportError(
        "MediaRecorder is not supported in this browser. Please ensure that you are running the latest version of chrome/firefox/edge.",
      );
      return;
    }

    if (recordScreen && !window.navigator.mediaDevices.getDisplayMedia) {
      setBrowserSupportError("This browser does not support screen capturing.");
      return;
    }

    const md = navigator.mediaDevices;
    if (!md) {
      setBrowserSupportError(
        "The MediaDevices interface is not available on this browser.",
      );
      return;
    }
    if (!md.getSupportedConstraints) {
      setBrowserSupportError(
        "The MediaDevices.getSupportedConstraints() method is not available on this browser.",
      );
      return;
    }

    let supported: MediaTrackSupportedConstraints | null = null;

    if (isObject(mediaStreamConstraints.video)) {
      const error = ensureConstraintsSupported(
        (supported = supported ?? md.getSupportedConstraints()),
        mediaStreamConstraints.video,
      );
      if (error) {
        setBrowserSupportError(error);
        return;
      }
    }

    if (isObject(mediaStreamConstraints.audio)) {
      const error = ensureConstraintsSupported(
        (supported = supported ?? md.getSupportedConstraints()),
        mediaStreamConstraints.audio,
      );
      if (error) {
        setBrowserSupportError(error);
        return;
      }
    }

    if (mediaRecorderOptions?.mimeType) {
      if (!MediaRecorder.isTypeSupported(mediaRecorderOptions.mimeType)) {
        setBrowserSupportError(
          `The specified MIME type supplied to MediaRecorder is not supported by this browser.`,
        );
        return;
      }
    }
  }, [mediaStreamConstraints, mediaRecorderOptions, recordScreen]);

  const result: UseMediaRecorderResult = {
    browserSupportError,
    error,
    status,
    isAudioMuted,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    mediaBlob,
    clearMediaBlob: () => setMediaBlob(null),
    muteAudio: () => muteAudio(true),
    unmuteAudio: () => muteAudio(false),
    get liveStream() {
      const tracks = mediaStream.current?.getTracks();
      return tracks ? new MediaStream(tracks) : null;
    },

    activeMediaRecorder,
    acquireMediaStream,
    releaseMediaStream,
  };
  return result;
}

function isObject(o: unknown): o is Record<string, unknown> {
  return !!o && !Array.isArray(o) && Object(o) === o;
}

function ensureConstraintsSupported(
  supported: MediaTrackSupportedConstraints,
  requestedConstraints: MediaTrackConstraints,
): string | null {
  const unsupported: string[] = Object.keys(requestedConstraints).filter(
    (constraintName) => {
      const constraintIsSupported =
        supported[constraintName as keyof MediaTrackSupportedConstraints];
      return !constraintIsSupported;
    },
  );
  if (unsupported.length !== 0) {
    return `The following media constraints [${unsupported.join(
      ",",
    )}] are not supported on this browser.`;
  }
  return null;
}

type Indices<
  Length extends number,
  T extends number[] = [],
> = T["length"] extends Length
  ? T[number]
  : Indices<Length, [T["length"], ...T]>;

type LengthAtLeast<T extends readonly unknown[], L extends number> = Pick<
  Required<T>,
  Indices<L>
>;

function hasLengthAtLeast<T extends readonly unknown[], L extends number>(
  arr: T,
  len: L,
): arr is T & LengthAtLeast<T, L> {
  return arr.length >= len;
}
