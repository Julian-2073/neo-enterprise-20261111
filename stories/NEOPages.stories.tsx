import type { Meta, StoryObj } from '@storybook/react-vite';
import { Prototype } from '../components/neo-demo/prototype';

const meta = {
  id: 'neo-pages',
  title: 'NEO/页面',
  component: Prototype,
  args: { mode: 'example' },
  parameters: {
    docs: {
      description: {
        component: '直接复用交接包里的前端组件与模拟数据。这些预览证明页面可以展示，不代表后端接口、AI 模型或企业数据已接通。页面链接会切换到对应的 Storybook 预览。',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: { page: { control: 'select', options: ['home', 'people', 'goods', 'market', 'overview'] } },
} satisfies Meta<typeof Prototype>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = { name: '老板工作台', args: { page: 'home' } };
export const People: Story = { name: '客户分析 · 人', args: { page: 'people' } };
export const Goods: Story = { name: '供应链与库存 · 货', args: { page: 'goods' } };
export const Market: Story = { name: '渠道与市场 · 场', args: { page: 'market' } };
export const Overview: Story = {
  name: '生意预测与协同',
  args: { page: 'overview' },
  decorators: [(Story, context) => {
    // The original component reads ?view= when mounting. Adapt the Storybook
    // globals before mounting without changing the application's source.
    const url = new URL(window.location.href);
    const view = context.globals.neoDecisionView;
    if (view === 'forecast' || view === 'action') url.searchParams.set('view', view);
    else url.searchParams.delete('view');
    window.history.replaceState(null, '', url);
    return <Story />;
  }],
};
