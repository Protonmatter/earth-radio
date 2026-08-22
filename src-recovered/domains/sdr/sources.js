// SDR-domain source registry (engine-seam proof). Registers public-SDR directory source
// types into the shared source graph. Plain JS so the proxy can share it.
import { registerSourceTypes } from '../../core/sourceGraph.js';

export const SDR_SOURCE_WEIGHTS = Object.freeze({
  kiwisdr: 0.5,
  websdr: 0.4
});

export const SDR_SOURCE_LABELS = Object.freeze({
  kiwisdr: 'KiwiSDR network',
  websdr: 'WebSDR network'
});

registerSourceTypes({
  weights: SDR_SOURCE_WEIGHTS,
  labels: SDR_SOURCE_LABELS,
  trusted: ['kiwisdr']
});
