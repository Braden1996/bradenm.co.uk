/** Two independent seek lanes; callers publish only immutable bitmap snapshots. */
export function createVideoFrameDecoder(url: string, fps = 12) {
  const lifetime = new AbortController();
  const videos = [document.createElement("video"), document.createElement("video")];
  let destroyed = false;
  const ready = videos.map((video) => {
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";
    video.setAttribute("aria-hidden", "true");
    video.tabIndex = -1;
    // Safari continues servicing seeks while this element remains in the DOM.
    video.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.append(video);
    const loaded = waitFor(video, "loadeddata");
    void loaded.catch(() => {});
    video.src = url;
    video.load();
    return loaded;
  });

  function waitFor(video: HTMLVideoElement, eventName: string) {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener(eventName, done);
        video.removeEventListener("error", failed);
        lifetime.signal.removeEventListener("abort", aborted);
      };
      const done = () => {
        cleanup();
        resolve();
      };
      const failed = () => {
        cleanup();
        reject(new Error("Portrait video decode failed"));
      };
      const aborted = () => {
        cleanup();
        reject(new DOMException("Portrait decode cancelled", "AbortError"));
      };
      if (lifetime.signal.aborted) {
        aborted();
        return;
      }
      video.addEventListener(eventName, done, { once: true });
      video.addEventListener("error", failed, { once: true });
      lifetime.signal.addEventListener("abort", aborted, { once: true });
    });
  }

  return {
    async decode(frame: number, slot: number) {
      if (destroyed) throw new DOMException("Portrait decode cancelled", "AbortError");
      const video = videos[slot];
      if (!video || !Number.isInteger(frame) || frame < 0)
        throw new RangeError("Invalid decoder request");
      await ready[slot];
      const seconds = (frame + 0.5) / fps;
      if (Math.abs(video.currentTime - seconds) > 0.000001) {
        const sought = waitFor(video, "seeked");
        video.currentTime = seconds;
        await sought;
      }
      if (destroyed) throw new DOMException("Portrait decode cancelled", "AbortError");
      // createImageBitmap captures the decoded pixels now. Later seeks on this
      // video cannot modify an A/B texture waiting for its matching neighbour.
      const bitmap = await createImageBitmap(video);
      if (destroyed) {
        bitmap.close();
        throw new DOMException("Portrait decode cancelled", "AbortError");
      }
      return bitmap;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      lifetime.abort();
      for (const video of videos) {
        video.removeAttribute("src");
        video.load();
        video.remove();
      }
    },
  };
}
