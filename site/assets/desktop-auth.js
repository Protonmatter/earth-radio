const READ_PATH = 'user_config_documents?select=document_key,value,revision,deleted_at&order=document_key';

export function isDesktopAuthAvailable(bridge, location) {
  return bridge?.isDesktop === true && location?.protocol === 'file:' &&
    typeof bridge.auth?.invoke === 'function' && typeof bridge.auth?.subscribe === 'function';
}

export function createDesktopAuthClient(bridge) {
  async function invoke(operation, input) {
    const result = await bridge.invoke(operation, input);
    if (!result?.ok) {
      const error = new Error(result?.error?.message || 'Account service unavailable. Restart Earth Radio.');
      error.code = result?.error?.code;
      error.status = result?.error?.status;
      throw error;
    }
    return result.value;
  }
  return {
    initialize: () => invoke('initialize'), getSession: () => invoke('session'),
    listExternalProviders: () => invoke('providers'), getUser: () => invoke('user'),
    signInWithOAuth: provider => invoke('signIn', { provider }),
    linkIdentity: provider => invoke('link', { provider }),
    signInWithEmail: email => invoke('email', { email }),
    signOut: () => invoke('signOut'), cancelPendingSignIn: () => invoke('cancel'),
    onAuthStateChange(callback) {
      return bridge.subscribe(value => {
        if (['SIGNED_IN', 'TOKEN_REFRESHED', 'SIGNED_OUT', 'AUTH_ERROR', 'FLOW_COMPLETED'].includes(value?.event)) {
          // Completion is informational and must not replace the active session.
          if (value.event !== 'FLOW_COMPLETED') callback(value.event, value.session, value.message);
        }
      });
    },
    async rest(path, options = {}) {
      if (path !== READ_PATH || Object.keys(options).some(key => key !== 'expectedUserId')) throw new Error('Unsupported account data request.');
      return invoke('readDocuments', { expectedUserId: options.expectedUserId });
    },
    async rpc(name, body, options = {}) {
      if (name !== 'upsert_user_config_document' || Object.keys(options).some(key => key !== 'expectedUserId')) throw new Error('Unsupported account data request.');
      return invoke('upsertDocument', { body, expectedUserId: options.expectedUserId });
    }
  };
}
