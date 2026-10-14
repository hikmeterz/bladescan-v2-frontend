import { $ } from '../lib/dom.js';

// Live camera preview: fetches JPEG frames (~10/s) while the camera reports a
// ready preview for the current inspection; hides the image when it goes stale.
export function createPreview(session) {
  const image = $('camera-feed'), empty = $('camera-empty');
  let url = null, seen = 0, controller = null, timer = null;

  function hide() {
    image.hidden = true;
    empty.hidden = false;
    image.removeAttribute('src');
    if (url) URL.revokeObjectURL(url);
    url = null;
    seen = 0;
  }

  const allowed = (id, epoch) => session.alive && epoch === session.revision && session.cameraFresh()
    && session.camera?.inspection_id === id && session.camera.preview_ready && session.camera.state === 'recording';

  async function loop() {
    const camera = session.camera;
    const id = session.cameraFresh() && camera?.preview_ready ? camera.inspection_id : null;
    if (id) {
      const epoch = session.revision;
      controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch('/api/camera/frame.jpg?inspection_id=' + encodeURIComponent(id),
          { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Could not retrieve the image.');
        const blob = await response.blob();
        if (allowed(id, epoch)) {
          const next = URL.createObjectURL(blob);
          const decoder = new Image();
          decoder.src = next;
          try { await decoder.decode(); } catch (error) { URL.revokeObjectURL(next); throw error; }
          if (!allowed(id, epoch)) {
            URL.revokeObjectURL(next);
          } else {
            const previous = url;
            url = next;
            seen = performance.now();
            image.src = next;
            image.hidden = false;
            empty.hidden = true;
            if (previous) URL.revokeObjectURL(previous);
          }
        }
      } catch {
        if (!seen || performance.now() - seen > 2000) hide();
      } finally {
        clearTimeout(abortTimer);
        controller = null;
      }
    }
    if (session.alive) timer = setTimeout(loop, 100);
  }

  return {
    start: loop,
    // Called on every render: drop the image when the camera stops or frames stall.
    check() {
      const c = session.camera;
      if (!session.cameraFresh() || !c?.preview_ready || c.state !== 'recording'
          || (seen && performance.now() - seen > 2000)) hide();
    },
    stop() { clearTimeout(timer); controller?.abort(); hide(); },
  };
}
