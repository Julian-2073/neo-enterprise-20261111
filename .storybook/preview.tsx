import type { Preview } from '@storybook/react-vite'
import '../app/globals.css';

const pageStories: Record<string, string> = {
  '/': 'neo-pages--home',
  '/analysis/people': 'neo-pages--people',
  '/analysis/goods': 'neo-pages--goods',
  '/analysis/market': 'neo-pages--market',
  '/analysis/overview': 'neo-pages--overview',
  '/future': 'neo-pages--overview',
  '/reports/weekly': 'neo-weekly-report--default',
};

const preview: Preview = {
  initialGlobals: { neoDecisionView: 'evidence' },
  decorators: [
    (Story) => (
      <div onClickCapture={(event) => {
        if (!(event.target instanceof Element)) return;
        const anchor = event.target.closest('a');
        if (!anchor || anchor.target || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const url = new URL(anchor.href);
        const storyId = url.origin === window.location.origin && (url.pathname === '/demo' ? (url.searchParams.get('page') === 'weekly' ? 'neo-weekly-report--default' : `neo-pages--${url.searchParams.get('page') || 'home'}`) : pageStories[url.pathname]);
        if (!storyId) return;
        event.preventDefault();
        const target = new URL(window.parent.location.href);
        target.search = '';
        target.searchParams.set('path', `/story/${storyId}`);
        const view = url.searchParams.get('view') || (url.pathname === '/future' ? 'forecast' : null);
        if (view) target.searchParams.set('globals', `neoDecisionView:${view}`);
        window.parent.location.assign(target.href);
      }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
    controls: {
      matchers: {
       color: /(background|color)$/i,
       date: /Date$/i,
      },
    },
  },
};

export default preview;
