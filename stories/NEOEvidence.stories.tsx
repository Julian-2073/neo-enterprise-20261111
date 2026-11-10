import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { EvidenceDrawer } from '../components/neo-demo/evidence-drawer';
import { getEvidence } from '../lib/neo-demo';

const meta = {
  title: 'NEO/组件/证据抽屉',
  component: EvidenceDrawer,
  tags: ['autodocs'],
  args: { onClose: fn() },
  parameters: { docs: { description: { component: '原有模拟证据组件，可查看来源、时间与统计范围。关闭操作会记录到 Actions；独立组件示例保持由 Controls 指定的状态。' } } },
} satisfies Meta<typeof EvidenceDrawer>;

export default meta;
type Story = StoryObj<typeof meta>;
export const Open: Story = { name: '展开模拟证据', args: { evidence: getEvidence('conversion-gap') } };
export const Closed: Story = { name: '关闭状态', args: { evidence: null } };
