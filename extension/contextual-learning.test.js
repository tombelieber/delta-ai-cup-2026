import test from 'node:test';
import assert from 'node:assert/strict';
import { canOfferLearning, shouldSuggestLearning } from './contextual-learning.js';

const pilot = { videoId: 'dI8w0utjUc0', loading: false };

test('a user can request caption-based learning for any valid current YouTube video', () => {
  for (const videoId of ['dI8w0utjUc0','733mgqrzNKs','DiVPAjgmnj0','rXVR-nE2jvw','jNQXAC9IVRw','abcdefghijk']) {
    assert.equal(canOfferLearning(videoId), true);
    assert.equal(shouldSuggestLearning({ videoId, loading: false }), true);
  }
  for (const videoId of [undefined,null,'','invalid','https://evil.test/','abcdefghijkl']) {
    assert.equal(canOfferLearning(videoId), false);
    assert.equal(shouldSuggestLearning({ videoId }), false);
  }
});

test('learning entry needs no playback or profile and makes no content-availability claim', () => {
  assert.equal(shouldSuggestLearning({ ...pilot, currentTime: 0, ranges: [], profile: null }), true);
  assert.equal(shouldSuggestLearning({ ...pilot, recordingEnabled: false }), true);
  assert.equal(shouldSuggestLearning({ videoId: 'jNQXAC9IVRw', title: 'Entertainment', imported: true }), true);
});

test('loading, dismissal, and existing enrollment suppress only the in-page suggestion', () => {
  assert.equal(shouldSuggestLearning({ ...pilot, loading: true }), false);
  assert.equal(shouldSuggestLearning({ ...pilot, learningDismissed: true }), false);
  assert.equal(shouldSuggestLearning({ ...pilot, learningEnrolled: true }), false);
  assert.equal(shouldSuggestLearning({ ...pilot, learningDismissed: false, learningEnrolled: false }), true);
});
