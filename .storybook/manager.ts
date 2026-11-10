import { addons } from 'storybook/manager-api';

addons.setConfig({
  layoutCustomisations: {
    // The observation page has no component controls. Keep the graph readable.
    showPanel(state, defaultValue) {
      return state.storyId === 'neo-backend--overview' ? false : defaultValue;
    },
  },
});
