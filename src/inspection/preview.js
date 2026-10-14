import { $ } from '../lib/dom.js';

// Live view in the main stage. Source 'insta360' shows the inspection camera's
// preview while it records; source 'webcam' shows the USB webcam. Frames are
// fetched one at a time (~10/s); the image is hidden when it goes stale.
const SOURCES = {
  insta360: {
    url: session => {
      const c = session.camera;
      return session.cameraFresh() && c?.preview_ready ? '/api/camera/frame.jpg?inspection_id=' + encodeURIComponent(c.inspection_id) : null;
    },
    valid: (session, url) => session.cameraFresh() && session.camera?.preview_ready && session.camera.state === 'recording'
      && url.endsWith(encodeURIComponent(session.camera.inspection_id)),
  },
  webcam: {
    url: () => '/api/webcam/frame.jpg',
    valid: () => true,
  },
};

export function createPreview(session) {
  const image = $('camera-feed'), empty = $('camera-empty');
  let source = 'insta360', url = null, seen = 0, controller = null, timer = null;
  image.dataset.source = source;

  function hide() {
    image.hidden = true;
    empty.hidden = false;
    image.removeAttribute('src');
    if (url) URL.revokeObjectURL(url);
    url = null;
    seen = 0;
  }

  session.addEventListener('camera-source-change', event => {
    if (!SOURCES[event.detail] || event.detail === source) return;
    source = event.detail;
    image.dataset.source = source;
    controller?.abort();
    hide();
  });

  async function loop() {
    const current = source, frameUrl = SOURCES[current].url(session);
    const allowed = epoch => session.alive && epoch === session.revision && source === current
      && SOURCES[current].valid(session, frameUrl);
    if (frameUrl) {
      const epoch = session.revision;
      controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), 1500);
      try {
        const response = await fetch(frameUrl, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Could not retrieve the image.');
        const blob = await response.blob();
        if (allowed(epoch)) {
          const next = URL.createObjectURL(blob);
          const decoder = new Image();
          decoder.src = next;
          try { await decoder.decode(); } catch (error) { URL.revokeObjectURL(next); throw error; }
          if (!allowed(epoch)) {
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
    source: () => source,
    // Called on every render: drop the image when its source stops or frames stall.
    check() {
      const stalled = seen && performance.now() - seen > 2000;
      if (source === 'webcam') { if (stalled) hide(); return; }
      const c = session.camera;
      if (!session.cameraFresh() || !c?.preview_ready || c.state !== 'recording' || stalled) hide();
    },
    stop() { clearTimeout(timer); controller?.abort(); hide(); },
  };
}
