import type { Meta, StoryObj } from '@storybook/react-vite';
import { WeeklyActionReport } from '../components/neo-demo/weekly-report';

const meta = {
  id: 'neo-weekly-report',
  title: 'NEO/行动周报',
  component: WeeklyActionReport,
  args: { mode: 'example' },
  tags: ['autodocs'],
  parameters: {
    docs: { description: { component: '复用已有周报页面。此故事显式使用最初演示模式。产品页面使用已保存的经营选择，两者分开。' } },
  },
} satisfies Meta<typeof WeeklyActionReport>;

export default meta;
export const Default: StoryObj<typeof meta> = { name: '行动与结果' };
