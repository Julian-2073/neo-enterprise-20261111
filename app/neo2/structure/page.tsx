"use client";
// 商品结构 (M01): 独立的输入/过程/输出。核心码可售占比与款色销售额占比。

import {Neo2Shell} from '../../../components/neo2/shell';
import {AnalysisWorkspaceView} from '../../../components/neo2/analysis-view';

export default function Page() {
    return (
        <Neo2Shell
            active="structure"
            title="商品结构"
            subtitle="核心尺码可售占比与款色销售额占比，来自已确认快照的确定性计算。"
        >
            <AnalysisWorkspaceView
                workspace="structure"
                notes={[
                    '核心尺码占比只统计标记为 core 的 SKU；快照无库存域时占比显示「不可计算」。',
                    '款色销售额占比的每一行款色都是独立指标结果，证据列显示对应款色 ID。',
                ]}
            />
        </Neo2Shell>
    );
}
