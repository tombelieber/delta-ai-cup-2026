import { validVideoId } from './store.js';

// A stored or imported image URL is never trusted. Only a validated public
// video ID can select the fixed YouTube thumbnail host and image variant.
export function videoThumbnailUrl(videoId) {
  return validVideoId(videoId) ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null;
}

// Keep the existing status icon useful when a video image is unavailable.
// Hiding the failed image makes no additional request and retains its identity.
export function hideFailedVideoThumbnail(event) {
  const image = event?.currentTarget;
  if (image?.tagName !== 'IMG') return;
  image.hidden = true;
  const fallback = image.nextElementSibling;
  if (fallback?.classList?.contains('dlj-record-icon')) fallback.hidden = false;
}
