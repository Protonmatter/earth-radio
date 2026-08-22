// Radio-domain source registry. Plain JS so both the browser client and the Node proxy
// can import it. Registers radio directory source weights, labels, and trust tier into the
// domain-agnostic core source graph.
import { registerSourceTypes } from '../../core/sourceGraph.js';

export const RADIO_SOURCE_WEIGHTS = Object.freeze({
  'radio-browser': 0.52,
  'icecast-yp': 0.22,
  radioplayer: 0.7,
  shoutcast: 0.18
});

export const RADIO_SOURCE_LABELS = Object.freeze({
  'radio-browser': 'Radio Browser',
  'icecast-yp': 'Icecast/Xiph YP',
  radioplayer: 'Radioplayer',
  shoutcast: 'SHOUTcast'
});

export const RADIO_TRUSTED_SOURCES = Object.freeze(['radioplayer', 'radio-browser']);

registerSourceTypes({
  weights: RADIO_SOURCE_WEIGHTS,
  labels: RADIO_SOURCE_LABELS,
  trusted: RADIO_TRUSTED_SOURCES
});
