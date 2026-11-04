import { enforceMetadataQuota } from '../_shared/rate-limit.js';

export function onRequest(context) { return enforceMetadataQuota(context); }
