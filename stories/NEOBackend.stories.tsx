import type { Meta, StoryObj } from '@storybook/react-vite';
import { BackendOverview } from './backend-map/BackendOverview';

const meta = {
  id: 'neo-backend',
  title: 'NEO/后端建设总览',
  component: BackendOverview,
  parameters: { layout: 'fullscreen', controls: { disable: true } },
} satisfies Meta<typeof BackendOverview>;

export default meta;
export const Overview: StoryObj<typeof meta> = { name: '链路图与源码依据' };
