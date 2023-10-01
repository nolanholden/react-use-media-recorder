# use-media-recorder

Headless React hooks for the [MediaStream Recording API](https://developer.mozilla.org/en-US/docs/Web/API/MediaStream_Recording_API) for audio, video, and screen recording.

## Features

- Simple API, minimal abstraction, no loss of configurability.
- Muting/unmuting of audio streams
- By default, auto-acquireß and auto-releases `MediaStream`s for ease-of-use
- Permits manual acquiring/releasing `MediaStream`s to reduce start/stop latency
- Use custom `MediaStream`s as input.
- Headless

## Installation

- `bun add @nolanholden/use-media-recorder`
- `pnpm add @nolanholden/use-media-recorder`
- `npm install @nolanholden/use-media-recorder`
- `yarn add @nolanholden/use-media-recorder`

## Example

```ts
export default function Page() {
  const [audioURL, setAudioURL] = useState("");
  const [transcription, setTranscription] = useState("");

  const {
    browserSupportError,
    error,
    // <idle|acquiring_media|ready|recording|paused|stopping|stopped|failed>
    status,
    isAudioMuted,
    startRecording,
    pauseRecording,
    resumeRecording,
    stopRecording,
    mediaBlob,
    clearMediaBlob,
    muteAudio,
    unmuteAudio,
    liveStream,

    // internals:
    activeMediaRecorder,
    acquireMediaStream,
    releaseMediaStream,
  } = useMediaRecorder({
    mediaStreamConstraints: {
      audio: true,
      video: false,
    },
    onStop: (audioBlob) => {
      if (!audioBlob) throw new Error("No audio to transcribe.");
      const blob = audioBlob;

      async function stop() {
        setAudioURL(URL.createObjectURL(blob));

        const formData = new FormData();
        formData.append("audio", blob, "my-audio-file");

        const res = await fetch("/api/transcribe", {
          method: "POST",
          body: formData,
        });
        if (!res.ok)
          throw new Error(`Error transcribing the audio: ${res.statusText}`);
        const data = (await res.json()) as unknown as {
          dictation_text: string;
        };
        if (typeof data.dictation_text !== "string")
          throw new Error(`Error parsing response: ${JSON.stringify(data)}`);
        return data.dictation_text;
      }

      stop()
        .then((text) => {
          setTranscription(text);
          copyToClipboard(text);
        })
        .catch((err: Error) => {
          console.error(err);
          alert("Error transcribing audio: " + err.message);
        });
    },
  });

  useEffect(() => {
    if (browserSupportError) {
      console.error(browserSupportError);
      alert(browserSupportError);
    }
  }, [browserSupportError]);


  const isRecording = status === "recording";

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording().catch((err) => {
        console.error(err);
      });
    }
  };

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <button
        disabled={!!error}
        onClick={toggleRecording}
        className="rounded-lg bg-blue-500 px-6 py-3 font-bold text-white hover:bg-blue-700"
      >
        {isRecording ? "Stop Recording" : "Start Recording"}
      </button>

      <p>{audioURL || "(blob url)"}</p>

      {audioURL && (
        <div className="flex justify-center">
        <audio src={audioURL} controls />
        </div>
      )}

      {transcription && (
        <div className="mt-3 flex flex-col items-center justify-center gap-2 pt-2">
          <p className="text-lg font-bold">Transcription:</p>
      
          <p className="pb-1 text-center text-sm text-slate-400">
            <em>(copied to clipboard)</em>
          </p>
      
          <div className="border-slate/20 w-full rounded-[8px] border p-2 text-sm">
            <p>{transcription}</p>
          </div>
        </div>
      )}
    </div>
  )
}
```
