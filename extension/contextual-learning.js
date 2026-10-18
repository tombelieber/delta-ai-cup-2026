import { validVideoId } from './store.js';

// This opt-in entry asks Delta to inspect captions. It does not assert that a
// video teaches a skill, has usable captions or already has a prepared lesson.
export const canOfferLearning = videoId => validVideoId(videoId);

export function shouldSuggestLearning(view = {}) {
  return canOfferLearning(view?.videoId)
    && view.loading !== true
    && !view.learningDismissed
    && !view.learningEnrolled;
}
