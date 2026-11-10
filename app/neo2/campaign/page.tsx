"use client";
// 营销复盘 (C01): 独立的输入/过程/输出。活动去重订单数、优惠分摊与净结果。

import {Neo2Shell} from '../../../components/neo2/shell';
import {AnalysisWorkspaceView} from '../../../components/neo2/analysis-view';

export default function Page() {
    return (
        <Neo2Shell
            active="campaign"
            title="营销复盘"
            subtitle="活动期间的去重订单数、优惠分摊与活动净结果，来自已确认快照的确定性计算。"
        >
            <AnalysisWorkspaceView
                workspace="campaign"
                notes={[
                    '去重订单数按订单 ID 去重，同一订单多行只计一次；无活动关联的快照显示「不可计算（无活动订单关联）」。',
                    '净结果 = 销售额 − 优惠分摊 − 成本；成本缺失时显示「不可计算（成本数据部分缺失）」。',
                ]}
            />
        </Neo2Shell>
    );
}
