// A completed request can fail. Only a successful response establishes a real zero.
export function launcherAvailability(state) {
  const instances = state.loadErrors.instances ? 'unavailable' : state.instancesLoaded ? 'ready' : 'loading';
  const settings = state.loadErrors.settings ? 'unavailable' : state.settings ? 'ready' : 'loading';
  return {
    instances,
    settings,
    canLaunch: instances === 'ready' && settings === 'ready',
    unavailable: instances === 'unavailable' || settings === 'unavailable',
  };
}
